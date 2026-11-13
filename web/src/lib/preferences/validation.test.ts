import { describe, expect, it } from "vitest";
import { validatePreferences } from "./validation";

describe("content preference validation", () => {
  it("normalizes a complete preference set", () => {
    expect(
      validatePreferences({
        audience: "  剛開始做分潤的上班族 ",
        topic: "居家生活",
        voice: "親切、自然",
        defaultStyle: "簡潔溫暖",
      }),
    ).toEqual({
      valid: true,
      value: {
        audience: "剛開始做分潤的上班族",
        topic: "居家生活",
        voice: "親切、自然",
        defaultStyle: "簡潔溫暖",
      },
    });
  });

  it("rejects malformed, empty, and oversized preferences", () => {
    expect(validatePreferences(null).valid).toBe(false);
    expect(
      validatePreferences({
        audience: "",
        topic: "居家",
        voice: "自然",
        defaultStyle: "簡潔",
      }).valid,
    ).toBe(false);
    expect(
      validatePreferences({
        audience: "a".repeat(121),
        topic: "居家",
        voice: "自然",
        defaultStyle: "簡潔",
      }).valid,
    ).toBe(false);
  });
});
