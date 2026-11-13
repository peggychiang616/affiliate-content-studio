import { describe, expect, it } from "vitest";
import { getProductCatalog } from "./catalog";
import { toggleProductSelection } from "./selection";

describe("product catalog", () => {
  it("shows synthetic examples as non-selectable until a verified source exists", () => {
    const catalog = getProductCatalog({});

    expect(catalog.mode).toBe("synthetic-demo");
    expect(catalog.products).toHaveLength(3);
    expect(catalog.products.every((product) => !product.ready)).toBe(true);
    expect(
      catalog.products.every((product) =>
        product.reasons.includes("synthetic_product"),
      ),
    ).toBe(true);
  });

  it("fails explicitly rather than falling back to fixtures when V0 is enabled", () => {
    const verifiedProvider = {
      PRODUCT_DATA_PROVIDER_ID: "verified-source",
      V0_PRODUCT_DATA_ACCESS_VERIFIED: "true",
      V0_PRODUCT_DATA_RIGHTS_VERIFIED: "true",
      V0_PRODUCT_DATA_TERMS_VERIFIED: "true",
      V0_PRODUCT_DATA_COST_VERIFIED: "true",
    };

    expect(() => getProductCatalog(verifiedProvider)).toThrow(
      "no production adapter is registered",
    );
  });
});

describe("product selection", () => {
  it("does not allow unavailable products to enter a batch", () => {
    const result = toggleProductSelection([], "demo-product-1", false);

    expect(result).toEqual({
      selectedIds: [],
      rejected: "product-not-ready",
    });
  });

  it("limits a batch to three ready products", () => {
    const result = toggleProductSelection(
      ["product-1", "product-2", "product-3"],
      "product-4",
      true,
    );

    expect(result).toEqual({
      selectedIds: ["product-1", "product-2", "product-3"],
      rejected: "batch-limit",
    });
  });
});
