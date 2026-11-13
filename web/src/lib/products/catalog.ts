import {
  readProviderReadiness,
  type ProviderEnvironment,
} from "../providers/readiness";
import {
  evaluateProductReadiness,
  type ProductRecord,
} from "./readiness";

export type CatalogProduct = {
  id: string;
  title: string;
  category: string;
  summary: string;
  samplePrice: string;
  sampleCommission: string;
  provenance: ProductRecord["provenance"];
  ready: boolean;
  reasons: string[];
  usableAssetCount: number;
};

export type ProductCatalog = {
  mode: "synthetic-demo";
  products: CatalogProduct[];
};

const syntheticProducts: ProductRecord[] = [
  {
    id: "demo-product-1",
    ownerId: "demo-owner",
    title: "居家收納用品（示意商品）",
    source: {
      provider: "synthetic-demo",
      externalId: "demo-1",
      uri: "",
      version: "fixture-v1",
      checkedAt: "",
      validUntil: null,
    },
    eligibility: "ineligible",
    provenance: "synthetic",
    facts: [],
    assets: [],
  },
  {
    id: "demo-product-2",
    ownerId: "demo-owner",
    title: "桌面照明用品（示意商品）",
    source: {
      provider: "synthetic-demo",
      externalId: "demo-2",
      uri: "",
      version: "fixture-v1",
      checkedAt: "",
      validUntil: null,
    },
    eligibility: "ineligible",
    provenance: "synthetic",
    facts: [],
    assets: [],
  },
  {
    id: "demo-product-3",
    ownerId: "demo-owner",
    title: "旅行收納配件（示意商品）",
    source: {
      provider: "synthetic-demo",
      externalId: "demo-3",
      uri: "",
      version: "fixture-v1",
      checkedAt: "",
      validUntil: null,
    },
    eligibility: "ineligible",
    provenance: "synthetic",
    facts: [],
    assets: [],
  },
];

const syntheticProductDetails: Record<
  string,
  Pick<CatalogProduct, "category" | "summary" | "samplePrice" | "sampleCommission">
> = {
  "demo-product-1": {
    category: "居家收納",
    summary: "整理小空間、讓日常物品更好拿取",
    samplePrice: "NT$ 390（示意）",
    sampleCommission: "10%（示意）",
  },
  "demo-product-2": {
    category: "桌面生活",
    summary: "為工作桌增添舒適、安定的氛圍",
    samplePrice: "NT$ 680（示意）",
    sampleCommission: "8%（示意）",
  },
  "demo-product-3": {
    category: "旅行配件",
    summary: "整理隨身小物，讓行李收納更有條理",
    samplePrice: "NT$ 450（示意）",
    sampleCommission: "12%（示意）",
  },
};

const demoReferenceTime = new Date("2026-11-13T00:00:00.000Z");

export function getProductCatalog(
  env: ProviderEnvironment = process.env,
): ProductCatalog {
  const provider = readProviderReadiness("productData", env);
  if (provider.enabled) {
    throw new Error(
      "A verified product-data provider is configured, but no production adapter is registered.",
    );
  }

  return {
    mode: "synthetic-demo",
    products: syntheticProducts.map((product) => {
      const readiness = evaluateProductReadiness(product, demoReferenceTime);
      return {
        id: product.id,
        title: product.title,
        ...syntheticProductDetails[product.id],
        provenance: product.provenance,
        ready: readiness.ready,
        reasons: readiness.reasons,
        usableAssetCount: readiness.usableAssets.length,
      };
    }),
  };
}
