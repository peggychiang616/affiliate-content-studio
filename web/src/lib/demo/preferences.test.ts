import { describe, expect, it } from "vitest";
import {
  createDemoContentPreview,
  createDemoDownloadText,
  defaultDemoPreferences,
  parseDemoPreferences,
  parseDemoSession,
} from "./preferences";

describe("local demo content", () => {
  it("uses the selected product and preferences in clearly labeled mock output", () => {
    const preview = createDemoContentPreview(
      {
        id: "demo-1",
        title: "居家收納用品（示意商品）",
        category: "居家收納",
        summary: "整理小空間",
      },
      {
        ...defaultDemoPreferences,
        audience: "租屋族",
        topic: "小宅生活",
      },
    );

    expect(preview.recommendation).toContain("租屋族");
    expect(preview.recommendation).toContain("小宅生活");
    expect(preview.caption).toContain("模擬文案｜非真實 AI");
    expect(preview.caption).toContain("商品資訊未經核實");
  });

  it("rejects malformed or out-of-range stored preferences", () => {
    expect(parseDemoPreferences({ ...defaultDemoPreferences, audience: "x" })).toBeNull();
    expect(parseDemoPreferences(defaultDemoPreferences)).toEqual(
      defaultDemoPreferences,
    );
  });

  it("round-trips recent local selections and previews while rejecting invalid history", () => {
    const product = {
      id: "demo-1",
      title: "居家收納用品（示意商品）",
      category: "居家收納",
      summary: "整理小空間",
    };
    const preview = createDemoContentPreview(product, defaultDemoPreferences);
    const session = {
      selectedIds: [product.id],
      history: [
        {
          id: "demo-history-1",
          createdAt: "2026-11-13T10:00:00.000Z",
          preferences: defaultDemoPreferences,
          products: [product],
          previews: [preview],
        },
      ],
    };

    expect(parseDemoSession(session)).toEqual(session);
    expect(
      parseDemoSession({ ...session, selectedIds: ["a", "b", "c", "d"] }),
    ).toBeNull();
    expect(createDemoDownloadText(preview)).toContain("模擬文案｜非真實 AI");
    expect(createDemoDownloadText(preview)).toContain("分潤揭露");
  });
});
