import "server-only";
import type {
  SqlQueryable,
  TransactionalSqlDatabase,
} from "../db/queryable";
import { getPreferencesForOwner } from "../preferences/repository";
import { listProductsForOwner } from "../products/repository";
import { evaluateProductReadiness } from "../products/readiness";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BatchCreationInput = {
  ownerId: string;
  productIds: string[];
  requestKey: string;
};

export type ContentGroupSummary = {
  id: string;
  productId: string;
  variantIndex: number;
  status: string;
};

export type ContentBatchSummary = {
  id: string;
  preferenceVersion: number;
  groups: ContentGroupSummary[];
  idempotentReplay: boolean;
};

export class BatchCreationError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "preferences_required"
      | "product_unavailable"
      | "product_not_ready",
    message: string,
  ) {
    super(message);
    this.name = "BatchCreationError";
  }
}

function validateInput(input: BatchCreationInput): void {
  if (
    !uuidPattern.test(input.ownerId) ||
    input.productIds.length === 0 ||
    input.productIds.length > 3 ||
    new Set(input.productIds).size !== input.productIds.length ||
    input.productIds.some((id) => !uuidPattern.test(id)) ||
    input.requestKey.trim().length < 8 ||
    input.requestKey.length > 128
  ) {
    throw new BatchCreationError(
      "invalid_request",
      "批次必須包含 1 至 3 個不重複的商品及有效請求識別碼。",
    );
  }
}

async function findExistingBatch(
  queryable: SqlQueryable,
  ownerId: string,
  requestKey: string,
): Promise<{ id: string; preference_version: number } | null> {
  const result = await queryable.query<{
    id: string;
    preference_version: number;
  }>(
    `
      SELECT id::text, preference_version
      FROM content_batches
      WHERE owner_id = $1 AND request_key = $2
    `,
    [ownerId, requestKey],
  );
  return result.rows[0] ?? null;
}

async function loadBatchSummary(
  queryable: SqlQueryable,
  ownerId: string,
  batch: { id: string; preference_version: number },
  idempotentReplay: boolean,
): Promise<ContentBatchSummary> {
  const groups = await queryable.query<ContentGroupSummary>(
    `
      SELECT id::text, product_id::text AS "productId",
        variant_index AS "variantIndex", status
      FROM content_groups
      WHERE owner_id = $1 AND batch_id = $2
      ORDER BY product_id, variant_index
    `,
    [ownerId, batch.id],
  );

  return {
    id: batch.id,
    preferenceVersion: batch.preference_version,
    groups: groups.rows,
    idempotentReplay,
  };
}

export async function createContentBatch(
  database: TransactionalSqlDatabase,
  input: BatchCreationInput,
): Promise<ContentBatchSummary> {
  validateInput(input);

  const client = await database.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;

    const existing = await findExistingBatch(
      client,
      input.ownerId,
      input.requestKey,
    );
    if (existing) {
      const summary = await loadBatchSummary(
        client,
        input.ownerId,
        existing,
        true,
      );
      await client.query("COMMIT");
      inTransaction = false;
      return summary;
    }

    const preferences = await getPreferencesForOwner(client, input.ownerId);
    if (!preferences) {
      throw new BatchCreationError(
        "preferences_required",
        "請先保存內容偏好，再建立製作批次。",
      );
    }

    const products = await listProductsForOwner(client, input.ownerId);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const selectedProducts = input.productIds.map((productId) => {
      const product = productsById.get(productId);
      if (!product) {
        throw new BatchCreationError(
          "product_unavailable",
          "所選商品不存在或不屬於目前使用者。",
        );
      }

      const readiness = evaluateProductReadiness(product);
      if (!readiness.ready) {
        throw new BatchCreationError(
          "product_not_ready",
          `商品「${product.title}」尚未通過資料與素材權利檢查：${readiness.reasons.join(", ")}`,
        );
      }
      return product;
    });

    const inserted = await client.query<{
      id: string;
      preference_version: number;
    }>(
      `
        INSERT INTO content_batches (owner_id, request_key, preference_version, status)
        VALUES ($1, $2, $3, 'queued')
        ON CONFLICT (owner_id, request_key) DO NOTHING
        RETURNING id::text, preference_version
      `,
      [input.ownerId, input.requestKey, preferences.version],
    );

    if (inserted.rows.length === 0) {
      const concurrentDuplicate = await findExistingBatch(
        client,
        input.ownerId,
        input.requestKey,
      );
      if (!concurrentDuplicate) {
        throw new Error("Idempotent batch insert returned no existing record.");
      }
      const summary = await loadBatchSummary(
        client,
        input.ownerId,
        concurrentDuplicate,
        true,
      );
      await client.query("COMMIT");
      inTransaction = false;
      return summary;
    }

    const batch = inserted.rows[0];
    if (!batch) throw new Error("Creating a content batch returned no record.");

    await client.query(
      `
        INSERT INTO content_events (
          owner_id, batch_id, event_type, idempotency_key, details
        )
        VALUES ($1, $2, 'batch.created', $3, $4::jsonb)
      `,
      [
        input.ownerId,
        batch.id,
        `${input.requestKey}:created`,
        JSON.stringify({ productIds: input.productIds }),
      ],
    );

    const groupSummaries: ContentGroupSummary[] = [];
    for (const product of selectedProducts) {
      for (const variantIndex of [1, 2] as const) {
        const groupResult = await client.query<{ id: string }>(
          `
            INSERT INTO content_groups (
              owner_id, batch_id, product_id, product_source_version,
              variant_index, status
            )
            VALUES ($1, $2, $3, $4, $5, 'queued')
            RETURNING id::text
          `,
          [
            input.ownerId,
            batch.id,
            product.id,
            product.source.version,
            variantIndex,
          ],
        );
        const groupId = groupResult.rows[0]?.id;
        if (!groupId) {
          throw new Error("Creating a content group returned no record.");
        }

        await client.query(
          `
            INSERT INTO content_jobs (
              owner_id, group_id, attempt, idempotency_key, status
            )
            VALUES ($1, $2, 1, $3, 'queued')
          `,
          [
            input.ownerId,
            groupId,
            `${input.requestKey}:${product.id}:${variantIndex}`,
          ],
        );
        groupSummaries.push({
          id: groupId,
          productId: product.id,
          variantIndex,
          status: "queued",
        });
      }
    }

    await client.query("COMMIT");
    inTransaction = false;
    return {
      id: batch.id,
      preferenceVersion: batch.preference_version,
      groups: groupSummaries,
      idempotentReplay: false,
    };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容批次交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
