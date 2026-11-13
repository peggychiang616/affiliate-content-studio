export const providerKinds = [
  "productData",
  "assets",
  "text",
  "speech",
  "rendering",
] as const;

export type ProviderKind = (typeof providerKinds)[number];
export type EvidenceKey = "accessVerified" | "rightsVerified" | "termsVerified" | "costVerified";

export type ProviderEvidence = Record<EvidenceKey, boolean>;

export type ProviderReadiness = {
  kind: ProviderKind;
  configured: boolean;
  providerId: string | null;
  enabled: boolean;
  missingEvidence: EvidenceKey[];
};

export type ProviderEnvironment = Record<string, string | undefined>;

const evidenceKeys: EvidenceKey[] = [
  "accessVerified",
  "rightsVerified",
  "termsVerified",
  "costVerified",
];

const environmentKeys: Record<ProviderKind, string> = {
  productData: "PRODUCT_DATA",
  assets: "ASSET_SOURCE",
  text: "TEXT_GENERATION",
  speech: "SPEECH",
  rendering: "VIDEO_RENDERING",
};

function isVerified(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function readProviderReadiness(
  kind: ProviderKind,
  env: ProviderEnvironment = process.env,
): ProviderReadiness {
  const prefix = `V0_${environmentKeys[kind]}`;
  const providerId = env[`${environmentKeys[kind]}_PROVIDER_ID`]?.trim() || null;
  const missingEvidence = evidenceKeys.filter(
    (key) => !isVerified(env[`${prefix}_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`]),
  );

  return {
    kind,
    configured: providerId !== null,
    providerId,
    enabled: providerId !== null && missingEvidence.length === 0,
    missingEvidence,
  };
}

export function readAllProviderReadiness(
  env: ProviderEnvironment = process.env,
): ProviderReadiness[] {
  return providerKinds.map((kind) => readProviderReadiness(kind, env));
}

export type SyntheticFixture<T> = {
  data: T;
  provenance: "synthetic";
  label: "SYNTHETIC_DEMO";
  productionEligible: false;
};

export function syntheticFixture<T>(data: T): SyntheticFixture<T> {
  return {
    data,
    provenance: "synthetic",
    label: "SYNTHETIC_DEMO",
    productionEligible: false,
  };
}
