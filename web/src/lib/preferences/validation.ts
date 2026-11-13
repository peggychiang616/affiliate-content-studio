import type { ContentPreferencesInput } from "./repository";

export type PreferenceValidation =
  | { valid: true; value: ContentPreferencesInput }
  | { valid: false; message: string };

function readText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) return null;
  return normalized;
}

export function validatePreferences(input: unknown): PreferenceValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, message: "偏好設定格式不正確。" };
  }

  const audience = readText(Reflect.get(input, "audience"), 2, 120);
  const topic = readText(Reflect.get(input, "topic"), 2, 120);
  const voice = readText(Reflect.get(input, "voice"), 2, 80);
  const defaultStyle = readText(Reflect.get(input, "defaultStyle"), 2, 80);

  if (!audience || !topic || !voice || !defaultStyle) {
    return {
      valid: false,
      message: "分享對象、內容主題、文字語氣與預設風格皆為必填，且長度須符合欄位限制。",
    };
  }

  return {
    valid: true,
    value: { audience, topic, voice, defaultStyle },
  };
}
