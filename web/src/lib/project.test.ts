import { describe, expect, it } from "vitest";

describe("project setup", () => {
  it("runs focused tests in the Node environment", () => {
    expect(process.versions.node).toBeTruthy();
  });
});
