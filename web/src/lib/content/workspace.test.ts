import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlDatabase } from "../db/queryable";
import { createFakeProviderAdapters } from "../providers/adapters";
import { savePreferencesForOwner } from "../preferences/repository";
import { createContentBatch } from "./batches";
import { generateSourcedContent } from "./generation";
import {
  editContentRevision,
  getContentGroupForOwner,
  requestContentGroupAttempt,
} from "./workspace";

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
  const batch = await createContentBatch(adapter, {
    ownerId,
    productIds: [productId],
    requestKey: "workspace-batch-key",
  });
  return batch;
}

describe("content group workspace", () => {
  it("appends edits and regenerations to one group's version history only", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    const batch = await createBatchFixture(database, adapter, ownerId);
    const firstGroup = batch.groups[0].id;
    const otherGroup = batch.groups[1].id;
    const fakeAdapters = createFakeProviderAdapters();

    const firstRevision = await generateSourcedContent(
      adapter,
      fakeAdapters,
      ownerId,
      firstGroup,
    );
    await generateSourcedContent(adapter, fakeAdapters, ownerId, otherGroup);

    const edit = {
      ownerId,
      groupId: firstGroup,
      parentRevisionId: firstRevision.id,
      requestKey: "edit-revision-key",
      caption: "整理後的貼文：棉質商品",
      script: "分享已核實的材質：棉",
      style: "清楚自然",
    };
    const edited = await editContentRevision(adapter, edit);
    const replay = await editContentRevision(adapter, edit);

    expect(edited.revision).toBe(2);
    expect(edited.parentRevisionId).toBe(firstRevision.id);
    expect(replay.id).toBe(edited.id);

    const firstGroupView = await getContentGroupForOwner(
      adapter,
      ownerId,
      firstGroup,
    );
    const otherGroupView = await getContentGroupForOwner(
      adapter,
      ownerId,
      otherGroup,
    );
    expect(firstGroupView?.revisions.map((revision) => revision.revision)).toEqual([
      2,
      1,
    ]);
    expect(firstGroupView?.revisions[0].style).toBe("清楚自然");
    expect(otherGroupView?.revisions.map((revision) => revision.revision)).toEqual([
      1,
    ]);

    const regenerate = await requestContentGroupAttempt(adapter, {
      ownerId,
      groupId: firstGroup,
      action: "regenerate",
      requestKey: "regenerate-key",
      expectedRevisionId: edited.id,
    });
    const regenerateReplay = await requestContentGroupAttempt(adapter, {
      ownerId,
      groupId: firstGroup,
      action: "regenerate",
      requestKey: "regenerate-key",
      expectedRevisionId: edited.id,
    });
    expect(regenerate.attempt).toBe(2);
    expect(regenerateReplay).toMatchObject({
      jobId: regenerate.jobId,
      idempotentReplay: true,
    });

    const regenerated = await generateSourcedContent(
      adapter,
      fakeAdapters,
      ownerId,
      firstGroup,
    );
    expect(regenerated.revision).toBe(3);

    const updatedOtherGroup = await getContentGroupForOwner(
      adapter,
      ownerId,
      otherGroup,
    );
    expect(updatedOtherGroup?.attempts).toHaveLength(1);
    expect(updatedOtherGroup?.revisions).toHaveLength(1);
  });

  it("retries only a failed group and preserves its readable failure reason", async () => {
    const { database, adapter } = await createDatabase();
    const ownerId = randomUUID();
    const batch = await createBatchFixture(database, adapter, ownerId);
    const failedGroup = batch.groups[0].id;
    const successfulGroup = batch.groups[1].id;
    const failedAdapters = createFakeProviderAdapters({
      failKinds: ["text"],
    });

    await expect(
      generateSourcedContent(adapter, failedAdapters, ownerId, failedGroup),
    ).rejects.toMatchObject({ code: "provider_failed" });
    await generateSourcedContent(
      adapter,
      createFakeProviderAdapters(),
      ownerId,
      successfulGroup,
    );

    const failedBeforeRetry = await getContentGroupForOwner(
      adapter,
      ownerId,
      failedGroup,
    );
    expect(failedBeforeRetry?.failureReason).toBe(
      "內容服務目前無法產生結果，請稍後重試此內容組。",
    );

    const retry = await requestContentGroupAttempt(adapter, {
      ownerId,
      groupId: failedGroup,
      action: "retry",
      requestKey: "retry-failed-group",
    });
    const replay = await requestContentGroupAttempt(adapter, {
      ownerId,
      groupId: failedGroup,
      action: "retry",
      requestKey: "retry-failed-group",
    });
    expect(retry.attempt).toBe(2);
    expect(replay.jobId).toBe(retry.jobId);
    expect(replay.idempotentReplay).toBe(true);

    await generateSourcedContent(
      adapter,
      createFakeProviderAdapters(),
      ownerId,
      failedGroup,
    );
    const retriedGroup = await getContentGroupForOwner(
      adapter,
      ownerId,
      failedGroup,
    );
    const untouchedGroup = await getContentGroupForOwner(
      adapter,
      ownerId,
      successfulGroup,
    );
    expect(retriedGroup?.attempts.map((attempt) => attempt.status)).toEqual([
      "succeeded",
      "failed",
    ]);
    expect(retriedGroup?.failureReason).toBeNull();
    expect(untouchedGroup?.attempts).toHaveLength(1);
    expect(untouchedGroup?.status).toBe("awaiting_review");
  });
});
