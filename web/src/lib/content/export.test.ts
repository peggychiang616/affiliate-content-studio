import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlDatabase } from "../db/queryable";
import { savePreferencesForOwner } from "../preferences/repository";
import { createFakeProviderAdapters } from "../providers/adapters";
import { createContentBatch } from "./batches";
import { generateSourcedContent } from "./generation";
import {
  confirmContentRevision,
  ContentExportError,
  createContentPreviewLink,
  exportConfirmedContent,
} from "./export";
import { saveValidatedVideoArtifact } from "./video";

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

async function createExportFixture(
  database: PGlite,
  adapter: TransactionalSqlDatabase,
) {
  const { rows: principals } = await database.query<{ id: string }>(
    "INSERT INTO principals DEFAULT VALUES RETURNING id::text",
  );
  const ownerId = principals[0].id;
  await savePreferencesForOwner(adapter, ownerId, {
    audience: "分潤新手",
    topic: "居家生活",
    voice: "親切自然",
    defaultStyle: "簡潔溫暖",
  });
  const { rows: products } = await database.query<{ id: string }>(
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
  const productId = products[0].id;
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
  const { rows: assets } = await database.query<{ id: string }>(
    `
      INSERT INTO product_assets (
        owner_id, product_id, asset_type, source_uri, source_version,
        rights_provider, rights_status, allowed_uses, rights_verified_at,
        rights_valid_until
      )
      VALUES ($1, $2, 'image', 'https://assets.example.test/item.jpg', 'asset-v1',
        'rights-holder', 'verified', ARRAY['video-edit', 'commercial-export'],
        now(), now() + interval '30 days')
      RETURNING id::text
    `,
    [ownerId, productId],
  );
  const batch = await createContentBatch(adapter, {
    ownerId,
    productIds: [productId],
    requestKey: "export-batch-key",
  });
  const groupId = batch.groups[0].id;
  const revision = await generateSourcedContent(
    adapter,
    createFakeProviderAdapters(),
    ownerId,
    groupId,
  );
  await database.query(
    "UPDATE content_revisions SET is_synthetic = false WHERE owner_id = $1 AND id = $2",
    [ownerId, revision.id],
  );
  await saveValidatedVideoArtifact(adapter, {
    ownerId,
    groupId,
    revisionId: revision.id,
    productSourceVersion: "source-v1",
    sourceAssetId: assets[0].id,
    artifact: {
      mediaUri: "private://content/item.mp4",
      mediaType: "video/mp4",
      durationSeconds: 20,
      width: 1080,
      height: 1920,
      playable: true,
      audioPresent: true,
      subtitlesWithinSafeArea: true,
      maxAudioVideoOffsetMilliseconds: 100,
    },
    productionEligible: true,
  });

  return {
    ownerId,
    batchId: batch.id,
    groupId,
    revisionId: revision.id,
    assetId: assets[0].id,
  };
}

function createSigner(now: Date) {
  return {
    async sign(uri: string, lifetimeSeconds: number) {
      expect(uri).toBe("private://content/item.mp4");
      expect(lifetimeSeconds).toBe(300);
      return {
        url: "https://media.example.test/item.mp4?token=short-lived",
        expiresAt: new Date(now.getTime() + lifetimeSeconds * 1_000).toISOString(),
      };
    },
  };
}

describe("confirmed content preview and export", () => {
  it("requires a fresh preview and confirmation, adds disclosure, and deduplicates events", async () => {
    const { database, adapter } = await createDatabase();
    const fixture = await createExportFixture(database, adapter);
    const now = new Date();
    const signer = createSigner(now);

    await expect(
      exportConfirmedContent(adapter, {
        ...fixture,
        requestKey: "export-before-confirm",
        signer,
        now,
      }),
    ).rejects.toMatchObject({ code: "not_confirmed" });
    await expect(
      confirmContentRevision(adapter, {
        ...fixture,
        requestKey: "confirm-before-preview",
        confirmed: true,
        now,
      }),
    ).rejects.toMatchObject({ code: "preview_required" });

    await createContentPreviewLink(adapter, {
      ...fixture,
      signer,
      now,
    });
    await database.query(
      `
        UPDATE content_revision_previews
        SET previewed_at = $3
        WHERE owner_id = $1 AND revision_id = $2
      `,
      [fixture.ownerId, fixture.revisionId, new Date(now.getTime() - 301_000)],
    );
    await expect(
      confirmContentRevision(adapter, {
        ...fixture,
        requestKey: "confirm-expired-preview",
        confirmed: true,
        now,
      }),
    ).rejects.toMatchObject({ code: "preview_required" });

    await expect(
      createContentPreviewLink(adapter, {
        ...fixture,
        signer,
        now,
      }),
    ).resolves.toMatchObject({
      videoUrl: "https://media.example.test/item.mp4?token=short-lived",
    });
    const confirmation = await confirmContentRevision(adapter, {
      ...fixture,
      requestKey: "confirm-content-key",
      confirmed: true,
      now,
    });
    expect(confirmation.idempotentReplay).toBe(false);
    await expect(
      confirmContentRevision(adapter, {
        ...fixture,
        requestKey: "confirm-replay-key",
        confirmed: true,
        now,
      }),
    ).resolves.toMatchObject({ idempotentReplay: true });

    const exported = await exportConfirmedContent(adapter, {
      ...fixture,
      requestKey: "export-content-key",
      signer,
      now,
    });
    expect(exported).toMatchObject({
      groupId: fixture.groupId,
      revisionId: fixture.revisionId,
      videoUrl: "https://media.example.test/item.mp4?token=short-lived",
      disclosure: {
        text: "本文含聯盟行銷連結；若透過連結購買，可能獲得分潤。",
        placement: "caption-footer",
      },
    });
    expect(exported.caption.endsWith(exported.disclosure.text)).toBe(true);

    await exportConfirmedContent(adapter, {
      ...fixture,
      requestKey: "export-content-key",
      signer,
      now,
    });
    const { rows } = await database.query<{ event_type: string; count: string }>(
      `
        SELECT event_type, count(*)::text AS count
        FROM content_events
        WHERE owner_id = $1 AND batch_id = $2
          AND event_type IN ('content.confirmed', 'content.exported')
        GROUP BY event_type
      `,
      [fixture.ownerId, fixture.batchId],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { event_type: "content.confirmed", count: "1" },
        { event_type: "content.exported", count: "1" },
      ]),
    );
  });

  it("fails closed without a media signer and blocks exports after rights expire", async () => {
    const { database, adapter } = await createDatabase();
    const fixture = await createExportFixture(database, adapter);
    const now = new Date();

    await expect(
      createContentPreviewLink(adapter, {
        ...fixture,
        signer: null,
        now,
      }),
    ).rejects.toMatchObject({ code: "media_signer_unavailable" });
    const { rows: previewRows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_revision_previews WHERE owner_id = $1",
      [fixture.ownerId],
    );
    expect(previewRows[0].count).toBe("0");

    const signer = createSigner(now);
    await createContentPreviewLink(adapter, { ...fixture, signer, now });
    await confirmContentRevision(adapter, {
      ...fixture,
      requestKey: "confirm-rights-expiry",
      confirmed: true,
      now,
    });
    await expect(
      exportConfirmedContent(adapter, {
        ...fixture,
        requestKey: "export-no-signer",
        signer: null,
        now,
      }),
    ).rejects.toMatchObject({ code: "media_signer_unavailable" });
    await database.query(
      "UPDATE product_assets SET rights_status = 'expired' WHERE owner_id = $1 AND id = $2",
      [fixture.ownerId, fixture.assetId],
    );

    await expect(
      exportConfirmedContent(adapter, {
        ...fixture,
        requestKey: "export-expired-rights",
        signer,
        now,
      }),
    ).rejects.toMatchObject({ code: "product_not_ready" });
  });

  it("rejects malformed or overlong signed media links", async () => {
    const { database, adapter } = await createDatabase();
    const fixture = await createExportFixture(database, adapter);
    const now = new Date();
    const invalidSigner = {
      async sign() {
        return {
          url: "javascript:alert(1)",
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        };
      },
    };

    await expect(
      createContentPreviewLink(adapter, {
        ...fixture,
        signer: invalidSigner,
        now,
      }),
    ).rejects.toBeInstanceOf(ContentExportError);
  });
});
