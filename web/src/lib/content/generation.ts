import "server-only";
import type { TransactionalSqlDatabase } from "../db/queryable";
import type { ProductFact } from "../products/readiness";
import { evaluateProductReadiness } from "../products/readiness";
import { listProductsForOwner } from "../products/repository";
import {
  getPreferencesVersionForOwner,
} from "../preferences/repository";
import {
  ProviderAdapterError,
  type ProviderAdapters,
  type ProviderUsage,
} from "../providers/adapters";

type GenerationWork = {
  groupId: string;
  jobId: string;
  attempt: number;
  productId: string;
  productSourceVersion: string;
  preferenceVersion: number;
  variantIndex: 1 | 2;
};

type RevisionRow = {
  id: string;
  revision: number;
};

export type GeneratedContentRevision = {
  id: string;
  groupId: string;
  revision: number;
  productSourceVersion: string;
  preferenceVersion: number;
  sourceFactKeys: string[];
  caption: string;
  script: string;
  subtitles: string[];
  isSynthetic: boolean;
};

export class ContentGenerationError extends Error {
  constructor(
    readonly code:
      | "group_unavailable"
      | "job_not_queued"
      | "preferences_unavailable"
      | "product_unavailable"
      | "product_not_ready"
      | "source_version_changed"
      | "no_supported_facts",
    message: string,
  ) {
    super(message);
    this.name = "ContentGenerationError";
  }
}

async function claimQueuedJob(
  database: TransactionalSqlDatabase,
  ownerId: string,
  groupId: string,
): Promise<GenerationWork> {
  const client = await database.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    const result = await client.query<GenerationWork>(
      `
        SELECT
          g.id::text AS "groupId",
          j.id::text AS "jobId",
          j.attempt,
          g.product_id::text AS "productId",
          g.product_source_version AS "productSourceVersion",
          b.preference_version AS "preferenceVersion",
          g.variant_index AS "variantIndex"
        FROM content_groups g
        JOIN content_batches b
          ON b.owner_id = g.owner_id AND b.id = g.batch_id
        JOIN content_jobs j
          ON j.owner_id = g.owner_id AND j.group_id = g.id
        WHERE g.owner_id = $1 AND g.id = $2 AND j.status = 'queued'
        ORDER BY j.attempt DESC
        LIMIT 1
        FOR UPDATE OF g, j
      `,
      [ownerId, groupId],
    );
    const work = result.rows[0];
    if (!work) {
      const group = await client.query(
        "SELECT id FROM content_groups WHERE owner_id = $1 AND id = $2",
        [ownerId, groupId],
      );
      if (group.rows.length === 0) {
        throw new ContentGenerationError(
          "group_unavailable",
          "此內容組不存在或不屬於目前使用者。",
        );
      }
      throw new ContentGenerationError(
        "job_not_queued",
        "此內容組目前沒有可執行的排隊工作。",
      );
    }

    await client.query(
      "UPDATE content_jobs SET status = 'running', started_at = now() WHERE owner_id = $1 AND id = $2",
      [ownerId, work.jobId],
    );
    await client.query(
      "UPDATE content_groups SET status = 'producing' WHERE owner_id = $1 AND id = $2",
      [ownerId, groupId],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return work;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容生成工作認領。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function isValidUsage(usage: ProviderUsage | undefined): usage is ProviderUsage {
  return (
    usage !== undefined &&
    Number.isSafeInteger(usage.inputUnits) &&
    usage.inputUnits >= 0 &&
    Number.isSafeInteger(usage.outputUnits) &&
    usage.outputUnits >= 0 &&
    /^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(usage.costAmount) &&
    /^[A-Z]{3}$/.test(usage.currency)
  );
}

function errorCode(error: unknown): string {
  if (
    error instanceof ContentGenerationError ||
    error instanceof ProviderAdapterError
  ) {
    return error.code;
  }
  return "generation_failed";
}

function userFacingFailureReason(error: unknown): string {
  if (error instanceof ContentGenerationError) return error.message;
  if (error instanceof ProviderAdapterError && error.code === "timeout") {
    return "內容服務處理逾時，請稍後重試此內容組。";
  }
  if (error instanceof ProviderAdapterError) {
    return "內容服務目前無法產生結果，請稍後重試此內容組。";
  }
  return "內容製作失敗，請稍後重試此內容組。";
}

function buildSourcedContent(
  productTitle: string,
  variantIndex: 1 | 2,
  facts: ProductFact[],
): { caption: string; script: string; subtitles: string[] } {
  const factLines = facts.map((fact) => `${fact.key}：${fact.value}`);
  const opening =
    variantIndex === 1
      ? `商品資料重點：${productTitle}`
      : `整理商品資訊給你參考：${productTitle}`;
  const script = [opening, ...factLines].join("。");

  return {
    caption: [opening, ...factLines].join("\n"),
    script,
    subtitles: [opening, ...factLines],
  };
}

async function recordFailedAttempt(
  database: TransactionalSqlDatabase,
  ownerId: string,
  work: GenerationWork,
  providerId: string,
  failureCode: string,
  failureReason: string,
): Promise<void> {
  const client = await database.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      `
        INSERT INTO provider_usage_events (
          owner_id, job_id, provider_kind, provider_id, status,
          input_units, output_units, cost_amount, currency, cost_known,
          failure_code, idempotency_key
        )
        VALUES ($1, $2, 'text', $3, 'failed', 0, 0, NULL, NULL, false, $4, $5)
        ON CONFLICT (owner_id, job_id, provider_kind) DO NOTHING
      `,
      [
        ownerId,
        work.jobId,
        providerId,
        failureCode,
        `${work.jobId}:text`,
      ],
    );
    await client.query(
      "UPDATE content_jobs SET status = 'failed', failure_code = $3, finished_at = now() WHERE owner_id = $1 AND id = $2",
      [ownerId, work.jobId, failureCode],
    );
    await client.query(
      "UPDATE content_groups SET status = 'failed', failure_reason = $3 WHERE owner_id = $1 AND id = $2",
      [ownerId, work.groupId, failureReason],
    );
    await client.query("COMMIT");
    inTransaction = false;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾失敗生成工作的記錄交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function persistSuccessfulAttempt(
  database: TransactionalSqlDatabase,
  ownerId: string,
  work: GenerationWork,
  facts: ProductFact[],
  generated: {
    providerId: string;
    provenance: "provider" | "synthetic";
    productionEligible: boolean;
    usage: ProviderUsage;
  },
  content: { caption: string; script: string; subtitles: string[] },
): Promise<RevisionRow> {
  const client = await database.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      "SELECT id FROM content_groups WHERE owner_id = $1 AND id = $2 FOR UPDATE",
      [ownerId, work.groupId],
    );
    const revisionResult = await client.query<{ revision: number }>(
      `
        SELECT COALESCE(MAX(revision), 0) + 1 AS revision
        FROM content_revisions
        WHERE owner_id = $1 AND group_id = $2
      `,
      [ownerId, work.groupId],
    );
    const revision = revisionResult.rows[0]?.revision;
    if (!revision) throw new Error("Could not allocate a content revision.");

    const inserted = await client.query<RevisionRow>(
      `
        INSERT INTO content_revisions (
          owner_id, group_id, job_id, revision, product_source_version,
          preference_version, source_facts, caption, script, subtitles,
          is_synthetic
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
        RETURNING id::text, revision
      `,
      [
        ownerId,
        work.groupId,
        work.jobId,
        revision,
        work.productSourceVersion,
        work.preferenceVersion,
        JSON.stringify(facts),
        content.caption,
        content.script,
        content.subtitles,
        generated.provenance === "synthetic" || !generated.productionEligible,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Saving generated content returned no record.");

    await client.query(
      `
        INSERT INTO provider_usage_events (
          owner_id, job_id, provider_kind, provider_id, status,
          input_units, output_units, cost_amount, currency, cost_known,
          idempotency_key
        )
        VALUES ($1, $2, 'text', $3, 'succeeded', $4, $5, $6, $7, true, $8)
      `,
      [
        ownerId,
        work.jobId,
        generated.providerId,
        generated.usage.inputUnits,
        generated.usage.outputUnits,
        generated.usage.costAmount,
        generated.usage.currency,
        `${work.jobId}:text`,
      ],
    );
    await client.query(
      "UPDATE content_jobs SET status = 'succeeded', finished_at = now() WHERE owner_id = $1 AND id = $2",
      [ownerId, work.jobId],
    );
    await client.query(
      "UPDATE content_groups SET status = 'awaiting_review' WHERE owner_id = $1 AND id = $2",
      [ownerId, work.groupId],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return row;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾已產生內容的資料交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function generateSourcedContent(
  database: TransactionalSqlDatabase,
  adapters: ProviderAdapters,
  ownerId: string,
  groupId: string,
  now: Date = new Date(),
): Promise<GeneratedContentRevision> {
  const work = await claimQueuedJob(database, ownerId, groupId);

  try {
    const products = await listProductsForOwner(database, ownerId);
    const product = products.find((candidate) => candidate.id === work.productId);
    if (!product) {
      throw new ContentGenerationError(
        "product_unavailable",
        "此商品已不存在或不屬於目前使用者。",
      );
    }
    if (product.source.version !== work.productSourceVersion) {
      throw new ContentGenerationError(
        "source_version_changed",
        "商品來源版本已變更，請重新核對商品後再製作。",
      );
    }

    const readiness = evaluateProductReadiness(product, now);
    if (!readiness.ready) {
      throw new ContentGenerationError(
        "product_not_ready",
        `商品尚未通過資料與素材權利檢查：${readiness.reasons.join(", ")}`,
      );
    }

    const preferences = await getPreferencesVersionForOwner(
      database,
      ownerId,
      work.preferenceVersion,
    );
    if (!preferences) {
      throw new ContentGenerationError(
        "preferences_unavailable",
        "此批次使用的偏好版本已無法讀取。",
      );
    }

    const availableFacts = product.facts.filter(
      (fact) => fact.sourceVersion === work.productSourceVersion,
    );
    const generated = await adapters.text.generate(
      {
        productTitle: product.title,
        productSourceVersion: work.productSourceVersion,
        facts: availableFacts,
        variantIndex: work.variantIndex,
        audience: preferences.audience,
        topic: preferences.topic,
        voice: preferences.voice,
        style: preferences.defaultStyle,
      },
      AbortSignal.timeout(30_000),
    );

    if (generated.data.sourceVersion !== work.productSourceVersion) {
      throw new ProviderAdapterError(
        "text",
        "provider_failed",
        "文字 provider 回傳了不相符的商品來源版本。",
      );
    }
    if (!isValidUsage(generated.usage)) {
      throw new ProviderAdapterError(
        "text",
        "provider_failed",
        "文字 provider 未回傳有效的用量與成本資料。",
      );
    }

    const factsByKey = new Map(availableFacts.map((fact) => [fact.key, fact]));
    const selectedFacts = [
      ...new Set(generated.data.factKeys),
    ].flatMap((key) => {
      const fact = factsByKey.get(key);
      return fact ? [fact] : [];
    });
    if (selectedFacts.length === 0) {
      throw new ContentGenerationError(
        "no_supported_facts",
        "文字 provider 未選取任何可追溯的商品事實，已阻擋內容輸出。",
      );
    }

    const content = buildSourcedContent(
      product.title,
      work.variantIndex,
      selectedFacts,
    );
    const revision = await persistSuccessfulAttempt(
      database,
      ownerId,
      work,
      selectedFacts,
      {
        providerId: generated.providerId,
        provenance: generated.provenance,
        productionEligible: generated.productionEligible,
        usage: generated.usage,
      },
      content,
    );

    return {
      ...revision,
      groupId: work.groupId,
      productSourceVersion: work.productSourceVersion,
      preferenceVersion: work.preferenceVersion,
      sourceFactKeys: selectedFacts.map((fact) => fact.key),
      caption: content.caption,
      script: content.script,
      subtitles: content.subtitles,
      isSynthetic:
        generated.provenance === "synthetic" || !generated.productionEligible,
    };
  } catch (error) {
    try {
      await recordFailedAttempt(
        database,
        ownerId,
        work,
        adapters.text.providerId,
        errorCode(error),
        userFacingFailureReason(error),
      );
    } catch (recordError) {
      console.error("無法記錄內容生成失敗與成本狀態。", recordError);
      throw new AggregateError(
        [error, recordError],
        "Content generation failed and its attempt could not be recorded.",
      );
    }
    throw error;
  }
}
