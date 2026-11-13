import { describe, expect, it, vi } from "vitest";
import {
  createFakeProviderAdapters,
  createProviderAdapters,
  ProviderAdapterError,
} from "./adapters";

vi.mock("server-only", () => ({}));

function productionEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: "production",
  };
  const providers = [
    ["PRODUCT_DATA", "PRODUCT_DATA_PROVIDER_ID"],
    ["ASSET_SOURCE", "ASSET_SOURCE_PROVIDER_ID"],
    ["TEXT_GENERATION", "TEXT_GENERATION_PROVIDER_ID"],
    ["SPEECH", "SPEECH_PROVIDER_ID"],
    ["VIDEO_RENDERING", "VIDEO_RENDERING_PROVIDER_ID"],
  ] as const;

  for (const [prefix, providerIdKey] of providers) {
    env[providerIdKey] = `${prefix.toLowerCase()}-provider`;
    for (const evidence of [
      "ACCESS",
      "RIGHTS",
      "TERMS",
      "COST",
    ] as const) {
      env[`V0_${prefix}_${evidence}_VERIFIED`] = "true";
    }
  }
  return env;
}

describe("provider adapters", () => {
  it("returns deterministic synthetic fixtures that cannot be production eligible", async () => {
    const adapters = createProviderAdapters({
      NODE_ENV: "development",
      APP_MODE: "demo",
    });
    const request = {
      productTitle: "示範商品",
      productSourceVersion: "source-v1",
      facts: [{ key: "material", value: "Cotton", sourceReference: "test", sourceVersion: "source-v1", verifiedAt: "2025-01-01T00:00:00.000Z" }],
      variantIndex: 1 as const,
      audience: "分潤新手",
      topic: "居家生活",
      voice: "親切自然",
      style: "簡潔溫暖",
    };
    const first = await adapters.text.generate(request, new AbortController().signal);
    const second = await adapters.text.generate(request, new AbortController().signal);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      providerId: "synthetic-demo",
      provenance: "synthetic",
      productionEligible: false,
    });

    const product = await adapters.productData.getProduct(
      { ownerId: "owner", productId: "product" },
      new AbortController().signal,
    );
    expect(product).toMatchObject({
      provenance: "synthetic",
      productionEligible: false,
      data: { provenance: "synthetic" },
    });
  });

  it("reports missing V0 evidence and absent production implementations", () => {
    expect(() =>
      createProviderAdapters({ NODE_ENV: "production" }),
    ).toThrowError(
      expect.objectContaining<Partial<ProviderAdapterError>>({
        kind: "productData",
        code: "not_enabled",
      }),
    );

    expect(() => createProviderAdapters(productionEnvironment())).toThrowError(
      expect.objectContaining<Partial<ProviderAdapterError>>({
        kind: "productData",
        code: "adapter_unavailable",
      }),
    );
  });

  it("reports provider failures and timeouts without returning success-shaped results", async () => {
    const request = {
      text: "合成測試文字",
      voice: "親切自然",
    };
    const failingAdapters = createFakeProviderAdapters({
      failKinds: ["speech"],
    });

    await expect(
      failingAdapters.speech.synthesize(request, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: "speech",
      code: "provider_failed",
    });

    const slowAdapters = createFakeProviderAdapters({
      timeoutMilliseconds: 10,
      delayMilliseconds: { speech: 100 },
    });
    await expect(
      slowAdapters.speech.synthesize(request, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: "speech",
      code: "timeout",
    });
  });

  it("applies timeouts to registered production adapter calls", async () => {
    const neverCompletes = () => new Promise<never>(() => undefined);
    const env = productionEnvironment();
    const adapters = createProviderAdapters(
      env,
      {
        productData: {
          providerId: env.PRODUCT_DATA_PROVIDER_ID,
          getProduct: neverCompletes,
        },
        text: {
          providerId: env.TEXT_GENERATION_PROVIDER_ID,
          generate: neverCompletes,
        },
        speech: {
          providerId: env.SPEECH_PROVIDER_ID,
          synthesize: neverCompletes,
        },
        rendering: {
          providerId: env.VIDEO_RENDERING_PROVIDER_ID,
          render: neverCompletes,
        },
      },
      10,
    );

    await expect(
      adapters.productData.getProduct(
        { ownerId: "owner", productId: "product" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      kind: "productData",
      code: "timeout",
    });
  });
});
