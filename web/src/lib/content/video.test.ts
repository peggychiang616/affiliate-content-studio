import { describe, expect, it, vi } from "vitest";
import type { ProductRecord } from "../products/readiness";
import {
  createFakeProviderAdapters,
  type ProviderAdapters,
  type RenderedArtifact,
} from "../providers/adapters";
import {
  createVideoTemplate,
  renderVideoTemplate,
  validateRenderedArtifact,
  VideoOutputValidationError,
  VideoTemplateError,
} from "./video";

vi.mock("server-only", () => ({}));

const now = new Date("2026-01-01T00:00:00.000Z");

function readyProduct(): ProductRecord {
  return {
    id: "product-1",
    ownerId: "owner-1",
    title: "棉質收納袋",
    source: {
      provider: "verified-provider",
      externalId: "external-1",
      uri: "https://source.example.test/item",
      version: "source-v1",
      checkedAt: "2025-12-01T00:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
    },
    eligibility: "eligible",
    provenance: "verified",
    facts: [
      {
        key: "material",
        value: "棉",
        sourceReference: "https://source.example.test/item#material",
        sourceVersion: "source-v1",
        verifiedAt: "2025-12-01T00:00:00.000Z",
      },
    ],
    assets: [
      {
        id: "asset-1",
        productId: "product-1",
        ownerId: "owner-1",
        type: "image",
        sourceUri: "https://assets.example.test/item.jpg",
        sourceVersion: "asset-v1",
        rightsProvider: "rights-holder",
        rightsStatus: "verified",
        allowedUses: ["video-edit", "commercial-export"],
        rightsVerifiedAt: "2025-12-01T00:00:00.000Z",
        rightsValidUntil: "2099-01-01T00:00:00.000Z",
        provenance: "verified",
      },
    ],
  };
}

const sourceRevision = {
  productSourceVersion: "source-v1",
  sourceFactKeys: ["material"],
  script: "材質：棉",
  subtitles: ["分享商品資料", "材質：棉"],
  isSynthetic: false,
};

const validArtifact: RenderedArtifact = {
  mediaUri: "https://private.example.test/rendered.mp4",
  mediaType: "video/mp4",
  durationSeconds: 20,
  width: 1080,
  height: 1920,
  playable: true,
  audioPresent: true,
  subtitlesWithinSafeArea: true,
  maxAudioVideoOffsetMilliseconds: 120,
};

describe("authorized video templates and output validation", () => {
  it("uses only verified product assets and lays out Traditional Chinese subtitles", () => {
    const template = createVideoTemplate(
      readyProduct(),
      sourceRevision,
      "親切自然",
      now,
    );

    expect(template).toMatchObject({
      productId: "product-1",
      authorizedAssetUri: "https://assets.example.test/item.jpg",
      language: "zh-TW",
      format: "mp4",
      durationSeconds: 20,
      width: 1080,
      height: 1920,
      voice: "親切自然",
    });
    expect(template.subtitleCues).toHaveLength(2);
    expect(template.subtitleCues.every((cue) => cue.bottomPositionPercent >= 15))
      .toBe(true);
    expect(
      template.subtitleCues.every((cue) => Array.from(cue.text).length <= 18),
    ).toBe(true);
  });

  it("blocks stale source facts and unauthorized product assets", () => {
    expect(() =>
      createVideoTemplate(
        readyProduct(),
        { ...sourceRevision, productSourceVersion: "source-v0" },
        "親切自然",
        now,
      ),
    ).toThrowError(VideoTemplateError);

    const product = readyProduct();
    product.assets[0].allowedUses = ["video-edit"];
    expect(() =>
      createVideoTemplate(product, sourceRevision, "親切自然", now),
    ).toThrowError(
      expect.objectContaining({ code: "product_not_ready" }),
    );
  });

  it("rejects malformed or synthetic media instead of treating it as a valid MP4", () => {
    expect(validateRenderedArtifact(validArtifact, true)).toEqual({
      valid: true,
      issues: [],
    });

    const result = validateRenderedArtifact(
      {
        ...validArtifact,
        mediaType: "application/x-synthetic-video-placeholder",
        durationSeconds: 0,
        width: 0,
        height: 0,
        playable: false,
        audioPresent: false,
        subtitlesWithinSafeArea: false,
        maxAudioVideoOffsetMilliseconds: 500,
      },
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "not_playable",
        "invalid_format",
        "invalid_duration",
        "invalid_dimensions",
        "missing_audio",
        "subtitle_outside_safe_area",
        "audio_video_out_of_sync",
        "synthetic_output",
      ]),
    );
  });

  it("requires rendering output to pass the full contract", async () => {
    const template = createVideoTemplate(
      readyProduct(),
      sourceRevision,
      "親切自然",
      now,
    );
    const fakeAdapters = createFakeProviderAdapters();
    await expect(
      renderVideoTemplate(template, fakeAdapters, false),
    ).rejects.toBeInstanceOf(VideoOutputValidationError);

    const adapters: ProviderAdapters = {
      ...fakeAdapters,
      speech: {
        providerId: "verified-speech",
        async synthesize() {
          return {
            providerId: "verified-speech",
            provenance: "provider",
            productionEligible: true,
            data: {
              audioUri: "https://private.example.test/voice.wav",
              mediaType: "audio/wav",
              durationMilliseconds: 20_000,
            },
          };
        },
      },
      rendering: {
        providerId: "verified-renderer",
        async render(request) {
          expect(request).toMatchObject({
            productId: "product-1",
            authorizedAssetUri: "https://assets.example.test/item.jpg",
            language: "zh-TW",
            width: 1080,
            height: 1920,
          });
          return {
            providerId: "verified-renderer",
            provenance: "provider",
            productionEligible: true,
            data: validArtifact,
          };
        },
      },
    };

    await expect(
      renderVideoTemplate(template, adapters, false),
    ).resolves.toMatchObject({
      artifact: validArtifact,
      productionEligible: true,
    });
  });
});
