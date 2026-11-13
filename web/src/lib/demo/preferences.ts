export type DemoPreferences = {
  audience: string;
  topic: string;
  voice: string;
  defaultStyle: string;
};

export type DemoProduct = {
  id: string;
  title: string;
  summary: string;
  category: string;
};

export type DemoContentPreview = {
  productId: string;
  recommendation: string;
  caption: string;
};

export type DemoHistoryEntry = {
  id: string;
  createdAt: string;
  preferences: DemoPreferences;
  products: DemoProduct[];
  previews: DemoContentPreview[];
};

export type DemoSession = {
  selectedIds: string[];
  history: DemoHistoryEntry[];
};

export const defaultDemoPreferences: DemoPreferences = {
  audience: "剛開始做分潤的上班族",
  topic: "生活與居家用品",
  voice: "親切、自然、避免誇大",
  defaultStyle: "簡潔溫暖",
};

const storageKey = "affiliate-assistant-demo-preferences";
const sessionStorageKey = "affiliate-assistant-demo-session";
const maximumHistoryEntries = 8;

function isDemoProduct(value: unknown): value is DemoProduct {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return ["id", "title", "summary", "category"].every(
    (key) => typeof record[key] === "string",
  );
}

function isDemoPreview(value: unknown): value is DemoContentPreview {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.productId === "string" &&
    typeof record.recommendation === "string" &&
    typeof record.caption === "string"
  );
}

export function parseDemoSession(value: unknown): DemoSession | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.selectedIds) ||
    record.selectedIds.length > 3 ||
    !record.selectedIds.every((id) => typeof id === "string") ||
    !Array.isArray(record.history) ||
    record.history.length > maximumHistoryEntries
  ) {
    return null;
  }

  const history: DemoHistoryEntry[] = [];
  for (const entry of record.history) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const item = entry as Record<string, unknown>;
    const preferences = parseDemoPreferences(item.preferences);
    if (
      typeof item.id !== "string" ||
      typeof item.createdAt !== "string" ||
      !preferences ||
      !Array.isArray(item.products) ||
      item.products.length > 3 ||
      !item.products.every(isDemoProduct) ||
      !Array.isArray(item.previews) ||
      item.previews.length !== item.products.length ||
      !item.previews.every(isDemoPreview)
    ) {
      return null;
    }
    history.push({
      id: item.id,
      createdAt: item.createdAt,
      preferences,
      products: item.products,
      previews: item.previews,
    });
  }

  return { selectedIds: record.selectedIds, history };
}

export function readDemoSession(): DemoSession | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(sessionStorageKey);
  if (!stored) return null;
  const session: unknown = JSON.parse(stored);
  const parsed = parseDemoSession(session);
  if (!parsed) throw new Error("本機展示紀錄格式不正確，請清除紀錄後重新開始。");
  return parsed;
}

export function saveDemoSession(session: DemoSession): void {
  if (typeof window === "undefined") {
    throw new Error("目前環境無法保存本機展示紀錄。");
  }
  window.localStorage.setItem(
    sessionStorageKey,
    JSON.stringify({
      selectedIds: session.selectedIds.slice(0, 3),
      history: session.history.slice(0, maximumHistoryEntries),
    }),
  );
}

export function createDemoHistoryEntry(
  products: DemoProduct[],
  preferences: DemoPreferences,
  previews: DemoContentPreview[],
  createdAt = new Date().toISOString(),
): DemoHistoryEntry {
  return {
    id: `${Date.parse(createdAt)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    preferences,
    products,
    previews,
  };
}

export function createDemoDownloadText(preview: DemoContentPreview): string {
  return preview.caption;
}

export function parseDemoPreferences(value: unknown): DemoPreferences | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const fields = ["audience", "topic", "voice", "defaultStyle"] as const;
  if (
    fields.some(
      (field) =>
        typeof record[field] !== "string" ||
        record[field].trim().length < 2 ||
        record[field].trim().length > (field === "audience" || field === "topic" ? 120 : 80),
    )
  ) {
    return null;
  }

  return {
    audience: (record.audience as string).trim(),
    topic: (record.topic as string).trim(),
    voice: (record.voice as string).trim(),
    defaultStyle: (record.defaultStyle as string).trim(),
  };
}

export function readDemoPreferences(): DemoPreferences | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return null;

  const preferences: unknown = JSON.parse(stored);
  const parsed = parseDemoPreferences(preferences);
  if (!parsed) throw new Error("已保存的本機偏好格式不正確，請重新設定。");
  return parsed;
}

export function saveDemoPreferences(preferences: DemoPreferences): void {
  if (typeof window === "undefined") {
    throw new Error("目前環境無法保存本機偏好設定。");
  }
  window.localStorage.setItem(storageKey, JSON.stringify(preferences));
}

export function createDemoContentPreview(
  product: DemoProduct,
  preferences: DemoPreferences,
): DemoContentPreview {
  return {
    productId: product.id,
    recommendation: `「${product.title}」的${product.category}主題，適合用「${product.summary}」作為分享切角，呼應你設定的「${preferences.topic}」內容方向與「${preferences.audience}」受眾。`,
    caption: `【模擬文案｜非真實 AI】\n\n想讓日常分享多一點靈感嗎？這次來看看「${product.title}」。可以從${product.summary}這個角度，整理成一篇${preferences.defaultStyle}的生活提案，分享給${preferences.audience}參考。\n\n語氣設定：${preferences.voice}\n\n（以上為本機模板示意，商品資訊未經核實；實際發布前請自行查證並加上分潤揭露。）`,
  };
}
