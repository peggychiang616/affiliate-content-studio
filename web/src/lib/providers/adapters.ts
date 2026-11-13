import "server-only";
import { createHash } from "node:crypto";
import type {
  ProductFact,
  ProductRecord,
} from "../products/readiness";
import {
  providerKinds,
  readProviderReadiness,
  type ProviderEnvironment,
  type ProviderKind,
  type ProviderReadiness,
} from "./readiness";

export type ProviderResult<T> = {
  data: T;
  providerId: string;
  provenance: "provider" | "synthetic";
  productionEligible: boolean;
  usage?: ProviderUsage;
};

export type ProviderUsage = {
  inputUnits: number;
  outputUnits: number;
  costAmount: string;
  currency: string;
};

export type ProductDataRequest = {
  ownerId: string;
  productId: string;
};

export type TextGenerationRequest = {
  productTitle: string;
  productSourceVersion: string;
  facts: ProductFact[];
  variantIndex: 1 | 2;
  audience: string;
  topic: string;
  voice: string;
  style: string;
};

export type GeneratedText = {
  sourceVersion: string;
  factKeys: string[];
};

export type SpeechRequest = {
  text: string;
  voice: string;
};

export type SpeechArtifact = {
  audioUri: string;
  mediaType: string;
  durationMilliseconds: number;
};

export type SubtitleCue = {
  text: string;
  startSeconds: number;
  endSeconds: number;
  alignment: "center";
  horizontalPositionPercent: number;
  bottomPositionPercent: number;
};

export type RenderingRequest = {
  productId: string;
  authorizedAssetId: string;
  authorizedAssetUri: string;
  script: string;
  audioUri: string;
  voice: string;
  language: "zh-TW";
  format: "mp4";
  durationSeconds: number;
  width: 1080;
  height: 1920;
  subtitleCues: SubtitleCue[];
};

export type RenderedArtifact = {
  mediaUri: string;
  mediaType: string;
  durationSeconds: number;
  width: number;
  height: number;
  playable: boolean;
  audioPresent: boolean;
  subtitlesWithinSafeArea: boolean;
  maxAudioVideoOffsetMilliseconds: number;
};

export interface ProductDataAdapter {
  readonly providerId: string;
  getProduct(
    request: ProductDataRequest,
    signal: AbortSignal,
  ): Promise<ProviderResult<ProductRecord>>;
}

export interface TextGenerationAdapter {
  readonly providerId: string;
  generate(
    request: TextGenerationRequest,
    signal: AbortSignal,
  ): Promise<ProviderResult<GeneratedText>>;
}

export interface SpeechAdapter {
  readonly providerId: string;
  synthesize(
    request: SpeechRequest,
    signal: AbortSignal,
  ): Promise<ProviderResult<SpeechArtifact>>;
}

export interface RenderingAdapter {
  readonly providerId: string;
  render(
    request: RenderingRequest,
    signal: AbortSignal,
  ): Promise<ProviderResult<RenderedArtifact>>;
}

export type ProductionProviderAdapters = {
  productData?: ProductDataAdapter;
  text?: TextGenerationAdapter;
  speech?: SpeechAdapter;
  rendering?: RenderingAdapter;
};

export type ProviderAdapters = {
  productData: ProductDataAdapter;
  text: TextGenerationAdapter;
  speech: SpeechAdapter;
  rendering: RenderingAdapter;
};

export type ProviderAdapterErrorCode =
  | "not_enabled"
  | "adapter_unavailable"
  | "provider_failed"
  | "timeout";

export class ProviderAdapterError extends Error {
  constructor(
    readonly kind: ProviderKind,
    readonly code: ProviderAdapterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderAdapterError";
  }
}

export async function runProviderCall<T>(
  kind: ProviderKind,
  timeoutMilliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new ProviderAdapterError(
      kind,
      "provider_failed",
      "Provider timeout must be a positive finite duration.",
    );
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new ProviderAdapterError(
          kind,
          "timeout",
          `${kind} provider exceeded its ${timeoutMilliseconds}ms timeout.`,
        ),
      );
    }, timeoutMilliseconds);
  });
  const operationPromise = Promise.resolve()
    .then(() => operation(controller.signal))
    .catch((error: unknown) => {
      if (error instanceof ProviderAdapterError) throw error;
      throw new ProviderAdapterError(
        kind,
        "provider_failed",
        `${kind} provider request failed.`,
        { cause: error },
      );
    });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type FakeProviderOptions = {
  timeoutMilliseconds?: number;
  delayMilliseconds?: Partial<Record<ProviderKind, number>>;
  failKinds?: ProviderKind[];
};

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function fakeResult<T>(data: T): ProviderResult<T> {
  return {
    data,
    providerId: "synthetic-demo",
    provenance: "synthetic",
    productionEligible: false,
    usage: {
      inputUnits: 0,
      outputUnits: 0,
      costAmount: "0",
      currency: "USD",
    },
  };
}

function createFakeCall(options: FakeProviderOptions) {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 1_000;

  return async function call<T>(
    kind: ProviderKind,
    createData: () => T,
  ): Promise<ProviderResult<T>> {
    return runProviderCall(kind, timeoutMilliseconds, async (signal) => {
      if (options.failKinds?.includes(kind)) {
        throw new Error(`Synthetic ${kind} provider failure.`);
      }

      const delayMilliseconds = options.delayMilliseconds?.[kind] ?? 0;
      if (delayMilliseconds > 0) {
        await new Promise<void>((resolve, reject) => {
          const delay = setTimeout(resolve, delayMilliseconds);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(delay);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }

      return fakeResult(createData());
    });
  };
}

export function createFakeProviderAdapters(
  options: FakeProviderOptions = {},
): ProviderAdapters {
  const call = createFakeCall(options);

  return {
    productData: {
      providerId: "synthetic-demo",
      getProduct: ({ ownerId, productId }) =>
        call("productData", () => ({
          id: productId,
          ownerId,
          title: "合成示範商品",
          source: {
            provider: "synthetic-demo",
            externalId: productId,
            uri: "synthetic://product",
            version: "synthetic-v1",
            checkedAt: "2025-01-01T00:00:00.000Z",
            validUntil: "2099-01-01T00:00:00.000Z",
          },
          eligibility: "eligible",
          provenance: "synthetic",
          facts: [],
          assets: [],
        })),
    },
    text: {
      providerId: "synthetic-demo",
      generate: (request) =>
        call("text", () => ({
          sourceVersion: request.productSourceVersion,
          factKeys: request.facts.map((fact) => fact.key),
        })),
    },
    speech: {
      providerId: "synthetic-demo",
      synthesize: (request) =>
        call("speech", () => ({
          audioUri: `synthetic://speech/${stableId(`${request.voice}:${request.text}`)}`,
          mediaType: "application/x-synthetic-audio",
          durationMilliseconds: 0,
        })),
    },
    rendering: {
      providerId: "synthetic-demo",
      render: (request) =>
        call("rendering", () => ({
          mediaUri: `synthetic://video/${stableId(`${request.productId}:${request.script}:${request.authorizedAssetUri}:${request.audioUri}`)}`,
          mediaType: "application/x-synthetic-video-placeholder",
          durationSeconds: 0,
          width: 0,
          height: 0,
          playable: false,
          audioPresent: false,
          subtitlesWithinSafeArea: false,
          maxAudioVideoOffsetMilliseconds: 0,
        })),
    },
  };
}

const adapterKinds = {
  productData: "productData",
  text: "text",
  speech: "speech",
  rendering: "rendering",
} as const satisfies Record<keyof ProviderAdapters, ProviderKind>;

function readinessError(readiness: ProviderReadiness): ProviderAdapterError {
  const missing = readiness.missingEvidence.join(", ");
  return new ProviderAdapterError(
    readiness.kind,
    "not_enabled",
    `${readiness.kind} provider is not V0-ready${missing ? `; missing evidence: ${missing}` : ""}.`,
  );
}

export function createProviderAdapters(
  env: ProviderEnvironment = process.env,
  productionAdapters: ProductionProviderAdapters = {},
  timeoutMilliseconds = 30_000,
): ProviderAdapters {
  if (env.NODE_ENV === "development" && env.APP_MODE === "demo") {
    return createFakeProviderAdapters({ timeoutMilliseconds });
  }

  const readiness = providerKinds.map((kind) =>
    readProviderReadiness(kind, env),
  );
  const notReady = readiness.find((provider) => !provider.enabled);
  if (notReady) throw readinessError(notReady);

  const requireAdapter = <K extends keyof ProviderAdapters>(
    key: K,
    implementation: ProviderAdapters[K] | undefined,
  ): ProviderAdapters[K] => {
    const kind = adapterKinds[key];
    const configuredProvider = readProviderReadiness(kind, env).providerId;
    if (!implementation || implementation.providerId !== configuredProvider) {
      throw new ProviderAdapterError(
        kind,
        "adapter_unavailable",
        `${kind} passed V0 readiness but has no matching production adapter.`,
      );
    }
    return implementation;
  };

  const productData = requireAdapter(
    "productData",
    productionAdapters.productData,
  );
  const text = requireAdapter("text", productionAdapters.text);
  const speech = requireAdapter("speech", productionAdapters.speech);
  const rendering = requireAdapter("rendering", productionAdapters.rendering);

  return {
    productData: {
      providerId: productData.providerId,
      getProduct: (request, signal) =>
        runProviderCall("productData", timeoutMilliseconds, (timeoutSignal) =>
          productData.getProduct(request, AbortSignal.any([signal, timeoutSignal])),
        ),
    },
    text: {
      providerId: text.providerId,
      generate: (request, signal) =>
        runProviderCall("text", timeoutMilliseconds, (timeoutSignal) =>
          text.generate(request, AbortSignal.any([signal, timeoutSignal])),
        ),
    },
    speech: {
      providerId: speech.providerId,
      synthesize: (request, signal) =>
        runProviderCall("speech", timeoutMilliseconds, (timeoutSignal) =>
          speech.synthesize(request, AbortSignal.any([signal, timeoutSignal])),
        ),
    },
    rendering: {
      providerId: rendering.providerId,
      render: (request, signal) =>
        runProviderCall("rendering", timeoutMilliseconds, (timeoutSignal) =>
          rendering.render(request, AbortSignal.any([signal, timeoutSignal])),
        ),
    },
  };
}
