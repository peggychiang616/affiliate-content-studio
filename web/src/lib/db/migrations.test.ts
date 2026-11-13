import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlDatabase } from "./queryable";
import {
  getPreferencesForOwner,
  getPreferencesVersionForOwner,
  savePreferencesForOwner,
} from "../preferences/repository";

vi.mock("server-only", () => ({}));

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("PostgreSQL migrations", () => {
  it("creates owner-scoped product, fact, and rights records with integrity checks", async () => {
    const database = new PGlite();
    databases.push(database);

    const migrationDirectory = join(process.cwd(), "db", "migrations");
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();

    for (const file of migrationFiles) {
      await database.exec(
        await readFile(join(migrationDirectory, file), "utf8"),
      );
    }

    const { rows: principals } = await database.query<{ id: string }>(
      "INSERT INTO principals DEFAULT VALUES RETURNING id",
    );
    const ownerId = principals[0].id;
    const { rows: products } = await database.query<{ id: string }>(
      `
        INSERT INTO products (
          owner_id, source_provider, source_external_id, source_uri,
          source_version, source_checked_at, data_valid_until, title,
          eligibility_status
        )
        VALUES ($1, 'verified-source', 'item-1', 'https://example.test/item',
          'v1', now(), now() + interval '7 days', 'Item', 'eligible')
        RETURNING id
      `,
      [ownerId],
    );
    const productId = products[0].id;

    await database.query(
      `
        INSERT INTO product_facts (
          owner_id, product_id, fact_key, fact_value, source_reference,
          source_version, verified_at
        )
        VALUES ($1, $2, 'material', 'Cotton', 'https://example.test/item#material',
          'v1', now())
      `,
      [ownerId, productId],
    );
    await database.query(
      `
        INSERT INTO product_assets (
          owner_id, product_id, asset_type, source_uri, source_version,
          rights_provider, rights_status, allowed_uses, rights_verified_at
        )
        VALUES ($1, $2, 'image', 'https://assets.example.test/item.jpg', 'v1',
          'rights-holder', 'verified', ARRAY['video-edit', 'commercial-export'], now())
      `,
      [ownerId, productId],
    );

    const { rows: factCount } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM product_facts WHERE owner_id = $1 AND product_id = $2",
      [ownerId, productId],
    );
    expect(factCount[0].count).toBe("1");

    await expect(
      database.query(
        `
          INSERT INTO products (
            owner_id, source_provider, source_external_id, source_uri,
            source_version, source_checked_at, data_valid_until, title,
            eligibility_status, is_synthetic
          )
          VALUES ($1, 'fixture', 'synthetic-1', 'synthetic://item', 'v1',
            now(), now() + interval '7 days', 'Fixture', 'eligible', true)
        `,
        [ownerId],
      ),
    ).rejects.toThrow();
  });

  it("isolates persisted content preferences by owner and increments versions", async () => {
    const database = new PGlite();
    databases.push(database);
    const migrationDirectory = join(process.cwd(), "db", "migrations");
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();

    for (const file of migrationFiles) {
      await database.exec(
        await readFile(join(migrationDirectory, file), "utf8"),
      );
    }

    const { rows: principals } = await database.query<{ id: string }>(
      "INSERT INTO principals DEFAULT VALUES RETURNING id",
    );
    const firstOwner = principals[0].id;
    const secondOwner = "a187d639-a863-43a8-88d5-2fab990428e7";
    const preferenceDatabase: TransactionalSqlDatabase = {
      query: (text, values) => database.query(text, values),
      connect: async () => ({
        query: (text, values) => database.query(text, values),
        release: () => undefined,
      }),
    };

    const firstVersion = await savePreferencesForOwner(
      preferenceDatabase,
      firstOwner,
      {
        audience: "第一位使用者",
        topic: "居家生活",
        voice: "親切自然",
        defaultStyle: "簡潔溫暖",
      },
    );
    const secondVersion = await savePreferencesForOwner(
      preferenceDatabase,
      secondOwner,
      {
        audience: "第二位使用者",
        topic: "旅行用品",
        voice: "活潑直接",
        defaultStyle: "清爽明亮",
      },
    );
    const updatedVersion = await savePreferencesForOwner(
      preferenceDatabase,
      firstOwner,
      {
        audience: "第一位使用者的新偏好",
        topic: "居家生活",
        voice: "親切自然",
        defaultStyle: "簡潔溫暖",
      },
    );

    expect(firstVersion.version).toBe(1);
    expect(secondVersion.version).toBe(1);
    expect(updatedVersion.version).toBe(2);
    expect(await getPreferencesForOwner(preferenceDatabase, firstOwner)).toMatchObject({
      version: 2,
      audience: "第一位使用者的新偏好",
    });
    expect(await getPreferencesForOwner(preferenceDatabase, secondOwner)).toMatchObject({
      version: 1,
      audience: "第二位使用者",
    });
    expect(
      await getPreferencesVersionForOwner(preferenceDatabase, firstOwner, 1),
    ).toMatchObject({ audience: "第一位使用者" });
    expect(
      await getPreferencesForOwner(preferenceDatabase, "b49cd02a-e1da-48e7-9c2a-a87137595546"),
    ).toBeNull();
  });
});
