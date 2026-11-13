import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;

export function getDatabasePool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database access.");
  }

  pool = new Pool({ connectionString, max: 10 });
  return pool;
}
