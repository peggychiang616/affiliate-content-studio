export type ProductFact = {
  key: string;
  value: string;
  sourceReference: string;
  sourceVersion: string;
  verifiedAt: string;
};

export type ProductAsset = {
  id: string;
  productId: string;
  ownerId: string;
  type: "image" | "video";
  sourceUri: string;
  sourceVersion: string;
  rightsProvider: string;
  rightsStatus: "unknown" | "verified" | "expired" | "out_of_scope";
  allowedUses: string[];
  rightsVerifiedAt: string | null;
  rightsValidUntil: string | null;
  provenance: "verified" | "synthetic";
};

export type ProductRecord = {
  id: string;
  ownerId: string;
  title: string;
  source: {
    provider: string;
    externalId: string;
    uri: string;
    version: string;
    checkedAt: string;
    validUntil: string | null;
  };
  eligibility: "eligible" | "ineligible";
  provenance: "verified" | "synthetic";
  facts: ProductFact[];
  assets: ProductAsset[];
};

export type ProductBlockReason =
  | "product_ineligible"
  | "synthetic_product"
  | "missing_product_source"
  | "stale_product_data"
  | "missing_verified_facts"
  | "no_valid_asset";

const requiredAssetUses = ["video-edit", "commercial-export"] as const;

function isValidDate(value: string | null, now: Date): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isFactVerified(fact: ProductFact, now: Date): boolean {
  const verifiedAt = Date.parse(fact.verifiedAt);
  return (
    hasValue(fact.key) &&
    hasValue(fact.value) &&
    hasValue(fact.sourceReference) &&
    hasValue(fact.sourceVersion) &&
    Number.isFinite(verifiedAt) &&
    verifiedAt <= now.getTime()
  );
}

export function isAssetUsable(
  asset: ProductAsset,
  product: ProductRecord,
  now: Date,
): boolean {
  const verifiedAt = asset.rightsVerifiedAt
    ? Date.parse(asset.rightsVerifiedAt)
    : Number.NaN;

  return (
    asset.productId === product.id &&
    asset.ownerId === product.ownerId &&
    asset.provenance === "verified" &&
    asset.rightsStatus === "verified" &&
    hasValue(asset.sourceUri) &&
    hasValue(asset.sourceVersion) &&
    hasValue(asset.rightsProvider) &&
    Number.isFinite(verifiedAt) &&
    verifiedAt <= now.getTime() &&
    (!asset.rightsValidUntil || isValidDate(asset.rightsValidUntil, now)) &&
    requiredAssetUses.every((use) => asset.allowedUses.includes(use))
  );
}

export function evaluateProductReadiness(
  product: ProductRecord,
  now: Date = new Date(),
): { ready: boolean; reasons: ProductBlockReason[]; usableAssets: ProductAsset[] } {
  const reasons: ProductBlockReason[] = [];

  if (product.eligibility !== "eligible") reasons.push("product_ineligible");
  if (product.provenance !== "verified") reasons.push("synthetic_product");

  const sourceIsComplete =
    hasValue(product.source.provider) &&
    hasValue(product.source.externalId) &&
    hasValue(product.source.uri) &&
    hasValue(product.source.version) &&
    Number.isFinite(Date.parse(product.source.checkedAt));
  if (!sourceIsComplete) reasons.push("missing_product_source");

  if (
    !isValidDate(product.source.validUntil, now) ||
    Date.parse(product.source.checkedAt) > now.getTime()
  ) {
    reasons.push("stale_product_data");
  }

  if (
    product.facts.length === 0 ||
    product.facts.some(
      (fact) =>
        !isFactVerified(fact, now) ||
        fact.sourceVersion !== product.source.version,
    )
  ) {
    reasons.push("missing_verified_facts");
  }

  const usableAssets = product.assets.filter((asset) =>
    isAssetUsable(asset, product, now),
  );
  if (usableAssets.length === 0) reasons.push("no_valid_asset");

  return { ready: reasons.length === 0, reasons, usableAssets };
}
