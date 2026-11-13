import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlDatabase } from "../db/queryable";
import {
  createFakeProviderAdapters,
  type ProviderAdapters,
} from "../providers/adapters";
import { savePreferencesForOwner } from "../preferences/repository";
import { createContentBatch } from "./batches";
import { generateSourcedContent } from "./generation";

vi.mock("server-only", () => ({}));

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function createDatabase(): Promise<{
  database: PGlite;
  adapter: TransactionalSqlDatabase;
}> {
  const database = new PGlite();
  databases.push(database);
  const adapter: TransactionalSqlDatabase = {
    query: (text, values) => database.query(text, values),
    connect: async () => ({
      query: (text, values) => database.query(text, values),
      release: () => undefined,
    }),
  };
  const migrationDirectory = join(process.cwd(), "db", "migrations");
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();

  for (const file of migrationFiles) {
    await database.exec(await readFile(join(migrationDirectory, file), "utf8"));
  }

  return { database, adapter };
}

async function addReadyProduct(
  database: PGlite,
  ownerId: string,
): Promise<string> {
  const { rows } = await database.query<{ id: string }>(
    `
      INSERT INTO products (
        owner_id, source_provider, source_external_id, source_uri,
        source_version, source_checked_at, data_valid_until, title,
        eligibility_status
      )
      VALUES ($1, 'verified-source', $2, 'https://source.example.test/item',
        'source-v1', now(), now() + interval '30 days', 'Item A', 'eligible')
      RETURNING id::text
    `,
    [ownerId, randomUUID()],
  );
  const productId = rows[0].id;

  await database.query(
    `
      INSERT INTO product_facts (
        owner_id, product_id, fact_key, fact_value, source_reference,
        source_version, verified_at
      )
      VALUES
        ($1, $2, 'material', 'Cotton', 'https://source.example.test/item#material',
          'source-v1', now()),
        ($1, $2, 'color', 'Blue', 'https://source.example.test/item#color',
          'source-v1', now())
    `,
    [ownerId, productId],
  );
  await database.query(
    `
      INSERT INTO product_assets (
        owner_id, product_id, asset_type, source_uri, source_version,
        rights_provider, rights_status, allowed_uses, rights_verified_at
      )
      VALUES ($1, $2, 'image', 'https://assets.example.test/item.jpg', 'asset-v1',
        'rights-holder', 'verified', ARRAY['video-edit', 'commercial-export'], now())
    `,
    [ownerId, productId],
  );
  return productId;
}

async function createBatchFixture(
  database: PGlite,
  adapter: TransactionalSqlDatabase,
  ownerId: string,
) {
  await savePreferencesForOwner(adapter, ownerId, {
    audience: "分潤新手",
    topic: "居家生活",
    voice: "親切自然",
    defaultStyle: "簡潔溫暖",
  });
  const productId = await addReadyProduct(database, ownerId);
  const batch = await createContentBatch(adapter, {
    ownerId,
    productIds: [productId],
    requestKey: "generation-batch-key",
  });
  return { productId, batch };
}

describe("sourced content generation", () => {
  it("uses the batch preference and source snapshots, excluding unsupported fact keys", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    const { productId, batch } = await createBatchFixture(
      database,
      adapter,
      ownerId,
    );
    await savePreferencesForOwner(adapter, ownerId, {
      audience: "已更新的受眾",
      topic: "新品分享",
      voice: "活潑口語",
      defaultStyle: "俐落直接",
    });

    const fakeAdapters = createFakeProviderAdapters();
    const observedRequests: Parameters<
      ProviderAdapters["text"]["generate"]
    >[0][] = [];
    const adapters: ProviderAdapters = {
      ...fakeAdapters,
      text: {
        providerId: "contract-test",
        async generate(request) {
          observedRequests.push(request);
          return {
            providerId: "contract-test",
            provenance: "provider",
            productionEligible: true,
            usage: {
              inputUnits: 120,
              outputUnits: 48,
              costAmount: "0.001200",
              currency: "USD",
            },
            data: {
              sourceVersion: request.productSourceVersion,
              factKeys: ["material", "unsupported-claim"],
            },
          };
        },
      },
    };

    const result = await generateSourcedContent(
      adapter,
      adapters,
      ownerId,
      batch.groups[0].id,
    );

    expect(observedRequests[0]).toMatchObject({
      productTitle: "Item A",
      productSourceVersion: "source-v1",
      audience: "分潤新手",
      topic: "居家生活",
    });
    expect(
      observedRequests[0].facts.map((fact) => [fact.key, fact.value]),
    ).toEqual([
      ["color", "Blue"],
      ["material", "Cotton"],
    ]);
    expect(result).toMatchObject({
      productSourceVersion: "source-v1",
      preferenceVersion: 1,
      sourceFactKeys: ["material"],
      isSynthetic: false,
    });
    expect(result.script).toContain("Cotton");
    expect(result.script).not.toContain("unsupported-claim");

    const { rows: savedRevision } = await database.query<{
      preference_version: number;
      product_source_version: string;
      source_facts: Array<{ key: string }>;
      is_synthetic: boolean;
    }>(
      `
        SELECT preference_version, product_source_version, source_facts, is_synthetic
        FROM content_revisions
        WHERE owner_id = $1 AND group_id = $2
      `,
      [ownerId, result.groupId],
    );
    expect(savedRevision[0]).toMatchObject({
      preference_version: 1,
      product_source_version: "source-v1",
      source_facts: [{ key: "material", value: "Cotton" }],
      is_synthetic: false,
    });

    const { rows: usage } = await database.query<{
      status: string;
      input_units: number;
      output_units: number;
      cost_amount: string;
      cost_known: boolean;
    }>(
      `
        SELECT status, input_units, output_units, cost_amount::text, cost_known
        FROM provider_usage_events
        WHERE owner_id = $1
      `,
      [ownerId],
    );
    expect(usage).toEqual([
      {
        status: "succeeded",
        input_units: 120,
        output_units: 48,
        cost_amount: "0.001200",
        cost_known: true,
      },
    ]);

    const { rows: productRows } = await database.query<{ id: string }>(
      "SELECT id::text FROM products WHERE owner_id = $1",
      [ownerId],
    );
    expect(productRows[0].id).toBe(productId);
  });

  it("keeps failed and retried attempt records separate", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    const { batch } = await createBatchFixture(database, adapter, ownerId);
    const groupId = batch.groups[0].id;

    await expect(
      generateSourcedContent(
        adapter,
        createFakeProviderAdapters({ failKinds: ["text"] }),
        ownerId,
        groupId,
      ),
    ).rejects.toMatchObject({ code: "provider_failed" });

    await database.query(
      "UPDATE content_groups SET status = 'queued' WHERE owner_id = $1 AND id = $2",
      [ownerId, groupId],
    );
    await database.query(
      `
        INSERT INTO content_jobs (
          owner_id, group_id, attempt, idempotency_key, status
        )
        VALUES ($1, $2, 2, 'generation-retry-key', 'queued')
      `,
      [ownerId, groupId],
    );

    const result = await generateSourcedContent(
      adapter,
      createFakeProviderAdapters(),
      ownerId,
      groupId,
    );
    expect(result.revision).toBe(1);

    const { rows } = await database.query<{
      status: string;
      cost_known: boolean;
      failure_code: string | null;
      attempts: string;
    }>(
      `
        SELECT
          e.status, e.cost_known, e.failure_code,
          j.attempt::text AS attempts
        FROM provider_usage_events e
        JOIN content_jobs j ON j.owner_id = e.owner_id AND j.id = e.job_id
        WHERE e.owner_id = $1
        ORDER BY j.attempt
      `,
      [ownerId],
    );
    expect(rows).toEqual([
      {
        status: "failed",
        cost_known: false,
        failure_code: "provider_failed",
        attempts: "1",
      },
      {
        status: "succeeded",
        cost_known: true,
        failure_code: null,
        attempts: "2",
      },
    ]);
  });
});
