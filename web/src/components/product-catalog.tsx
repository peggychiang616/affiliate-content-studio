"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDemoContentPreview,
  createDemoDownloadText,
  createDemoHistoryEntry,
  defaultDemoPreferences,
  readDemoPreferences,
  readDemoSession,
  saveDemoPreferences,
  saveDemoSession,
  type DemoContentPreview,
  type DemoHistoryEntry,
  type DemoPreferences,
  type DemoProduct,
} from "@/lib/demo/preferences";
import type { CatalogProduct } from "@/lib/products/catalog";
import { toggleProductSelection } from "@/lib/products/selection";

type DemoStep = "products" | "preferences" | "preview";

const preferenceFields: {
  key: keyof DemoPreferences;
  label: string;
  maxLength: number;
}[] = [
  { key: "audience", label: "分享對象", maxLength: 120 },
  { key: "topic", label: "內容主題", maxLength: 120 },
  { key: "voice", label: "文字語氣", maxLength: 80 },
  { key: "defaultStyle", label: "文案風格", maxLength: 80 },
];

function toDemoProduct(product: CatalogProduct): DemoProduct {
  return {
    id: product.id,
    title: product.title,
    category: product.category,
    summary: product.summary,
  };
}

export function ProductCatalog({ products }: { products: CatalogProduct[] }) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<"demo" | "production" | null>(
    null,
  );
  const [step, setStep] = useState<DemoStep>("products");
  const [preferences, setPreferences] = useState<DemoPreferences>(
    defaultDemoPreferences,
  );
  const [previews, setPreviews] = useState<DemoContentPreview[]>([]);
  const [history, setHistory] = useState<DemoHistoryEntry[]>([]);
  const [message, setMessage] = useState("");
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部品類");
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(
    null,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const session = readDemoSession();
        if (session) {
          const demoIds = new Set(
            products
              .filter((product) => product.provenance === "synthetic")
              .map((product) => product.id),
          );
          const savedIds = session.selectedIds.filter((id) => demoIds.has(id));
          setSelectedIds(savedIds);
          setSelectionMode(savedIds.length > 0 ? "demo" : null);
          setHistory(session.history);
          if (session.history[0]) {
            setPreferences(session.history[0].preferences);
          } else {
            const savedPreferences = readDemoPreferences();
            if (savedPreferences) setPreferences(savedPreferences);
          }
        } else {
          const savedPreferences = readDemoPreferences();
          if (savedPreferences) setPreferences(savedPreferences);
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? `${error.message} 可清除紀錄或直接開始新的展示。`
            : "無法讀取本機展示紀錄，可直接開始新的展示。",
        );
      } finally {
        setSessionLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [products]);

  useEffect(() => {
    if (!detailProduct) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDetailProduct(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [detailProduct]);

  function persistSession(
    nextSelectedIds: string[],
    nextHistory: DemoHistoryEntry[] = history,
  ) {
    try {
      saveDemoSession({ selectedIds: nextSelectedIds, history: nextHistory });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message}；目前操作仍可繼續。`
          : "本機展示紀錄保存失敗；目前操作仍可繼續。",
      );
    }
  }

  function openPreferences() {
    try {
      const saved = readDemoPreferences();
      if (saved) setPreferences(saved);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "無法讀取本機偏好設定。",
      );
    }
    setStep("preferences");
  }

  function toggleSelection(product: CatalogProduct) {
    setMessage("");
    setPreviews([]);
    if (selectedIds.includes(product.id)) {
      const nextIds = selectedIds.filter((id) => id !== product.id);
      setSelectedIds(nextIds);
      if (nextIds.length === 0) setSelectionMode(null);
      if (selectionMode === "demo") persistSession(nextIds);
      return;
    }

    const productMode =
      product.provenance === "synthetic" ? "demo" : "production";
    if (selectionMode && selectionMode !== productMode) {
      setMessage("示意商品與正式商品不能放在同一批操作。");
      return;
    }

    if (productMode === "production") {
      const result = toggleProductSelection(
        selectedIds,
        product.id,
        product.ready,
      );
      setSelectedIds(result.selectedIds);
      setSelectionMode(result.selectedIds.length ? "production" : null);
      setMessage(
        result.rejected === "batch-limit"
          ? "每批最多選擇 3 個商品。"
          : result.rejected === "product-not-ready"
            ? "此商品尚未通過資料與素材權利檢查。"
            : "",
      );
      return;
    }

    if (selectedIds.length >= 3) {
      setMessage("每次展示最多選擇 3 個示意商品。");
      return;
    }
    const nextIds = [...selectedIds, product.id];
    setSelectedIds(nextIds);
    setSelectionMode("demo");
    if (sessionLoaded) persistSession(nextIds);
  }

  async function handleStartProductionBatch() {
    if (selectedIds.length === 0 || creatingBatch) return;
    setCreatingBatch(true);
    setMessage("");

    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": window.crypto.randomUUID(),
        },
        body: JSON.stringify({ productIds: selectedIds }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          isErrorResponse(body) ? body.error : "目前無法建立內容批次。",
        );
      }
      if (!isBatchResponse(body)) {
        throw new Error("伺服器未回傳已建立的內容批次。");
      }

      router.push("/production");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "目前無法建立內容批次。",
      );
    } finally {
      setCreatingBatch(false);
    }
  }

  function generatePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedProducts = products
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          product.provenance === "synthetic",
      )
      .map(toDemoProduct);
    if (selectedProducts.length === 0) {
      setMessage("請先選擇至少一個示意商品。");
      setStep("products");
      return;
    }

    const nextPreviews = selectedProducts.map((product) =>
      createDemoContentPreview(product, preferences),
    );
    const entry = createDemoHistoryEntry(selectedProducts, preferences, nextPreviews);
    const nextHistory = [entry, ...history].slice(0, 8);
    setPreviews(nextPreviews);
    setHistory(nextHistory);
    try {
      saveDemoPreferences(preferences);
      persistSession(selectedIds, nextHistory);
      setMessage("偏好與預覽紀錄已保存在這個瀏覽器。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message}；本次預覽仍可繼續。`
          : "本機紀錄未能保存；本次預覽仍可繼續。",
      );
    }
    setStep("preview");
  }

  function updatePreference(key: keyof DemoPreferences, value: string) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function restoreHistory(entry: DemoHistoryEntry) {
    setSelectedIds(entry.products.map((product) => product.id));
    setSelectionMode("demo");
    setPreferences(entry.preferences);
    setPreviews(entry.previews);
    setStep("preview");
    setMessage("已從本機紀錄開啟這次預覽。");
  }

  function clearDemoHistory() {
    setHistory([]);
    setSelectedIds([]);
    setSelectionMode(null);
    setPreviews([]);
    try {
      saveDemoSession({ selectedIds: [], history: [] });
      setMessage("本機選品與預覽紀錄已清除。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "無法清除本機展示紀錄。",
      );
    }
    setStep("products");
  }

  async function copyCaption(preview: DemoContentPreview) {
    const text = createDemoDownloadText(preview);
    try {
      await window.navigator.clipboard.writeText(text);
      setMessage("模擬文案已複製到剪貼簿。");
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      setMessage(
        copied
          ? "模擬文案已複製到剪貼簿。"
          : "複製失敗；請確認瀏覽器允許剪貼簿操作後再試。",
      );
    }
  }

  function downloadCaption(preview: DemoContentPreview, title: string) {
    try {
      const blob = new Blob([createDemoDownloadText(preview)], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|]/g, "-")}-模擬文案.txt`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("文案文字檔已開始下載。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `下載文案失敗：${error.message}`
          : "下載文案失敗，請稍後再試。",
      );
    }
  }

  const demoProducts = products.filter(
    (product) => product.provenance === "synthetic",
  );
  const categories = ["全部品類", ...new Set(demoProducts.map((item) => item.category))];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleProducts = products.filter((product) => {
    if (product.provenance !== "synthetic") {
      return !normalizedSearch || product.title.toLocaleLowerCase().includes(normalizedSearch);
    }
    const categoryMatches = category === "全部品類" || product.category === category;
    const searchMatches =
      !normalizedSearch ||
      [product.title, product.category, product.summary]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    return categoryMatches && searchMatches;
  });

  return (
    <div className="demo-workflow">
      <ol className="demo-stepper" aria-label="示範流程">
        <li className={step === "products" ? "current" : "complete"}>
          <span>1</span> 選擇商品
        </li>
        <li className={step === "preferences" ? "current" : step === "preview" ? "complete" : ""}>
          <span>2</span> 設定偏好
        </li>
        <li className={step === "preview" ? "current" : ""}>
          <span>3</span> 預覽文案
        </li>
      </ol>

      {step === "products" && (
        <>
          <div className="demo-toolbar">
            <label className="demo-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜尋示意商品"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜尋商品名稱或描述"
                value={search}
              />
              {search && (
                <button
                  aria-label="清除搜尋"
                  onClick={() => setSearch("")}
                  type="button"
                >
                  ×
                </button>
              )}
            </label>
            <label className="demo-category-filter">
              <span>商品分類</span>
              <select
                aria-label="商品分類"
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <span className="demo-result-count">{visibleProducts.length} 項商品</span>
          </div>

          <div className="product-grid">
            {visibleProducts.map((product) => {
              const originalIndex = products.findIndex((item) => item.id === product.id);
              const selected = selectedIds.includes(product.id);
              const isDemo = product.provenance === "synthetic";
              return (
                <article
                  className={`product-card${selected ? " selected" : ""}`}
                  key={product.id}
                >
                  <div
                    className={`product-art art-${(originalIndex % 3) + 1}`}
                    aria-hidden="true"
                  >
                    <span className="art-shape shape-main" />
                    <span className="art-shape shape-small" />
                    <span className="art-sparkle">✦</span>
                    <span className="art-label">{isDemo ? "DEMO" : "ITEM"}</span>
                  </div>
                  <div className="product-card-body">
                    <div className="product-card-top">
                      <span className="demo-badge">
                        <span className="demo-dot" />
                        {isDemo
                          ? "合成示意"
                          : product.ready
                            ? "來源已核實"
                            : "資格待確認"}
                      </span>
                      <span className="product-category">
                        {isDemo ? product.category : "商品"}
                      </span>
                    </div>
                    <h3>{product.title}</h3>
                    {isDemo ? (
                      <>
                        <p className="product-summary">{product.summary}</p>
                        <dl className="product-facts">
                          <div>
                            <dt>示意售價</dt>
                            <dd>{product.samplePrice}</dd>
                          </div>
                          <div>
                            <dt>示意分潤</dt>
                            <dd>{product.sampleCommission}</dd>
                          </div>
                        </dl>
                        <button
                          className="product-detail-button"
                          onClick={() => setDetailProduct(product)}
                          type="button"
                        >
                          查看商品詳情與推薦理由
                        </button>
                      </>
                    ) : (
                      <p className="product-summary">
                        {product.ready
                          ? "商品資料與素材資格已通過檢查。"
                          : "需通過商品資料與素材權利檢查後才能製作。"}
                      </p>
                    )}
                    <button
                      aria-pressed={selected}
                      className={`select-button${selected ? " is-selected" : ""}`}
                      disabled={!isDemo && !product.ready}
                      onClick={() => toggleSelection(product)}
                      type="button"
                    >
                      {selected
                        ? "已選取"
                        : isDemo
                          ? "選取做示範"
                          : product.ready
                            ? "選取正式商品"
                            : "尚不可選"}
                      <span>{selected ? "✓" : "+"}</span>
                    </button>
                  </div>
                </article>
              );
            })}
            {visibleProducts.length === 0 && (
              <div className="demo-empty-state">
                <strong>找不到符合條件的商品</strong>
                <p>試試其他關鍵字，或清除分類篩選。</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSearch("");
                    setCategory("全部品類");
                  }}
                  type="button"
                >
                  清除篩選
                </button>
              </div>
            )}
          </div>

          <div className="batch-bar">
            <div className="batch-selection">
              <span className="batch-count">{selectedIds.length}</span>
              <div>
                <strong>
                  {selectionMode === "production"
                    ? "已選擇正式商品"
                    : "已選擇示意商品"}
                </strong>
                <small>
                  {selectionMode === "production"
                    ? "最多 3 個 · 會建立正式內容批次"
                    : "最多 3 個 · 不會建立正式批次"}
                </small>
              </div>
            </div>
            <div className="batch-action">
              {message && <span className="selection-message" role="status">{message}</span>}
              <button
                className="primary-button"
                disabled={selectedIds.length === 0 || creatingBatch}
                onClick={() =>
                  selectionMode === "production"
                    ? void handleStartProductionBatch()
                    : openPreferences()
                }
                type="button"
              >
                {creatingBatch
                  ? "建立中…"
                  : selectionMode === "production"
                    ? "開始正式製作"
                    : "設定偏好並預覽"}
                <span>→</span>
              </button>
            </div>
          </div>

          {history.length > 0 && (
            <section className="demo-history" aria-labelledby="demo-history-title">
              <div className="demo-history-heading">
                <div>
                  <h3 id="demo-history-title">最近的本機預覽</h3>
                  <p>僅保存在這個瀏覽器，不會上傳或建立正式批次。</p>
                </div>
                <button className="text-button" onClick={clearDemoHistory} type="button">
                  清除紀錄
                </button>
              </div>
              <div className="demo-history-list">
                {history.map((entry) => (
                  <button
                    className="demo-history-item"
                    key={entry.id}
                    onClick={() => restoreHistory(entry)}
                    type="button"
                  >
                    <span>
                      {entry.products.map((item) => item.title).join("、")}
                    </span>
                    <small>{formatHistoryDate(entry.createdAt)} · 回看預覽 →</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {step === "preferences" && (
        <section className="demo-panel" aria-labelledby="demo-preferences-title">
          <div className="demo-panel-heading">
            <div>
              <div className="eyebrow">第二步 · 內容偏好</div>
              <h2 id="demo-preferences-title">這次想怎麼分享？</h2>
              <p>設定只保存在本機瀏覽器，供這次模擬文案使用。</p>
            </div>
            <span className="demo-panel-count">{selectedIds.length} 個商品</span>
          </div>
          <form className="demo-preferences-form" onSubmit={generatePreview}>
            {message && <p className="demo-save-status" role="status">{message}</p>}
            {preferenceFields.map(({ key, label, maxLength }) => (
              <label key={key}>
                {label}
                <input
                  maxLength={maxLength}
                  minLength={2}
                  onChange={(event) => updatePreference(key, event.target.value)}
                  required
                  value={preferences[key]}
                />
              </label>
            ))}
            <div className="demo-form-actions">
              <button
                className="secondary-button"
                onClick={() => setStep("products")}
                type="button"
              >
                ← 返回選品
              </button>
              <button className="primary-button" type="submit">
                產生模擬推薦與文案
                <span>→</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {step === "preview" && (
        <section className="demo-panel demo-preview" aria-labelledby="demo-preview-title">
          <div className="demo-panel-heading">
            <div>
              <div className="eyebrow">第三步 · 內容預覽</div>
              <h2 id="demo-preview-title">你的示範內容已準備好</h2>
              <p>以下文字由本機固定模板組合，並非真實 AI 生成。</p>
            </div>
            <span className="simulation-badge">模擬輸出 · 非真實 AI</span>
          </div>
          {message && <p className="demo-save-status" role="status">{message}</p>}
          <div className="demo-preview-list">
            {previews.map((preview) => {
              const product = products.find(({ id }) => id === preview.productId);
              const savedProduct = history
                .flatMap((entry) => entry.products)
                .find(({ id }) => id === preview.productId);
              const title = product?.title ?? savedProduct?.title ?? "示意商品";
              return (
                <article className="demo-preview-card" key={preview.productId}>
                  <div className="demo-preview-product">
                    <span className="demo-dot" />
                    {title}
                  </div>
                  <div className="demo-recommendation">
                    <strong>推薦理由（模擬）</strong>
                    <p>{preview.recommendation}</p>
                  </div>
                  <div className="demo-caption">
                    <strong>社群文案預覽</strong>
                    <pre>{preview.caption}</pre>
                    <div className="caption-actions">
                      <button
                        className="secondary-button"
                        onClick={() => void copyCaption(preview)}
                        type="button"
                      >
                        複製文案
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => downloadCaption(preview, title)}
                        type="button"
                      >
                        下載文字檔
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="demo-form-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setMessage("");
                setStep("preferences");
              }}
              type="button"
            >
              修改偏好並重新產生
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setPreviews([]);
                setMessage("");
                setStep("products");
              }}
              type="button"
            >
              返回選品
              <span>↻</span>
            </button>
          </div>
        </section>
      )}

      {detailProduct && (
        <div
          className="demo-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailProduct(null);
          }}
        >
          <section
            aria-labelledby="demo-detail-title"
            aria-modal="true"
            className="demo-detail-dialog"
            role="dialog"
          >
            <button
              aria-label="關閉商品詳情"
              className="demo-dialog-close"
              onClick={() => setDetailProduct(null)}
              type="button"
            >
              ×
            </button>
            <span className="demo-badge"><span className="demo-dot" /> 合成示意商品</span>
            <h2 id="demo-detail-title">{detailProduct.title}</h2>
            <p>{detailProduct.summary}</p>
            <dl className="product-facts">
              <div><dt>商品分類</dt><dd>{detailProduct.category}</dd></div>
              <div><dt>示意售價</dt><dd>{detailProduct.samplePrice}</dd></div>
              <div><dt>示意分潤</dt><dd>{detailProduct.sampleCommission}</dd></div>
            </dl>
            <div className="demo-recommendation">
              <strong>推薦理由（依目前偏好模擬）</strong>
              <p>
                {createDemoContentPreview(toDemoProduct(detailProduct), preferences).recommendation}
              </p>
            </div>
            <p className="demo-detail-disclaimer">
              以上資訊均為展示用合成資料，未經電商平台核實，亦不代表實際價格、分潤或素材授權。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "日期未知"
    : date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isErrorResponse(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

function isBatchResponse(value: unknown): value is { batch: { id: string } } {
  if (typeof value !== "object" || value === null || !("batch" in value)) {
    return false;
  }
  const batch = value.batch;
  return (
    typeof batch === "object" &&
    batch !== null &&
    "id" in batch &&
    typeof batch.id === "string"
  );
}
