import "server-only";
import type { SqlQueryable } from "../db/queryable";
import type {
  ProductAsset,
  ProductFact,
  ProductRecord,
} from "./readiness";

type ProductRow = {
  id: string;
  owner_id: string;
  title: string;
  source_provider: string;
  source_external_id: string;
  source_uri: string;
  source_version: string;
  source_checked_at: Date | string;
  data_valid_until: Date | string | null;
  eligibility_status: "eligible" | "ineligible";
  is_synthetic: boolean;
  facts: Array<{
    fact_key: string;
    fact_value: string;
    source_reference: string;
    source_version: string;
    verified_at: string;
  }>;
  assets: Array<{
    id: string;
    product_id: string;
    owner_id: string;
    asset_type: "image" | "video";
    source_uri: string;
    source_version: string;
    rights_provider: string;
    rights_status: ProductAsset["rightsStatus"];
    allowed_uses: string[];
    rights_verified_at: string | null;
    rights_valid_until: string | null;
    is_synthetic: boolean;
  }>;
};

function timestampToIso(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Product source returned an invalid timestamp.");
  }
  return timestamp.toISOString();
}

function toProductRecord(row: ProductRow): ProductRecord {
  const facts: ProductFact[] = row.facts.map((fact) => ({
    key: fact.fact_key,
    value: fact.fact_value,
    sourceReference: fact.source_reference,
    sourceVersion: fact.source_version,
    verifiedAt: fact.verified_at,
  }));
  const assets: ProductAsset[] = row.assets.map((asset) => ({
    id: asset.id,
    productId: asset.product_id,
    ownerId: asset.owner_id,
    type: asset.asset_type,
    sourceUri: asset.source_uri,
    sourceVersion: asset.source_version,
    rightsProvider: asset.rights_provider,
    rightsStatus: asset.rights_status,
    allowedUses: asset.allowed_uses,
    rightsVerifiedAt: asset.rights_verified_at,
    rightsValidUntil: asset.rights_valid_until,
    provenance: asset.is_synthetic ? "synthetic" : "verified",
  }));

  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    source: {
      provider: row.source_provider,
      externalId: row.source_external_id,
      uri: row.source_uri,
      version: row.source_version,
      checkedAt: timestampToIso(row.source_checked_at),
      validUntil: row.data_valid_until
        ? timestampToIso(row.data_valid_until)
        : null,
    },
    eligibility: row.eligibility_status,
    provenance: row.is_synthetic ? "synthetic" : "verified",
    facts,
    assets,
  };
}

export async function listProductsForOwner(
  pool: SqlQueryable,
  ownerId: string,
): Promise<ProductRecord[]> {
  const result = await pool.query<ProductRow>(
    `
      SELECT
        p.id::text,
        p.owner_id::text,
        p.title,
        p.source_provider,
        p.source_external_id,
        p.source_uri,
        p.source_version,
        p.source_checked_at,
        p.data_valid_until,
        p.eligibility_status,
        p.is_synthetic,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'fact_key', f.fact_key,
            'fact_value', f.fact_value,
            'source_reference', f.source_reference,
            'source_version', f.source_version,
            'verified_at', f.verified_at
          ) ORDER BY f.fact_key)
          FROM product_facts f
          WHERE f.owner_id = p.owner_id AND f.product_id = p.id
        ), '[]'::jsonb) AS facts,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id,
            'product_id', a.product_id,
            'owner_id', a.owner_id,
            'asset_type', a.asset_type,
            'source_uri', a.source_uri,
            'source_version', a.source_version,
            'rights_provider', a.rights_provider,
            'rights_status', a.rights_status,
            'allowed_uses', a.allowed_uses,
            'rights_verified_at', a.rights_verified_at,
            'rights_valid_until', a.rights_valid_until,
            'is_synthetic', a.is_synthetic
          ) ORDER BY a.created_at)
          FROM product_assets a
          WHERE a.owner_id = p.owner_id AND a.product_id = p.id
        ), '[]'::jsonb) AS assets
      FROM products p
      WHERE p.owner_id = $1
      ORDER BY p.updated_at DESC, p.id
    `,
    [ownerId],
  );

  return result.rows.map(toProductRecord);
}
