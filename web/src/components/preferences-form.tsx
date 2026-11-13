"use client";

import { useEffect, useState } from "react";
import {
  defaultDemoPreferences,
  readDemoPreferences,
  saveDemoPreferences,
  type DemoPreferences,
} from "@/lib/demo/preferences";

type PreferenceValues = DemoPreferences;

type StoredPreferences = PreferenceValues & {
  version: number;
};

const initialValues = defaultDemoPreferences;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredPreferences(value: unknown): value is StoredPreferences {
  return (
    isRecord(value) &&
    typeof value.audience === "string" &&
    typeof value.topic === "string" &&
    typeof value.voice === "string" &&
    typeof value.defaultStyle === "string" &&
    typeof value.version === "number"
  );
}

export function PreferencesForm() {
  const [values, setValues] = useState(initialValues);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const [localModeReason, setLocalModeReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPreferences() {
      try {
        const response = await fetch("/api/preferences", {
          cache: "no-store",
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          throw new Error(
            isRecord(body) && typeof body.error === "string"
              ? body.error
              : "無法讀取偏好設定。",
          );
        }

        const preferences =
          isRecord(body) && isStoredPreferences(body.preferences)
            ? body.preferences
            : null;
        if (active) {
          setServiceAvailable(true);
          if (preferences) {
            setValues({
              audience: preferences.audience,
              topic: preferences.topic,
              voice: preferences.voice,
              defaultStyle: preferences.defaultStyle,
            });
            setVersion(preferences.version);
          }
        }
      } catch (loadError) {
        if (active) {
          try {
            const localPreferences = readDemoPreferences();
            if (localPreferences) setValues(localPreferences);
            setLocalMode(true);
            setServiceAvailable(true);
            setLocalModeReason(
              "後端偏好服務目前不可用，已切換本機示範模式；資料只保存在這個瀏覽器。",
            );
          } catch (localError) {
            setServiceAvailable(false);
            setError(
              localError instanceof Error
                ? localError.message
                : loadError instanceof Error
                  ? loadError.message
                  : "無法讀取偏好設定。",
            );
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadPreferences();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    if (localMode) {
      try {
        saveDemoPreferences(values);
        setMessage("本機偏好已保存，只供此瀏覽器的模擬流程使用。");
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "無法保存本機偏好設定。",
        );
      } finally {
        setSaving(false);
      }
      return;
    }

    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "無法儲存偏好設定。",
        );
      }

      const preferences =
        isRecord(body) && isStoredPreferences(body.preferences)
          ? body.preferences
          : null;
      if (!preferences) {
        throw new Error("伺服器未回傳已保存的偏好版本。");
      }

      setVersion(preferences.version);
      setMessage(`偏好已保存為第 ${preferences.version} 版。`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "無法儲存偏好設定。",
      );
    } finally {
      setSaving(false);
    }
  }

  function updateValue(key: keyof PreferenceValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <div>
          <div className="eyebrow">一次設定，持續沿用</div>
          <h1>你的分享風格</h1>
          <p>這些偏好會套用到新批次，修改後會保存為新的版本。</p>
        </div>
        {version !== null && <span className="version-pill">偏好 v{version}</span>}
      </div>

      {localMode && (
        <div className="demo-local-notice" role="status">
          {localModeReason || "本機示範模式：偏好只保存在這個瀏覽器，不會送至伺服器。"}
        </div>
      )}

      {error && (
        <div className="settings-error" role="alert">
          <strong>偏好設定目前無法使用</strong>
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => {
              try {
                const localPreferences = readDemoPreferences();
                if (localPreferences) setValues(localPreferences);
                setError("");
                setLocalMode(true);
                setServiceAvailable(true);
                setLocalModeReason(
                  "已切換本機示範模式；偏好只保存在這個瀏覽器。",
                );
              } catch (localError) {
                setError(
                  localError instanceof Error
                    ? localError.message
                    : "無法讀取本機偏好設定。",
                );
              }
            }}
            type="button"
          >
            改用本機示範設定
          </button>
        </div>
      )}

      <form className="preferences-form" onSubmit={handleSubmit}>
        <label>
          分享對象
          <input
            maxLength={120}
            minLength={2}
            onChange={(event) => updateValue("audience", event.target.value)}
            required
            value={values.audience}
          />
        </label>
        <label>
          內容主題
          <input
            maxLength={120}
            minLength={2}
            onChange={(event) => updateValue("topic", event.target.value)}
            required
            value={values.topic}
          />
        </label>
        <label>
          繁體中文語氣
          <input
            maxLength={80}
            minLength={2}
            onChange={(event) => updateValue("voice", event.target.value)}
            required
            value={values.voice}
          />
        </label>
        <label>
          預設風格
          <input
            maxLength={80}
            minLength={2}
            onChange={(event) => updateValue("defaultStyle", event.target.value)}
            required
            value={values.defaultStyle}
          />
        </label>
        <div className="preferences-actions">
          <span role="status">{message}</span>
          <button
            className="primary-button"
            disabled={!serviceAvailable || loading || saving}
            type="submit"
          >
            {loading ? "讀取中…" : saving ? "保存中…" : "保存偏好"}
            <span>→</span>
          </button>
        </div>
      </form>
    </section>
  );
}
