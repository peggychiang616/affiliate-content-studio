import { describe, expect, it } from "vitest";
import {
  providerKinds,
  readAllProviderReadiness,
  readProviderReadiness,
  syntheticFixture,
} from "./readiness";

describe("provider readiness gates", () => {
  it("keeps every real adapter disabled when evidence is missing", () => {
    const readiness = readAllProviderReadiness({});

    expect(readiness).toHaveLength(providerKinds.length);
    expect(readiness.every((provider) => !provider.enabled)).toBe(true);
    expect(readiness.every((provider) => provider.missingEvidence.length === 4)).toBe(true);
  });

  it("requires a configured provider as well as all V0 evidence", () => {
    const env = {
      TEXT_GENERATION_PROVIDER_ID: "test-provider",
      V0_TEXT_GENERATION_ACCESS_VERIFIED: "true",
      V0_TEXT_GENERATION_RIGHTS_VERIFIED: "true",
      V0_TEXT_GENERATION_TERMS_VERIFIED: "true",
      V0_TEXT_GENERATION_COST_VERIFIED: "false",
    };

    expect(readProviderReadiness("text", env)).toMatchObject({
      configured: true,
      enabled: false,
      missingEvidence: ["costVerified"],
    });

    expect(
      readProviderReadiness("text", {
        ...env,
        V0_TEXT_GENERATION_COST_VERIFIED: "true",
      }).enabled,
    ).toBe(true);

    expect(
      readProviderReadiness("text", {
        V0_TEXT_GENERATION_ACCESS_VERIFIED: "true",
        V0_TEXT_GENERATION_RIGHTS_VERIFIED: "true",
        V0_TEXT_GENERATION_TERMS_VERIFIED: "true",
        V0_TEXT_GENERATION_COST_VERIFIED: "true",
      }),
    ).toMatchObject({ configured: false, enabled: false });
  });

  it("marks fixtures as synthetic and never production eligible", () => {
    expect(syntheticFixture({ name: "Example item" })).toEqual({
      data: { name: "Example item" },
      provenance: "synthetic",
      label: "SYNTHETIC_DEMO",
      productionEligible: false,
    });
  });
});
