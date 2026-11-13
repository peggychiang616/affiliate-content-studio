import "server-only";
import type { TransactionalSqlDatabase } from "../db/queryable";
import type { ProductRecord } from "../products/readiness";
import { evaluateProductReadiness } from "../products/readiness";
import { listProductsForOwner } from "../products/repository";
import type {
  ProviderAdapters,
  RenderedArtifact,
  SubtitleCue,
} from "../providers/adapters";

const videoDurationSeconds = 20;
const maximumSubtitleCharacters = 18;
const maximumSubtitleCount = 20;
const maximumAudioVideoOffsetMilliseconds = 300;

export type VideoSourceRevision = {
  productSourceVersion: string;
  sourceFactKeys: string[];
  script: string;
  subtitles: string[];
  isSynthetic: boolean;
};

export type VideoTemplate = {
  productId: string;
  authorizedAssetId: string;
  authorizedAssetUri: string;
  script: string;
  voice: string;
  language: "zh-TW";
  format: "mp4";
  durationSeconds: 20;
  width: 1080;
  height: 1920;
  subtitleCues: SubtitleCue[];
};

export type VideoOutputIssue =
  | "missing_media_uri"
  | "not_playable"
  | "invalid_format"
  | "invalid_duration"
  | "invalid_dimensions"
  | "missing_audio"
  | "subtitle_outside_safe_area"
  | "audio_video_out_of_sync"
  | "synthetic_output";

export type VideoOutputValidation = {
  valid: boolean;
  issues: VideoOutputIssue[];
};

export class VideoTemplateError extends Error {
  constructor(
    readonly code:
      | "product_not_ready"
      | "source_version_changed"
      | "unsupported_fact"
      | "missing_script"
      | "invalid_voice"
      | "subtitle_density"
      | "revision_not_renderable",
    message: string,
  ) {
    super(message);
    this.name = "VideoTemplateError";
  }
}

export class VideoOutputValidationError extends Error {
  constructor(readonly issues: VideoOutputIssue[]) {
    super(`Video rendering failed output validation: ${issues.join(", ")}.`);
    this.name = "VideoOutputValidationError";
  }
}

function wrapSubtitle(text: string): string[] {
  const characters = Array.from(text.trim());
  const lines: string[] = [];

  for (let index = 0; index < characters.length; index += maximumSubtitleCharacters) {
    lines.push(characters.slice(index, index + maximumSubtitleCharacters).join(""));
  }
  return lines;
}

function createSubtitleCues(subtitles: string[]): SubtitleCue[] {
  const lines = subtitles.flatMap(wrapSubtitle).filter((line) => line.length > 0);
  if (
    lines.length === 0 ||
    lines.length > maximumSubtitleCount ||
    videoDurationSeconds / lines.length < 1
  ) {
    throw new VideoTemplateError(
      "subtitle_density",
      "字幕內容過多或為空，無法在短片安全區域內清楚呈現。",
    );
  }

  const cueDuration = videoDurationSeconds / lines.length;
  return lines.map((text, index) => ({
    text,
    startSeconds: Number((index * cueDuration).toFixed(2)),
    endSeconds: Number(((index + 1) * cueDuration).toFixed(2)),
    alignment: "center",
    horizontalPositionPercent: 50,
    bottomPositionPercent: 18,
  }));
}

export function createVideoTemplate(
  product: ProductRecord,
  revision: VideoSourceRevision,
  voice: string,
  now: Date = new Date(),
): VideoTemplate {
  if (revision.productSourceVersion !== product.source.version) {
    throw new VideoTemplateError(
      "source_version_changed",
      "商品來源版本已變更，無法沿用舊版腳本製作影片。",
    );
  }
  if (!revision.script.trim()) {
    throw new VideoTemplateError(
      "missing_script",
      "影片需要有效的旁白腳本。",
    );
  }
  if (!voice.trim()) {
    throw new VideoTemplateError(
      "invalid_voice",
      "請先設定有效的繁體中文配音語氣。",
    );
  }

  const readiness = evaluateProductReadiness(product, now);
  if (!readiness.ready) {
    throw new VideoTemplateError(
      "product_not_ready",
      `商品或素材權利尚未就緒：${readiness.reasons.join(", ")}`,
    );
  }

  const sourceFacts = new Map(
    product.facts
      .filter((fact) => fact.sourceVersion === revision.productSourceVersion)
      .map((fact) => [fact.key, fact]),
  );
  if (
    revision.sourceFactKeys.length === 0 ||
    revision.sourceFactKeys.some((key) => !sourceFacts.has(key))
  ) {
    throw new VideoTemplateError(
      "unsupported_fact",
      "腳本引用的商品事實已不在目前核實來源版本中。",
    );
  }

  const asset = readiness.usableAssets[0];
  if (!asset) {
    throw new VideoTemplateError(
      "product_not_ready",
      "找不到權利涵蓋剪輯與商業匯出的商品素材。",
    );
  }

  return {
    productId: product.id,
    authorizedAssetId: asset.id,
    authorizedAssetUri: asset.sourceUri,
    script: revision.script,
    voice: voice.trim(),
    language: "zh-TW",
    format: "mp4",
    durationSeconds: videoDurationSeconds,
    width: 1080,
    height: 1920,
    subtitleCues: createSubtitleCues(revision.subtitles),
  };
}

export function validateRenderedArtifact(
  artifact: RenderedArtifact,
  productionEligible: boolean,
): VideoOutputValidation {
  const issues: VideoOutputIssue[] = [];

  if (!artifact.mediaUri.trim()) issues.push("missing_media_uri");
  if (!artifact.playable) issues.push("not_playable");
  if (artifact.mediaType !== "video/mp4") issues.push("invalid_format");
  if (
    !Number.isFinite(artifact.durationSeconds) ||
    artifact.durationSeconds < 15 ||
    artifact.durationSeconds > 30
  ) {
    issues.push("invalid_duration");
  }
  if (artifact.width !== 1080 || artifact.height !== 1920) {
    issues.push("invalid_dimensions");
  }
  if (!artifact.audioPresent) issues.push("missing_audio");
  if (!artifact.subtitlesWithinSafeArea) {
    issues.push("subtitle_outside_safe_area");
  }
  if (
    !Number.isFinite(artifact.maxAudioVideoOffsetMilliseconds) ||
    artifact.maxAudioVideoOffsetMilliseconds < 0 ||
    artifact.maxAudioVideoOffsetMilliseconds >
      maximumAudioVideoOffsetMilliseconds
  ) {
    issues.push("audio_video_out_of_sync");
  }
  if (!productionEligible) issues.push("synthetic_output");

  return { valid: issues.length === 0, issues };
}

export async function renderVideoTemplate(
  template: VideoTemplate,
  adapters: ProviderAdapters,
  sourceIsSynthetic: boolean,
): Promise<{
  artifact: RenderedArtifact;
  productionEligible: boolean;
}> {
  const speech = await adapters.speech.synthesize(
    { text: template.script, voice: template.voice },
    AbortSignal.timeout(30_000),
  );
  const rendered = await adapters.rendering.render(
    {
      ...template,
      audioUri: speech.data.audioUri,
    },
    AbortSignal.timeout(30_000),
  );
  const productionEligible =
    speech.productionEligible &&
    rendered.productionEligible &&
    !sourceIsSynthetic;
  const validation = validateRenderedArtifact(
    rendered.data,
    productionEligible,
  );

  if (!validation.valid) {
    throw new VideoOutputValidationError(validation.issues);
  }

  return {
    artifact: rendered.data,
    productionEligible,
  };
}

export async function saveValidatedVideoArtifact(
  database: TransactionalSqlDatabase,
  input: {
    ownerId: string;
    groupId: string;
    revisionId: string;
    productSourceVersion: string;
    sourceAssetId: string;
    artifact: RenderedArtifact;
    productionEligible: boolean;
    now?: Date;
  },
): Promise<string> {
  const validation = validateRenderedArtifact(
    input.artifact,
    input.productionEligible,
  );
  if (!validation.valid) {
    throw new VideoOutputValidationError(validation.issues);
  }

  const client = await database.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const revisionResult = await client.query<{
      product_id: string;
      product_source_version: string;
      is_synthetic: boolean;
      group_status: string;
      latest_revision_id: string;
    }>(
      `
        SELECT
          g.product_id::text, r.product_source_version, r.is_synthetic,
          g.status AS group_status,
          (
            SELECT latest.id::text
            FROM content_revisions latest
            WHERE latest.owner_id = r.owner_id AND latest.group_id = r.group_id
            ORDER BY latest.revision DESC
            LIMIT 1
          ) AS latest_revision_id
        FROM content_revisions r
        JOIN content_groups g
          ON g.owner_id = r.owner_id AND g.id = r.group_id
        WHERE r.owner_id = $1 AND g.id = $2 AND r.id = $3
        FOR UPDATE OF r, g
      `,
      [input.ownerId, input.groupId, input.revisionId],
    );
    const revision = revisionResult.rows[0];
    if (!revision) {
      throw new VideoTemplateError(
        "source_version_changed",
        "找不到可製作影片的內容版本。",
      );
    }
    if (
      revision.group_status !== "awaiting_review" ||
      revision.latest_revision_id !== input.revisionId
    ) {
      throw new VideoTemplateError(
        "revision_not_renderable",
        "只有待審閱的最新內容版本可以製作影片。",
      );
    }
    if (
      revision.is_synthetic ||
      revision.product_source_version !== input.productSourceVersion
    ) {
      throw new VideoTemplateError(
        "source_version_changed",
        "內容版本為合成示意或商品來源版本已變更。",
      );
    }

    const products = await listProductsForOwner(client, input.ownerId);
    const product = products.find((candidate) => candidate.id === revision.product_id);
    const readiness = product
      ? evaluateProductReadiness(product, input.now)
      : null;
    if (
      !product ||
      product.source.version !== input.productSourceVersion ||
      !readiness?.ready ||
      !readiness.usableAssets.some(
        (asset) => asset.id === input.sourceAssetId,
      )
    ) {
      throw new VideoTemplateError(
        "product_not_ready",
        "影片素材的商品權利或來源版本已失效。",
      );
    }

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO content_video_artifacts (
          owner_id, group_id, revision_id, source_asset_id,
          product_source_version, media_uri, media_type, duration_seconds,
          width, height, playable, audio_present, subtitles_within_safe_area,
          max_audio_video_offset_ms, is_synthetic
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false)
        RETURNING id::text
      `,
      [
        input.ownerId,
        input.groupId,
        input.revisionId,
        input.sourceAssetId,
        input.productSourceVersion,
        input.artifact.mediaUri,
        input.artifact.mediaType,
        input.artifact.durationSeconds,
        input.artifact.width,
        input.artifact.height,
        input.artifact.playable,
        input.artifact.audioPresent,
        input.artifact.subtitlesWithinSafeArea,
        input.artifact.maxAudioVideoOffsetMilliseconds,
      ],
    );
    const artifactId = inserted.rows[0]?.id;
    if (!artifactId) {
      throw new Error("Saving the validated video artifact returned no record.");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return artifactId;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("無法回滾影片素材交易。", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
