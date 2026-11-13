import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlDatabase } from "../db/queryable";
import { savePreferencesForOwner } from "../preferences/repository";
import { createContentBatch } from "./batches";

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
  title: string,
): Promise<string> {
  const { rows } = await database.query<{ id: string }>(
    `
      INSERT INTO products (
        owner_id, source_provider, source_external_id, source_uri,
        source_version, source_checked_at, data_valid_until, title,
        eligibility_status
      )
      VALUES ($1, 'verified-source', $2, 'https://source.example.test/item',
        'source-v1', now(), now() + interval '30 days', $3, 'eligible')
      RETURNING id::text
    `,
    [ownerId, randomUUID(), title],
  );
  const productId = rows[0].id;

  await database.query(
    `
      INSERT INTO product_facts (
        owner_id, product_id, fact_key, fact_value, source_reference,
        source_version, verified_at
      )
      VALUES ($1, $2, 'material', 'Cotton', 'https://source.example.test/item#material',
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

describe("content batch creation", () => {
  it("creates six isolated groups and jobs, pins preferences, and deduplicates retries", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    await savePreferencesForOwner(adapter, ownerId, {
      audience: "分潤新手",
      topic: "居家生活",
      voice: "親切自然",
      defaultStyle: "簡潔溫暖",
    });
    const products = await Promise.all(
      ["Item A", "Item B", "Item C"].map((title) =>
        addReadyProduct(database, ownerId, title),
      ),
    );

    const input = {
      ownerId,
      productIds: products,
      requestKey: "create-batch-key-1",
    };
    const created = await createContentBatch(adapter, input);

    expect(created.groups).toHaveLength(6);
    expect(new Set(created.groups.map((group) => group.productId)).size).toBe(3);
    expect(created.preferenceVersion).toBe(1);
    expect(created.idempotentReplay).toBe(false);

    await savePreferencesForOwner(adapter, ownerId, {
      audience: "分享日常的上班族",
      topic: "居家生活",
      voice: "親切自然",
      defaultStyle: "簡潔溫暖",
    });
    const replay = await createContentBatch(adapter, input);

    expect(replay.id).toBe(created.id);
    expect(replay.preferenceVersion).toBe(1);
    expect(
      replay.groups.map(({ productId, variantIndex, id }) =>
        [productId, variantIndex, id].join(":"),
      ),
    ).toEqual(
      created.groups
        .map(({ productId, variantIndex, id }) =>
          [productId, variantIndex, id].join(":"),
        )
        .sort(),
    );
    expect(replay.idempotentReplay).toBe(true);

    const { rows: counts } = await database.query<{
      groups: string;
      jobs: string;
      events: string;
    }>(
      `
        SELECT
          (SELECT count(*)::text FROM content_groups WHERE owner_id = $1 AND batch_id = $2) AS groups,
          (SELECT count(*)::text FROM content_jobs WHERE owner_id = $1) AS jobs,
          (SELECT count(*)::text FROM content_events WHERE owner_id = $1 AND batch_id = $2) AS events
      `,
      [ownerId, created.id],
    );
    expect(counts[0]).toEqual({ groups: "6", jobs: "6", events: "1" });

    const nextBatch = await createContentBatch(adapter, {
      ...input,
      requestKey: "create-batch-key-2",
    });
    expect(nextBatch.preferenceVersion).toBe(2);
  });

  it("rejects unavailable products without creating a batch", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    await savePreferencesForOwner(adapter, ownerId, {
      audience: "分潤新手",
      topic: "居家生活",
      voice: "親切自然",
      defaultStyle: "簡潔溫暖",
    });

    await expect(
      createContentBatch(adapter, {
        ownerId,
        productIds: [randomUUID()],
        requestKey: "unavailable-product-1",
      }),
    ).rejects.toMatchObject({ code: "product_unavailable" });

    const { rows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_batches WHERE owner_id = $1",
      [ownerId],
    );
    expect(rows[0].count).toBe("0");
  });

  it("rechecks product readiness before creating a batch", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    await savePreferencesForOwner(adapter, ownerId, {
      audience: "分潤新手",
      topic: "居家生活",
      voice: "親切自然",
      defaultStyle: "簡潔溫暖",
    });
    const productId = await addReadyProduct(database, ownerId, "Item A");
    await database.query(
      "UPDATE products SET eligibility_status = 'ineligible' WHERE id = $1",
      [productId],
    );

    await expect(
      createContentBatch(adapter, {
        ownerId,
        productIds: [productId],
        requestKey: "not-ready-product-1",
      }),
    ).rejects.toMatchObject({ code: "product_not_ready" });

    const { rows } = await database.query<{
      batches: string;
      jobs: string;
      events: string;
    }>(
      `
        SELECT
          (SELECT count(*)::text FROM content_batches WHERE owner_id = $1) AS batches,
          (SELECT count(*)::text FROM content_jobs WHERE owner_id = $1) AS jobs,
          (SELECT count(*)::text FROM content_events WHERE owner_id = $1) AS events
      `,
      [ownerId],
    );
    expect(rows[0]).toEqual({ batches: "0", jobs: "0", events: "0" });
  });

  it("requires saved preferences and rejects malformed batch requests", async () => {
    const { adapter } = await createDatabase();
    const ownerId = randomUUID();

    await expect(
      createContentBatch(adapter, {
        ownerId,
        productIds: [randomUUID()],
        requestKey: "needs-preferences",
      }),
    ).rejects.toMatchObject({ code: "preferences_required" });

    await expect(
      createContentBatch(adapter, {
        ownerId,
        productIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
        requestKey: "too-many-products",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
