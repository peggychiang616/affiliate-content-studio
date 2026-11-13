import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to apply PostgreSQL migrations.");
}

const pool = new pg.Pool({ connectionString, max: 1 });
let client;

try {
  client = await pool.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationDirectory = join(process.cwd(), "db", "migrations");
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();

  for (const file of migrationFiles) {
    const [version] = file.split("_");
    const { rowCount } = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version],
    );

    if (rowCount) continue;

    const sql = await readFile(join(migrationDirectory, file), "utf8");
    await client.query("BEGIN");

    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        version,
      ]);
      await client.query("COMMIT");
      console.info(`Applied migration ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
