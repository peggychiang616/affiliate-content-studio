import "server-only";
import type { SqlQueryable, TransactionalSqlDatabase } from "../db/queryable";
import { getContentGroupForOwner } from "./workspace";
import { listProductsForOwner } from "../products/repository";
import { evaluateProductReadiness } from "../products/readiness";
import type { RenderedArtifact } from "../providers/adapters";
import { validateRenderedArtifact } from "./video";

const affiliateDisclosure =
  "本文含聯盟行銷連結；若透過連結購買，可能獲得分潤。";
const mediaLinkLifetimeSeconds = 300;

export type PrivateMediaLinkSigner = {
  sign(
    mediaUri: string,
    lifetimeSeconds: number,
  ): Promise<{ url: string; expiresAt: string }>;
};

export type ContentExportResult = {
  groupId: string;
  revisionId: string;
  caption: string;
  script: string;
  videoUrl: string;
  expiresAt: string;
  disclosure: {
    text: string;
    placement: "caption-footer";
  };
};

export class ContentExportError extends Error {
  constructor(
    readonly code:
      | "group_unavailable"
      | "revision_unavailable"
      | "product_not_ready"
      | "source_version_changed"
      | "unsupported_fact"
      | "video_unavailable"
      | "not_confirmed"
      | "confirmation_required"
      | "preview_required"
      | "invalid_request"
      | "media_signer_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ContentExportError";
  }
}

type ExportContext = {
  groupId: string;
  batchId: string;
  revisionId: string;
  revisionNumber: number;
  sourceVersion: string;
  caption: string;
  script: string;
  mediaUri: string;
  videoArtifactId: string;
  confirmedAt: string | null;
};

async function loadEligibleExportContext(
  queryable: SqlQueryable,
  ownerId: string,
  groupId: string,
  revisionId: string,
  now: Date,
): Promise<ExportContext> {
  const group = await getContentGroupForOwner(queryable, ownerId, groupId);
  if (!group) {
    throw new ContentExportError(
      "group_unavailable",
      "此內容組不存在或不屬於目前使用者。",
    );
  }
  const revision = group.revisions.find((item) => item.id === revisionId);
  if (!revision) {
    throw new ContentExportError(
      "revision_unavailable",
      "找不到要確認或匯出的內容版本。",
    );
  }
  if (revision.isSynthetic) {
    throw new ContentExportError(
      "product_not_ready",
      "合成示意內容不能確認或匯出為正式成果。",
    );
  }

  const products = await listProductsForOwner(queryable, ownerId);
  const product = products.find((item) => item.id === group.productId);
  if (!product) {
    throw new ContentExportError(
      "product_not_ready",
      "商品已不存在或不屬於目前使用者。",
    );
  }
  if (product.source.version !== revision.productSourceVersion) {
    throw new ContentExportError(
      "source_version_changed",
      "商品來源版本已變更，請重新核對並製作新的內容版本。",
    );
  }

  const readiness = evaluateProductReadiness(product, now);
  if (!readiness.ready) {
    throw new ContentExportError(
      "product_not_ready",
      `商品資料或素材權利已失效：${readiness.reasons.join(", ")}`,
    );
  }
  const currentFacts = new Map(
    product.facts.map((fact) => [`${fact.sourceVersion}:${fact.key}`, fact]),
  );
  if (
    revision.sourceFacts.length === 0 ||
    revision.sourceFacts.some((fact) => {
      const current = currentFacts.get(
        `${revision.productSourceVersion}:${fact.key}`,
      );
      return (
        !current ||
        current.value !== fact.value ||
        current.sourceReference !== fact.sourceReference
      );
    })
  ) {
    throw new ContentExportError(
      "unsupported_fact",
      "本版本引用的商品事實已不符合目前核實資料，請重新製作。",
    );
  }

  const artifactResult = await queryable.query<{
    id: string;
    media_uri: string;
    media_type: string;
    duration_seconds: number | string;
    width: number;
    height: number;
    playable: boolean;
    audio_present: boolean;
    subtitles_within_safe_area: boolean;
    max_audio_video_offset_ms: number;
    is_synthetic: boolean;
    source_asset_id: string;
    product_source_version: string;
  }>(
    `
      SELECT
        id::text, media_uri, media_type, duration_seconds, width, height, playable,
        audio_present, subtitles_within_safe_area, max_audio_video_offset_ms,
        is_synthetic, source_asset_id::text, product_source_version
      FROM content_video_artifacts
      WHERE owner_id = $1 AND group_id = $2 AND revision_id = $3
    `,
    [ownerId, groupId, revisionId],
  );
  const artifactRow = artifactResult.rows[0];
  if (!artifactRow) {
    throw new ContentExportError(
      "video_unavailable",
      "此版本沒有通過檢查的影片，暫時無法確認或匯出。",
    );
  }
  if (
    artifactRow.product_source_version !== revision.productSourceVersion ||
    !readiness.usableAssets.some(
      (asset) => asset.id === artifactRow.source_asset_id,
    )
  ) {
    throw new ContentExportError(
      "product_not_ready",
      "影片使用的商品素材權利已失效或不再符合目前來源版本。",
    );
  }

  const artifact: RenderedArtifact = {
    mediaUri: artifactRow.media_uri,
    mediaType: artifactRow.media_type,
    durationSeconds: Number(artifactRow.duration_seconds),
    width: artifactRow.width,
    height: artifactRow.height,
    playable: artifactRow.playable,
    audioPresent: artifactRow.audio_present,
    subtitlesWithinSafeArea: artifactRow.subtitles_within_safe_area,
    maxAudioVideoOffsetMilliseconds: artifactRow.max_audio_video_offset_ms,
  };
  const validation = validateRenderedArtifact(
    artifact,
    !artifactRow.is_synthetic && !revision.isSynthetic,
  );
  if (!validation.valid) {
    throw new ContentExportError(
      "video_unavailable",
      `影片未通過輸出檢查：${validation.issues.join(", ")}。`,
    );
  }

  const review = await queryable.query<{ confirmed_at: Date | string }>(
    `
      SELECT confirmed_at
      FROM content_revision_reviews
      WHERE owner_id = $1 AND group_id = $2 AND revision_id = $3
    `,
    [ownerId, groupId, revisionId],
  );

  return {
    groupId,
    batchId: group.batchId,
    revisionId,
    revisionNumber: revision.revision,
    sourceVersion: revision.productSourceVersion,
    caption: revision.caption,
    script: revision.script,
    mediaUri: artifact.mediaUri,
    videoArtifactId: artifactRow.id,
    confirmedAt: review.rows[0]
      ? new Date(review.rows[0].confirmed_at).toISOString()
      : null,
  };
}

function validateRequestKey(requestKey: string): void {
  if (requestKey.trim().length < 8 || requestKey.length > 128) {
    throw new ContentExportError(
      "invalid_request",
      "請求需要有效的冪等識別碼。",
    );
  }
}

function validateSignedLink(
  signer: PrivateMediaLinkSigner,
  mediaUri: string,
  now: Date,
): Promise<{ url: string; expiresAt: string }> {
  return signer.sign(mediaUri, mediaLinkLifetimeSeconds).then((link) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(link.url);
    } catch {
      throw new ContentExportError(
        "media_signer_unavailable",
        "私有媒體服務未回傳有效的短效下載連結。",
      );
    }
    const expiresAt = new Date(link.expiresAt);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username.length > 0 ||
      parsedUrl.password.length > 0 ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt <= now ||
      expiresAt.getTime() > now.getTime() + mediaLinkLifetimeSeconds * 1_000
    ) {
      throw new ContentExportError(
        "media_signer_unavailable",
        "私有媒體服務未回傳有效的短效下載連結。",
      );
    }
    return { url: parsedUrl.toString(), expiresAt: expiresAt.toISOString() };
  });
}

export async function createContentPreviewLink(
  database: TransactionalSqlDatabase,
  input: {
    ownerId: string;
    groupId: string;
    revisionId: string;
    signer: PrivateMediaLinkSigner | null;
    now?: Date;
  },
): Promise<{ videoUrl: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const context = await loadEligibleExportContext(
    database,
    input.ownerId,
    input.groupId,
    input.revisionId,
    now,
  );
  if (!input.signer) {
    throw new ContentExportError(
      "media_signer_unavailable",
      "目前沒有已核准的私有媒體預覽服務。",
    );
  }
  const link = await validateSignedLink(input.signer, context.mediaUri, now);

  const client = await database.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      "SELECT id FROM content_groups WHERE owner_id = $1 AND id = $2 FOR UPDATE",
      [input.ownerId, input.groupId],
    );
    const currentContext = await loadEligibleExportContext(
      client,
      input.ownerId,
      input.groupId,
      input.revisionId,
      now,
    );
    if (currentContext.videoArtifactId !== context.videoArtifactId) {
      throw new ContentExportError(
        "video_unavailable",
        "影片已更新，請重新載入預覽。",
      );
    }
    await client.query(
      `
        INSERT INTO content_revision_previews (
          owner_id, group_id, revision_id, previewed_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (owner_id, revision_id)
        DO UPDATE SET previewed_at = EXCLUDED.previewed_at
      `,
      [input.ownerId, input.groupId, input.revisionId, now],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return { videoUrl: link.url, expiresAt: link.expiresAt };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容預覽交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmContentRevision(
  database: TransactionalSqlDatabase,
  input: {
    ownerId: string;
    groupId: string;
    revisionId: string;
    requestKey: string;
    confirmed: boolean;
    now?: Date;
  },
): Promise<{ revisionId: string; confirmedAt: string; idempotentReplay: boolean }> {
  validateRequestKey(input.requestKey);
  if (!input.confirmed) {
    throw new ContentExportError(
      "confirmation_required",
      "請先確認已預覽此版本、商品事實與素材使用權。",
    );
  }

  const now = input.now ?? new Date();
  const client = await database.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      "SELECT id FROM content_groups WHERE owner_id = $1 AND id = $2 FOR UPDATE",
      [input.ownerId, input.groupId],
    );
    const context = await loadEligibleExportContext(
      client,
      input.ownerId,
      input.groupId,
      input.revisionId,
      now,
    );
    if (context.confirmedAt) {
      await client.query("COMMIT");
      inTransaction = false;
      return {
        revisionId: context.revisionId,
        confirmedAt: context.confirmedAt,
        idempotentReplay: true,
      };
    }

    const preview = await client.query<{ previewed_at: Date | string }>(
      `
        SELECT previewed_at
        FROM content_revision_previews
        WHERE owner_id = $1 AND group_id = $2 AND revision_id = $3
      `,
      [input.ownerId, input.groupId, input.revisionId],
    );
    const previewedAt = preview.rows[0]?.previewed_at;
    const previewedAtTime = previewedAt
      ? new Date(previewedAt).getTime()
      : Number.NaN;
    if (
      !Number.isFinite(previewedAtTime) ||
      previewedAtTime > now.getTime() ||
      now.getTime() - previewedAtTime > mediaLinkLifetimeSeconds * 1_000
    ) {
      throw new ContentExportError(
        "preview_required",
        "請先載入此版本的短片預覽，再進行確認。",
      );
    }

    await client.query(
      `
        INSERT INTO content_revision_reviews (
          owner_id, group_id, revision_id
        )
        VALUES ($1, $2, $3)
      `,
      [input.ownerId, input.groupId, input.revisionId],
    );
    await client.query(
      `
        INSERT INTO content_events (
          owner_id, batch_id, event_type, idempotency_key, details
        )
        VALUES ($1, $2, 'content.confirmed', $3, $4::jsonb)
        ON CONFLICT (owner_id, idempotency_key) DO NOTHING
      `,
      [
        input.ownerId,
        context.batchId,
        `${input.groupId}:confirm:${input.requestKey}`,
        JSON.stringify({
          groupId: input.groupId,
          revisionId: input.revisionId,
          revision: context.revisionNumber,
        }),
      ],
    );
    await client.query(
      "UPDATE content_groups SET status = 'confirmed', failure_reason = NULL WHERE owner_id = $1 AND id = $2",
      [input.ownerId, input.groupId],
    );
    const confirmation = await client.query<{
      confirmed_at: Date | string;
    }>(
      `
        SELECT confirmed_at
        FROM content_revision_reviews
        WHERE owner_id = $1 AND revision_id = $2
      `,
      [input.ownerId, input.revisionId],
    );
    const confirmedAt = confirmation.rows[0]?.confirmed_at;
    if (!confirmedAt) throw new Error("Saving content confirmation returned no record.");

    await client.query("COMMIT");
    inTransaction = false;
    return {
      revisionId: input.revisionId,
      confirmedAt: new Date(confirmedAt).toISOString(),
      idempotentReplay: false,
    };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容確認交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function exportConfirmedContent(
  database: TransactionalSqlDatabase,
  input: {
    ownerId: string;
    groupId: string;
    revisionId: string;
    requestKey: string;
    signer: PrivateMediaLinkSigner | null;
    now?: Date;
  },
): Promise<ContentExportResult> {
  validateRequestKey(input.requestKey);
  const now = input.now ?? new Date();
  const context = await loadEligibleExportContext(
    database,
    input.ownerId,
    input.groupId,
    input.revisionId,
    now,
  );
  if (!context.confirmedAt) {
    throw new ContentExportError(
      "not_confirmed",
      "請先預覽並確認此內容版本，再匯出。",
    );
  }
  if (!input.signer) {
    throw new ContentExportError(
      "media_signer_unavailable",
      "目前沒有已核准的私有媒體下載服務，無法產生授權下載連結。",
    );
  }

  const signedLink = await validateSignedLink(
    input.signer,
    context.mediaUri,
    now,
  );
  const expiresAt = new Date(signedLink.expiresAt);

  const client = await database.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(
      "SELECT id FROM content_groups WHERE owner_id = $1 AND id = $2 FOR UPDATE",
      [input.ownerId, input.groupId],
    );
    const currentContext = await loadEligibleExportContext(
      client,
      input.ownerId,
      input.groupId,
      input.revisionId,
      now,
    );
    if (!currentContext.confirmedAt) {
      throw new ContentExportError(
        "not_confirmed",
        "內容確認已失效，請重新預覽並確認後再匯出。",
      );
    }

    await client.query(
      `
        INSERT INTO content_events (
          owner_id, batch_id, event_type, idempotency_key, details
        )
        VALUES ($1, $2, 'content.exported', $3, $4::jsonb)
        ON CONFLICT (owner_id, idempotency_key) DO NOTHING
      `,
      [
        input.ownerId,
        currentContext.batchId,
        `${input.groupId}:export:${input.requestKey}`,
        JSON.stringify({
          groupId: input.groupId,
          revisionId: input.revisionId,
        }),
      ],
    );
    await client.query(
      "UPDATE content_groups SET status = 'exported' WHERE owner_id = $1 AND id = $2",
      [input.ownerId, input.groupId],
    );
    await client.query("COMMIT");
    inTransaction = false;

    const caption = currentContext.caption.includes(affiliateDisclosure)
      ? currentContext.caption
      : `${currentContext.caption}\n\n${affiliateDisclosure}`;
    return {
      groupId: input.groupId,
      revisionId: input.revisionId,
      caption,
      script: currentContext.script,
      videoUrl: signedLink.url,
      expiresAt: expiresAt.toISOString(),
      disclosure: {
        text: affiliateDisclosure,
        placement: "caption-footer",
      },
    };
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾內容匯出交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
