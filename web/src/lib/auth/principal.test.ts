import { describe, expect, it } from "vitest";
import {
  createPrincipalResolver,
  resolveDevelopmentPrincipal,
} from "./principal";

const demoId = "9a7b3c10-4d52-4e16-9b82-a6410932c775";

describe("principal resolution", () => {
  it("allows a configured development demo principal", () => {
    expect(
      resolveDevelopmentPrincipal({
        NODE_ENV: "development",
        APP_MODE: "demo",
        DEMO_PRINCIPAL_ID: demoId,
      }),
    ).toEqual({ id: demoId, mode: "development-demo" });
  });

  it("fails closed outside the explicit local demo mode", () => {
    expect(
      resolveDevelopmentPrincipal({
        NODE_ENV: "production",
        APP_MODE: "demo",
        DEMO_PRINCIPAL_ID: demoId,
      }),
    ).toBeNull();
    expect(
      resolveDevelopmentPrincipal({
        NODE_ENV: "development",
        APP_MODE: "demo",
        DEMO_PRINCIPAL_ID: "not-a-uuid",
      }),
    ).toBeNull();
  });

  it("uses an injected identity provider without coupling routes to a vendor", async () => {
    const request = new Request("https://example.test/api/preferences");
    const resolver = createPrincipalResolver(
      { NODE_ENV: "production" },
      async () => ({ id: demoId, mode: "authenticated" }),
    );

    await expect(resolver.resolve(request)).resolves.toEqual({
      id: demoId,
      mode: "authenticated",
    });
  });
});
