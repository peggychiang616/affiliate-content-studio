import "server-only";
import type {
  SqlQueryable,
  TransactionalSqlDatabase,
} from "../db/queryable";

export type ContentPreferences = {
  ownerId: string;
  version: number;
  audience: string;
  topic: string;
  voice: string;
  defaultStyle: string;
  createdAt: string;
};

export type ContentPreferencesInput = Omit<
  ContentPreferences,
  "ownerId" | "version" | "createdAt"
>;

type PreferenceRow = {
  owner_id: string;
  version: number;
  audience: string;
  topic: string;
  voice: string;
  default_style: string;
  created_at: Date | string;
};

function mapPreference(row: PreferenceRow): ContentPreferences {
  return {
    ownerId: row.owner_id,
    version: row.version,
    audience: row.audience,
    topic: row.topic,
    voice: row.voice,
    defaultStyle: row.default_style,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getPreferencesForOwner(
  pool: SqlQueryable,
  ownerId: string,
): Promise<ContentPreferences | null> {
  const result = await pool.query<PreferenceRow>(
    `
      SELECT owner_id::text, version, audience, topic, voice, default_style, created_at
      FROM user_preferences
      WHERE owner_id = $1
      ORDER BY version DESC
      LIMIT 1
    `,
    [ownerId],
  );

  return result.rows[0] ? mapPreference(result.rows[0]) : null;
}

export async function getPreferencesVersionForOwner(
  pool: SqlQueryable,
  ownerId: string,
  version: number,
): Promise<ContentPreferences | null> {
  const result = await pool.query<PreferenceRow>(
    `
      SELECT owner_id::text, version, audience, topic, voice, default_style, created_at
      FROM user_preferences
      WHERE owner_id = $1 AND version = $2
    `,
    [ownerId, version],
  );

  return result.rows[0] ? mapPreference(result.rows[0]) : null;
}

export async function savePreferencesForOwner(
  pool: TransactionalSqlDatabase,
  ownerId: string,
  input: ContentPreferencesInput,
): Promise<ContentPreferences> {
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      "INSERT INTO principals (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
      [ownerId],
    );
    await client.query("SELECT id FROM principals WHERE id = $1 FOR UPDATE", [
      ownerId,
    ]);

    const versionResult = await client.query<{ version: number }>(
      `
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM user_preferences
        WHERE owner_id = $1
      `,
      [ownerId],
    );
    const version = versionResult.rows[0]?.version;
    if (!version) throw new Error("Could not allocate a preference version.");

    const result = await client.query<PreferenceRow>(
      `
        INSERT INTO user_preferences (
          owner_id, version, audience, topic, voice, default_style
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING owner_id::text, version, audience, topic, voice, default_style, created_at
      `,
      [
        ownerId,
        version,
        input.audience,
        input.topic,
        input.voice,
        input.defaultStyle,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error("Saving content preferences returned no record.");
    await client.query("COMMIT");
    inTransaction = false;
    return mapPreference(row);
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾偏好設定交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
