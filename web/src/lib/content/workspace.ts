import "server-only";
import type {
  SqlQueryable,
  TransactionalSqlDatabase,
} from "../db/queryable";
import type { ProductFact } from "../products/readiness";

type RevisionRow = {
  id: string;
  job_id: string;
  revision: number;
  parent_revision_id: string | null;
  product_source_version: string;
  preference_version: number;
  source_facts: ProductFact[];
  caption: string;
  script: string;
  subtitles: string[];
  style: string;
  is_synthetic: boolean;
  has_video_artifact?: boolean;
  confirmed_at?: Date | string | null;
  created_at: Date | string;
};

type AttemptRow = {
  id: string;
  attempt: number;
  status: string;
  failure_code: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
};

export type ContentRevisionView = {
  id: string;
  revision: number;
  parentRevisionId: string | null;
  productSourceVersion: string;
  preferenceVersion: number;
  sourceFacts: ProductFact[];
  caption: string;
  script: string;
  subtitles: string[];
  style: string;
  isSynthetic: boolean;
  hasVideoArtifact: boolean;
  confirmedAt: string | null;
  createdAt: string;
};

export type ContentAttemptView = {
  id: string;
  attempt: number;
  status: string;
  failureCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type ContentGroupWorkspace = {
  id: string;
  batchId: string;
  productId: string;
  productTitle: string;
  variantIndex: number;
  status: string;
  failureReason: string | null;
  createdAt: string;
  revisions: ContentRevisionView[];
  attempts: ContentAttemptView[];
};

export class ContentWorkspaceError extends Error {
  constructor(
    readonly code:
      | "group_unavailable"
      | "revision_unavailable"
      | "revision_not_editable"
      | "invalid_edit"
      | "attempt_not_allowed"
      | "stale_revision",
    message: string,
  ) {
    super(message);
    this.name = "ContentWorkspaceError";
  }
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Content workspace returned an invalid timestamp.");
  }
  return date.toISOString();
}

function toRevisionView(row: RevisionRow): ContentRevisionView {
  return {
    id: row.id,
    revision: row.revision,
    parentRevisionId: row.parent_revision_id,
    productSourceVersion: row.product_source_version,
    preferenceVersion: row.preference_version,
    sourceFacts: row.source_facts,
    caption: row.caption,
    script: row.script,
    subtitles: row.subtitles,
    style: row.style,
    isSynthetic: row.is_synthetic,
    hasVideoArtifact: row.has_video_artifact ?? false,
    confirmedAt: row.confirmed_at ? toIso(row.confirmed_at) : null,
    createdAt: toIso(row.created_at),
  };
}

function toAttemptView(row: AttemptRow): ContentAttemptView {
  return {
    id: row.id,
    attempt: row.attempt,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
  };
}

async function loadGroupWorkspace(
  queryable: SqlQueryable,
  ownerId: string,
  groupId: string,
): Promise<ContentGroupWorkspace | null> {
  const result = await queryable.query<{
    id: string;
    batch_id: string;
    product_id: string;
    product_title: string;
    variant_index: number;
    status: string;
    failure_reason: string | null;
    created_at: Date | string;
  }>(
    `
      SELECT
        g.id::text, g.batch_id::text, g.product_id::text, p.title AS product_title,
        g.variant_index, g.status, g.failure_reason, g.created_at
      FROM content_groups g
      JOIN products p ON p.owner_id = g.owner_id AND p.id = g.product_id
      WHERE g.owner_id = $1 AND g.id = $2
    `,
    [ownerId, groupId],
  );
  const group = result.rows[0];
  if (!group) return null;

  const [revisionResult, attemptResult] = await Promise.all([
    queryable.query<RevisionRow>(
      `
        SELECT
          id::text, job_id::text, revision, parent_revision_id::text, product_source_version,
          preference_version, source_facts, caption, script, subtitles, style,
          is_synthetic,
          EXISTS (
            SELECT 1 FROM content_video_artifacts v
            WHERE v.owner_id = content_revisions.owner_id
              AND v.revision_id = content_revisions.id
              AND NOT v.is_synthetic
          ) AS has_video_artifact,
          (
            SELECT confirmed_at FROM content_revision_reviews r
            WHERE r.owner_id = content_revisions.owner_id
              AND r.revision_id = content_revisions.id
          ) AS confirmed_at,
          created_at
        FROM content_revisions
        WHERE owner_id = $1 AND group_id = $2
        ORDER BY revision DESC
      `,
      [ownerId, groupId],
    ),
    queryable.query<AttemptRow>(
      `
        SELECT id::text, attempt, status, failure_code, created_at, finished_at
        FROM content_jobs
        WHERE owner_id = $1 AND group_id = $2
        ORDER BY attempt DESC
      `,
      [ownerId, groupId],
    ),
  ]);

  return {
    id: group.id,
    batchId: group.batch_id,
    productId: group.product_id,
    productTitle: group.product_title,
    variantIndex: group.variant_index,
    status: group.status,
    failureReason: group.failure_reason,
    createdAt: toIso(group.created_at),
    revisions: revisionResult.rows.map(toRevisionView),
    attempts: attemptResult.rows.map(toAttemptView),
  };
}

export async function listContentGroupsForOwner(
  queryable: SqlQueryable,
  ownerId: string,
): Promise<ContentGroupWorkspace[]> {
  const result = await queryable.query<{ id: string }>(
    `
      SELECT id::text
      FROM content_groups
      WHERE owner_id = $1
      ORDER BY created_at DESC, id
      LIMIT 100
    `,
    [ownerId],
  );
  const groups = await Promise.all(
    result.rows.map(({ id }) => loadGroupWorkspace(queryable, ownerId, id)),
  );
  return groups.flatMap((group) => (group ? [group] : []));
}

export async function getContentGroupForOwner(
  queryable: SqlQueryable,
  ownerId: string,
  groupId: string,
): Promise<ContentGroupWorkspace | null> {
  return loadGroupWorkspace(queryable, ownerId, groupId);
}

export type EditContentRevisionInput = {
  ownerId: string;
  groupId: string;
  parentRevisionId: string;
  requestKey: string;
  caption: string;
  script: string;
  style: string;
};

function validateEdit(input: EditContentRevisionInput): void {
  if (
    input.caption.trim().length === 0 ||
    input.caption.trim().length > 2_000 ||
    input.script.trim().length === 0 ||
    input.script.trim().length > 4_000 ||
    input.style.trim().length < 2 ||
    input.style.trim().length > 80 ||
    input.requestKey.trim().length < 8 ||
    input.requestKey.length > 128
  ) {
    throw new ContentWorkspaceError(
      "invalid_edit",
      "文字、腳本、風格或冪等識別碼格式不正確。",
    );
  }
}

export async function editContentRevision(
  database: TransactionalSqlDatabase,
  input: EditContentRevisionInput,
): Promise<ContentRevisionView> {
  validateEdit(input);
  const client = await database.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    const groupResult = await client.query<{ status: string }>(
      "SELECT status FROM content_groups WHERE owner_id = $1 AND id = $2 FOR UPDATE",
      [input.ownerId, input.groupId],
    );
    const group = groupResult.rows[0];
    if (!group) {
      throw new ContentWorkspaceError(
        "group_unavailable",
        "此內容組不存在或不屬於目前使用者。",
      );
    }

    const idempotencyKey = `${input.groupId}:edit:${input.requestKey}`;
    const replay = await client.query<{ details: { revisionId?: string } }>(
      `
        SELECT details
        FROM content_events
        WHERE owner_id = $1 AND idempotency_key = $2
      `,
      [input.ownerId, idempotencyKey],
    );
    if (replay.rows[0]?.details.revisionId) {
      const existing = await client.query<RevisionRow>(
        `
          SELECT
            id::text, job_id::text, revision, parent_revision_id::text, product_source_version,
            preference_version, source_facts, caption, script, subtitles, style,
            is_synthetic, created_at
          FROM content_revisions
          WHERE owner_id = $1 AND group_id = $2 AND id = $3
        `,
        [input.ownerId, input.groupId, replay.rows[0].details.revisionId],
      );
      const revision = existing.rows[0];
      if (!revision) {
        throw new Error("An edit event references a missing content revision.");
      }
      await client.query("COMMIT");
      inTransaction = false;
      return toRevisionView(revision);
    }

    if (group.status !== "awaiting_review") {
      throw new ContentWorkspaceError(
        "revision_not_editable",
        "只有待審閱的內容組可以修改。",
      );
    }

    const parentResult = await client.query<RevisionRow>(
      `
        SELECT
          id::text, job_id::text, revision, parent_revision_id::text, product_source_version,
          preference_version, source_facts, caption, script, subtitles, style,
          is_synthetic, created_at
        FROM content_revisions
        WHERE owner_id = $1 AND group_id = $2 AND id = $3
      `,
      [input.ownerId, input.groupId, input.parentRevisionId],
    );
    const parent = parentResult.rows[0];
    if (!parent) {
      throw new ContentWorkspaceError(
        "revision_unavailable",
        "找不到要修改的內容版本。",
      );
    }

    const nextVersion = await client.query<{ revision: number }>(
      `
        SELECT COALESCE(MAX(revision), 0) + 1 AS revision
        FROM content_revisions
        WHERE owner_id = $1 AND group_id = $2
      `,
      [input.ownerId, input.groupId],
    );
    const revisionNumber = nextVersion.rows[0]?.revision;
    if (!revisionNumber) {
      throw new Error("Could not allocate an edited content revision.");
    }
    const caption = input.caption.trim();
    const script = input.script.trim();
    const subtitles = script
      .split(/[\n。！？!?]+/u)
      .map((line) => line.trim())
      .filter(Boolean);

    const inserted = await client.query<RevisionRow>(
      `
        INSERT INTO content_revisions (
          owner_id, group_id, job_id, revision, parent_revision_id,
          product_source_version, preference_version, source_facts,
          caption, script, subtitles, style, is_synthetic
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
        RETURNING
          id::text, job_id::text, revision, parent_revision_id::text, product_source_version,
          preference_version, source_facts, caption, script, subtitles, style,
          is_synthetic, created_at
      `,
      [
        input.ownerId,
        input.groupId,
        parent.job_id,
        revisionNumber,
        parent.id,
        parent.product_source_version,
        parent.preference_version,
        JSON.stringify(parent.source_facts),
        caption,
        script,
        subtitles,
        input.style.trim(),
        parent.is_synthetic,
      ],
    );
    const revision = inserted.rows[0];
    if (!revision) throw new Error("Saving edited content returned no record.");

    await client.query(
      `
        INSERT INTO content_events (
          owner_id, batch_id, event_type, idempotency_key, details
        )
        SELECT $1, batch_id, 'content.edited', $3, $4::jsonb
        FROM content_groups
        WHERE owner_id = $1 AND id = $2
      `,
      [
        input.ownerId,
        input.groupId,
        idempotencyKey,
        JSON.stringify({
          revisionId: revision.id,
          parentRevisionId: parent.id,
        }),
      ],
    );
    await client.query(
      "UPDATE content_groups SET failure_reason = NULL WHERE owner_id = $1 AND id = $2",
      [input.ownerId, input.groupId],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return toRevisionView(revision);
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容版本修改交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export type ContentGroupAttemptAction = "retry" | "regenerate";

export type ContentGroupAttemptRequest = {
  ownerId: string;
  groupId: string;
  action: ContentGroupAttemptAction;
  requestKey: string;
  expectedRevisionId?: string;
};

export type ContentGroupAttemptResult = {
  jobId: string;
  attempt: number;
  status: string;
  idempotentReplay: boolean;
};

export async function requestContentGroupAttempt(
  database: TransactionalSqlDatabase,
  input: ContentGroupAttemptRequest,
): Promise<ContentGroupAttemptResult> {
  if (input.requestKey.trim().length < 8 || input.requestKey.length > 128) {
    throw new ContentWorkspaceError(
      "invalid_edit",
      "請求需要有效的冪等識別碼。",
    );
  }
  const client = await database.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    const groupResult = await client.query<{
      status: string;
      batch_id: string;
    }>(
      "SELECT status, batch_id::text FROM content_groups WHERE owner_id = $1 AND id = $2 FOR UPDATE",
      [input.ownerId, input.groupId],
    );
    const group = groupResult.rows[0];
    if (!group) {
      throw new ContentWorkspaceError(
        "group_unavailable",
        "此內容組不存在或不屬於目前使用者。",
      );
    }

    const idempotencyKey = `${input.groupId}:${input.action}:${input.requestKey}`;
    const existing = await client.query<{
      id: string;
      attempt: number;
      status: string;
    }>(
      `
        SELECT id::text, attempt, status
        FROM content_jobs
        WHERE owner_id = $1 AND idempotency_key = $2
      `,
      [input.ownerId, idempotencyKey],
    );
    if (existing.rows[0]) {
      const job = existing.rows[0];
      await client.query("COMMIT");
      inTransaction = false;
      return {
        jobId: job.id,
        attempt: job.attempt,
        status: job.status,
        idempotentReplay: true,
      };
    }

    const latestJobResult = await client.query<{
      id: string;
      attempt: number;
      status: string;
    }>(
      `
        SELECT id::text, attempt, status
        FROM content_jobs
        WHERE owner_id = $1 AND group_id = $2
        ORDER BY attempt DESC
        LIMIT 1
      `,
      [input.ownerId, input.groupId],
    );
    const latestJob = latestJobResult.rows[0];
    if (!latestJob) {
      throw new ContentWorkspaceError(
        "attempt_not_allowed",
        "此內容組沒有可重試或重新製作的工作。",
      );
    }

    if (
      input.action === "retry" &&
      (group.status !== "failed" || latestJob.status !== "failed")
    ) {
      throw new ContentWorkspaceError(
        "attempt_not_allowed",
        "只有失敗的內容組可以局部重試。",
      );
    }
    if (
      input.action === "regenerate" &&
      (group.status !== "awaiting_review" || latestJob.status !== "succeeded")
    ) {
      throw new ContentWorkspaceError(
        "attempt_not_allowed",
        "只有已有可審閱成果的內容組可以重新製作。",
      );
    }

    if (input.action === "regenerate") {
      const revisionResult = await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM content_revisions
          WHERE owner_id = $1 AND group_id = $2
          ORDER BY revision DESC
          LIMIT 1
        `,
        [input.ownerId, input.groupId],
      );
      if (revisionResult.rows[0]?.id !== input.expectedRevisionId) {
        throw new ContentWorkspaceError(
          "stale_revision",
          "內容版本已更新，請重新載入後再嘗試重新製作。",
        );
      }
    }

    const attempt = latestJob.attempt + 1;
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO content_jobs (
          owner_id, group_id, attempt, idempotency_key, status
        )
        VALUES ($1, $2, $3, $4, 'queued')
        RETURNING id::text
      `,
      [input.ownerId, input.groupId, attempt, idempotencyKey],
    );
    const jobId = inserted.rows[0]?.id;
    if (!jobId) throw new Error("Creating a content attempt returned no record.");

    await client.query(
      "UPDATE content_groups SET status = 'queued', failure_reason = NULL WHERE owner_id = $1 AND id = $2",
      [input.ownerId, input.groupId],
    );
    await client.query(
      `
        INSERT INTO content_events (
          owner_id, batch_id, event_type, idempotency_key, details
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        input.ownerId,
        group.batch_id,
        input.action === "retry"
          ? "content.retry_requested"
          : "content.regeneration_requested",
        `${idempotencyKey}:requested`,
        JSON.stringify({ groupId: input.groupId, jobId, attempt }),
      ],
    );

    await client.query("COMMIT");
    inTransaction = false;
    return { jobId, attempt, status: "queued", idempotentReplay: false };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容組重試交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
