import { describe, expect, it } from "vitest";
import {
  evaluateProductReadiness,
  type ProductAsset,
  type ProductRecord,
} from "./readiness";

const now = new Date("2026-11-13T10:00:00.000Z");

function createProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  const asset: ProductAsset = {
    id: "asset-1",
    productId: "product-1",
    ownerId: "owner-1",
    type: "image",
    sourceUri: "https://assets.example.test/item.jpg",
    sourceVersion: "asset-v1",
    rightsProvider: "rights-holder",
    rightsStatus: "verified",
    allowedUses: ["video-edit", "commercial-export"],
    rightsVerifiedAt: "2026-11-12T10:00:00.000Z",
    rightsValidUntil: "2026-12-01T00:00:00.000Z",
    provenance: "verified",
  };

  return {
    id: "product-1",
    ownerId: "owner-1",
    title: "Test item",
    source: {
      provider: "verified-source",
      externalId: "external-1",
      uri: "https://source.example.test/item",
      version: "source-v1",
      checkedAt: "2026-11-12T10:00:00.000Z",
      validUntil: "2026-11-20T00:00:00.000Z",
    },
    eligibility: "eligible",
    provenance: "verified",
    facts: [
      {
        key: "material",
        value: "Cotton",
        sourceReference: "https://source.example.test/item#material",
        sourceVersion: "source-v1",
        verifiedAt: "2026-11-12T10:00:00.000Z",
      },
    ],
    assets: [asset],
    ...overrides,
  };
}

describe("product readiness", () => {
  it("allows products with current facts and at least one authorized asset", () => {
    const result = evaluateProductReadiness(createProduct(), now);

    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.usableAssets).toHaveLength(1);
  });

  it("blocks missing source data, unverified facts, and synthetic products", () => {
    const product = createProduct({
      provenance: "synthetic",
      source: {
        provider: "",
        externalId: "",
        uri: "",
        version: "",
        checkedAt: "",
        validUntil: null,
      },
      facts: [],
    });

    expect(evaluateProductReadiness(product, now)).toMatchObject({
      ready: false,
      reasons: [
        "synthetic_product",
        "missing_product_source",
        "stale_product_data",
        "missing_verified_facts",
      ],
    });
  });

  it("blocks expired product data and assets whose rights do not cover editing and export", () => {
    const product = createProduct({
      source: {
        ...createProduct().source,
        validUntil: "2026-11-12T00:00:00.000Z",
      },
      assets: [
        {
          ...createProduct().assets[0],
          allowedUses: ["view"],
        },
      ],
    });

    const result = evaluateProductReadiness(product, now);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("stale_product_data");
    expect(result.reasons).toContain("no_valid_asset");
  });

  it("blocks facts from a different product source version", () => {
    const product = createProduct({
      facts: [
        {
          ...createProduct().facts[0],
          sourceVersion: "older-source-v0",
        },
      ],
    });

    expect(evaluateProductReadiness(product, now).reasons).toContain(
      "missing_verified_facts",
    );
  });

  it("rejects assets owned by another user even if their rights are valid", () => {
    const product = createProduct({
      assets: [
        {
          ...createProduct().assets[0],
          ownerId: "another-owner",
        },
      ],
    });

    expect(evaluateProductReadiness(product, now).reasons).toContain(
      "no_valid_asset",
    );
  });
});
