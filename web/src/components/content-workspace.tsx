"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type ContentRevisionView = {
  id: string;
  revision: number;
  parentRevisionId: string | null;
  productSourceVersion: string;
  preferenceVersion: number;
  sourceFacts: Array<{
    key: string;
    value: string;
    sourceReference: string;
    sourceVersion: string;
  }>;
  caption: string;
  script: string;
  subtitles: string[];
  style: string;
  isSynthetic: boolean;
  hasVideoArtifact: boolean;
  confirmedAt: string | null;
  createdAt: string;
};

type ContentPreview = {
  revisionId: string;
  videoUrl: string;
  expiresAt: string;
};

type ExportedContent = {
  caption: string;
  videoUrl: string;
  expiresAt: string;
  disclosure: { text: string; placement: "caption-footer" };
};

type ContentGroupView = {
  id: string;
  batchId: string;
  productId: string;
  productTitle: string;
  variantIndex: number;
  status: string;
  failureReason: string | null;
  createdAt: string;
  revisions: ContentRevisionView[];
  attempts: Array<{
    id: string;
    attempt: number;
    status: string;
    failureCode: string | null;
    createdAt: string;
    finishedAt: string | null;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFromResponse(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}

function isContentRevision(value: unknown): value is ContentRevisionView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.revision === "number" &&
    (typeof value.parentRevisionId === "string" ||
      value.parentRevisionId === null) &&
    typeof value.productSourceVersion === "string" &&
    typeof value.preferenceVersion === "number" &&
    Array.isArray(value.sourceFacts) &&
    value.sourceFacts.every(
      (fact) =>
        isRecord(fact) &&
        typeof fact.key === "string" &&
        typeof fact.value === "string" &&
        typeof fact.sourceReference === "string" &&
        typeof fact.sourceVersion === "string",
    ) &&
    typeof value.caption === "string" &&
    typeof value.script === "string" &&
    Array.isArray(value.subtitles) &&
    value.subtitles.every((subtitle) => typeof subtitle === "string") &&
    typeof value.style === "string" &&
    typeof value.isSynthetic === "boolean" &&
    typeof value.hasVideoArtifact === "boolean" &&
    (typeof value.confirmedAt === "string" || value.confirmedAt === null) &&
    typeof value.createdAt === "string"
  );
}

function isContentPreview(value: unknown): value is Omit<ContentPreview, "revisionId"> {
  return (
    isRecord(value) &&
    typeof value.videoUrl === "string" &&
    typeof value.expiresAt === "string"
  );
}

function isExportedContent(value: unknown): value is ExportedContent {
  return (
    isRecord(value) &&
    typeof value.caption === "string" &&
    typeof value.videoUrl === "string" &&
    typeof value.expiresAt === "string" &&
    isRecord(value.disclosure) &&
    typeof value.disclosure.text === "string" &&
    value.disclosure.placement === "caption-footer"
  );
}

function isContentGroup(value: unknown): value is ContentGroupView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.batchId === "string" &&
    typeof value.productId === "string" &&
    typeof value.productTitle === "string" &&
    typeof value.variantIndex === "number" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    (typeof value.failureReason === "string" || value.failureReason === null) &&
    Array.isArray(value.revisions) &&
    value.revisions.every(isContentRevision) &&
    Array.isArray(value.attempts) &&
    value.attempts.every(
      (attempt) =>
        isRecord(attempt) &&
        typeof attempt.id === "string" &&
        typeof attempt.attempt === "number" &&
        typeof attempt.status === "string" &&
        (typeof attempt.failureCode === "string" ||
          attempt.failureCode === null) &&
        typeof attempt.createdAt === "string" &&
        (typeof attempt.finishedAt === "string" ||
          attempt.finishedAt === null),
    )
  );
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    queued: "等待製作",
    producing: "製作中",
    awaiting_review: "待你審閱",
    blocked: "已阻擋",
    failed: "製作失敗",
    confirmed: "已確認",
    exported: "已匯出",
  };
  return labels[status] ?? status;
}

export function ContentWorkspace() {
  const [groups, setGroups] = useState<ContentGroupView[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const selectedGroupIdRef = useRef("");
  const selectedRevisionIdRef = useRef("");
  const [caption, setCaption] = useState("");
  const [script, setScript] = useState("");
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<"retry" | "regenerate" | null>(null);
  const [preview, setPreview] = useState<ContentPreview | null>(null);
  const [exportedContent, setExportedContent] = useState<ExportedContent | null>(
    null,
  );
  const [confirmationAcknowledged, setConfirmationAcknowledged] =
    useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadGroups() {
      try {
        const response = await fetch("/api/content-groups", {
          cache: "no-store",
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          throw new Error(errorFromResponse(body, "無法讀取內容工作區。"));
        }
        if (
          !isRecord(body) ||
          !Array.isArray(body.groups) ||
          !body.groups.every(isContentGroup)
        ) {
          throw new Error("伺服器回傳的內容工作區格式不正確。");
        }
        if (!active) return;

        const nextGroups = body.groups;
        const selectedGroup =
          nextGroups.find(
            (group) => group.id === selectedGroupIdRef.current,
          ) ??
          nextGroups[0] ??
          null;
        const selectedRevision =
          selectedGroup?.revisions.find(
            (revision) => revision.id === selectedRevisionIdRef.current,
          ) ??
          selectedGroup?.revisions[0] ??
          null;
        selectedGroupIdRef.current = selectedGroup?.id ?? "";
        selectedRevisionIdRef.current = selectedRevision?.id ?? "";
        setGroups(nextGroups);
        setSelectedGroupId(selectedGroup?.id ?? "");
        setSelectedRevisionId(selectedRevision?.id ?? "");
        setCaption(selectedRevision?.caption ?? "");
        setScript(selectedRevision?.script ?? "");
        setStyle(selectedRevision?.style ?? "");
        setError("");
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "無法讀取內容工作區。",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadGroups();
    return () => {
      active = false;
    };
  }, [refreshVersion]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const selectedRevision = useMemo(() => {
    if (!selectedGroup) return null;
    return (
      selectedGroup.revisions.find(
        (revision) => revision.id === selectedRevisionId,
      ) ??
      selectedGroup.revisions[0] ??
      null
    );
  }, [selectedGroup, selectedRevisionId]);
  const hasCurrentPreview = Boolean(
    selectedRevision && preview?.revisionId === selectedRevision.id,
  );

  async function submitAction(
    url: string,
    method: "PATCH" | "POST",
    body: unknown,
    fallback: string,
  ) {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": window.crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorFromResponse(result, fallback));
      }
      if (isRecord(result) && isRecord(result.revision)) {
        const revisionId = result.revision.id;
        if (typeof revisionId === "string") {
          selectedRevisionIdRef.current = revisionId;
          setSelectedRevisionId(revisionId);
        }
      } else if (isRecord(result) && isRecord(result.group)) {
        const latestRevision = result.group.revisions;
        if (
          Array.isArray(latestRevision) &&
          isContentRevision(latestRevision[0])
        ) {
          selectedRevisionIdRef.current = latestRevision[0].id;
          setSelectedRevisionId(latestRevision[0].id);
        }
      }
      setMessage(fallback);
      setPreview(null);
      setExportedContent(null);
      setConfirmationAcknowledged(false);
      setRefreshVersion((current) => current + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : fallback,
      );
      if (method === "POST") {
        setRefreshVersion((current) => current + 1);
      }
    } finally {
      setSaving(false);
      setAction(null);
    }
  }

  function saveEdit() {
    if (!selectedGroup || !selectedRevision) return;
    void submitAction(
      `/api/content-groups/${selectedGroup.id}/revisions/${selectedRevision.id}`,
      "PATCH",
      { caption, script, style },
      "修改已保存為新的內容版本。",
    );
  }

  function runGroupAction(nextAction: "retry" | "regenerate") {
    if (!selectedGroup) return;
    if (nextAction === "regenerate" && !selectedRevision) return;
    setAction(nextAction);
    const url = `/api/content-groups/${selectedGroup.id}/${nextAction}`;
    void submitAction(
      url,
      "POST",
      nextAction === "regenerate"
        ? { revisionId: selectedRevision?.id }
        : {},
      nextAction === "retry" ? "失敗組已重新排入工作。" : "已建立新的內容版本。",
    );
  }

  async function runReviewAction(
    nextAction: "render" | "preview" | "confirm" | "export",
  ) {
    if (!selectedGroup || !selectedRevision) return;
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const response = await fetch(
        `/api/content-groups/${selectedGroup.id}/${nextAction}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(nextAction === "preview"
              ? {}
              : { "Idempotency-Key": window.crypto.randomUUID() }),
          },
          body: JSON.stringify(
            nextAction === "confirm"
              ? {
                  revisionId: selectedRevision.id,
                  confirmed: confirmationAcknowledged,
                }
              : { revisionId: selectedRevision.id },
          ),
        },
      );
      const result: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorFromResponse(result, "無法完成此內容動作。"));
      }

      if (nextAction === "preview") {
        if (!isContentPreview(result)) {
          throw new Error("伺服器回傳的影片預覽格式不正確。");
        }
        setPreview({ ...result, revisionId: selectedRevision.id });
        setExportedContent(null);
        setMessage("短片預覽已載入；請先檢視影片與來源資料。");
      } else if (nextAction === "confirm") {
        setConfirmationAcknowledged(false);
        setMessage("此內容版本已確認。");
        setRefreshVersion((current) => current + 1);
      } else if (nextAction === "render") {
        if (!isRecord(result) || typeof result.artifactId !== "string") {
          throw new Error("伺服器回傳的影片素材格式不正確。");
        }
        setPreview(null);
        setMessage("影片已通過檢查並保存，可載入短效預覽連結。");
        setRefreshVersion((current) => current + 1);
      } else {
        if (!isExportedContent(result)) {
          throw new Error("伺服器回傳的匯出內容格式不正確。");
        }
        setExportedContent(result);
        setMessage("內容匯出連結已建立，請於期限內下載。");
        setRefreshVersion((current) => current + 1);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "無法完成此內容動作。",
      );
      if (nextAction !== "preview") {
        setRefreshVersion((current) => current + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="小幫手工作台首頁">
          <span className="brand-mark">沐</span>
          <span>
            <strong>分潤內容工作室</strong>
            <small>CONTENT STUDIO</small>
          </span>
        </Link>
        <div className="workspace-label">工作空間</div>
        <nav className="main-nav" aria-label="主要導覽">
          <Link className="nav-item" href="/">
            <span className="nav-icon">▦</span>
            商品選品
          </Link>
          <Link className="nav-item active" href="/production">
            <span className="nav-icon">✳</span>
            內容製作
          </Link>
          <Link className="nav-item" href="/settings">
            <span className="nav-icon">⚙</span>
            內容偏好
          </Link>
        </nav>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <Link href="/">商品選品</Link>
            <span className="breadcrumb-separator">/</span>
            <strong>內容製作</strong>
          </div>
          <span className="mode-pill">
            <span className="status-dot" />
            逐組審閱
          </span>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">內容製作 · 02</div>
              <h1>每一組內容，都由你把關。</h1>
              <p className="page-intro">
                逐組預覽文字、核對來源並保存版本；失敗時只重試受影響的內容組。
              </p>
            </div>
            <Link className="secondary-button" href="/">
              回到選品
            </Link>
          </section>

          {error && (
            <div className="workspace-alert" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="workspace-success" role="status">
              {message}
            </div>
          )}

          {loading ? (
            <div className="workspace-empty">正在載入內容組…</div>
          ) : groups.length === 0 ? (
            <div className="workspace-empty">
              <strong>目前還沒有內容組</strong>
              <p>先從已通過來源與素材權利檢查的商品建立批次。</p>
              <Link className="primary-button" href="/">
                前往商品選品 <span>→</span>
              </Link>
            </div>
          ) : (
            <div className="workspace-layout">
              <aside className="group-list" aria-label="內容組清單">
                {groups.map((group) => (
                  <button
                    className={`group-list-item${selectedGroupId === group.id ? " is-active" : ""}`}
                    key={group.id}
                    onClick={() => {
                      selectedGroupIdRef.current = group.id;
                      selectedRevisionIdRef.current =
                        group.revisions[0]?.id ?? "";
                      setSelectedGroupId(group.id);
                      setSelectedRevisionId(group.revisions[0]?.id ?? "");
                      setCaption(group.revisions[0]?.caption ?? "");
                      setScript(group.revisions[0]?.script ?? "");
                      setStyle(group.revisions[0]?.style ?? "");
                      setPreview(null);
                      setExportedContent(null);
                      setConfirmationAcknowledged(false);
                    }}
                    type="button"
                  >
                    <strong>{group.productTitle}</strong>
                    <span>敘事版本 {group.variantIndex}</span>
                    <small>{formatStatus(group.status)}</small>
                  </button>
                ))}
              </aside>

              {selectedGroup && (
                <section className="group-detail">
                  <div className="group-detail-heading">
                    <div>
                      <span className="status-pill">
                        {formatStatus(selectedGroup.status)}
                      </span>
                      <h2>{selectedGroup.productTitle}</h2>
                      <p>敘事版本 {selectedGroup.variantIndex}</p>
                    </div>
                    {selectedGroup.status === "failed" && (
                      <button
                        className="primary-button"
                        disabled={saving}
                        onClick={() => runGroupAction("retry")}
                        type="button"
                      >
                        {action === "retry" ? "重試中…" : "只重試此組"}
                      </button>
                    )}
                  </div>

                  {selectedGroup.failureReason && (
                    <div className="workspace-alert" role="alert">
                      {selectedGroup.failureReason}
                    </div>
                  )}

                  {selectedGroup.revisions.length > 0 ? (
                    <>
                      <div className="revision-history">
                        <label htmlFor="revision-select">版本歷史</label>
                        <select
                          id="revision-select"
                          onChange={(event) => {
                            const revisionId = event.target.value;
                            const revision = selectedGroup.revisions.find(
                              (item) => item.id === revisionId,
                            );
                            selectedRevisionIdRef.current = revisionId;
                            setSelectedRevisionId(revisionId);
                            setCaption(revision?.caption ?? "");
                            setScript(revision?.script ?? "");
                            setStyle(revision?.style ?? "");
                            setPreview(null);
                            setExportedContent(null);
                            setConfirmationAcknowledged(false);
                          }}
                          value={selectedRevision?.id ?? ""}
                        >
                          {selectedGroup.revisions.map((revision) => (
                            <option key={revision.id} value={revision.id}>
                              v{revision.revision} · 偏好 v{revision.preferenceVersion}
                              {revision.isSynthetic ? " · 合成示意" : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedRevision && (
                        <>
                          {selectedRevision.isSynthetic && (
                            <div className="workspace-alert">
                              此版本含合成示意輸出，不可作為正式內容匯出。
                            </div>
                          )}
                          <div className="content-preview-grid">
                            <div className="preview-card">
                              <h3>貼文預覽</h3>
                              <pre>{selectedRevision.caption}</pre>
                            </div>
                            <div className="preview-card video-placeholder">
                              <h3>短片預覽</h3>
                              {selectedRevision.hasVideoArtifact &&
                              preview?.revisionId === selectedRevision.id ? (
                                <>
                                  <video
                                    controls
                                    preload="metadata"
                                    src={preview.videoUrl}
                                  >
                                    您的瀏覽器不支援影片預覽。
                                  </video>
                                  <small>
                                    預覽連結有效期限：{" "}
                                    {new Date(preview.expiresAt).toLocaleTimeString(
                                      "zh-TW",
                                    )}
                                  </small>
                                </>
                              ) : (
                                <p>
                                  {selectedRevision.hasVideoArtifact
                                    ? "影片已通過輸出檢查；載入短效授權連結後才可預覽。"
                                    : "尚無通過檢查的影片；目前不會以佔位內容冒充可播放成果。"}
                                </p>
                              )}
                              {!selectedRevision.hasVideoArtifact &&
                                !selectedRevision.isSynthetic && (
                                  <button
                                    className="secondary-button"
                                    disabled={saving}
                                    onClick={() => runReviewAction("render")}
                                    type="button"
                                  >
                                    {saving ? "製作中…" : "製作短片"}
                                  </button>
                                )}
                              {selectedRevision.hasVideoArtifact && (
                                <button
                                  className="secondary-button"
                                  disabled={saving}
                                  onClick={() => runReviewAction("preview")}
                                  type="button"
                                >
                                  {hasCurrentPreview ? "重新載入預覽" : "載入短片預覽"}
                                </button>
                              )}
                              <small>來源版本：{selectedRevision.productSourceVersion}</small>
                            </div>
                          </div>

                          <div className="source-facts">
                            <h3>本版本使用的已核實事實</h3>
                            <ul>
                              {selectedRevision.sourceFacts.map((fact) => (
                                <li key={`${fact.sourceVersion}:${fact.key}`}>
                                  <strong>{fact.key}：</strong>
                                  {fact.value}
                                  <a
                                    href={fact.sourceReference}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    查看來源
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {selectedRevision.hasVideoArtifact &&
                            !selectedRevision.isSynthetic &&
                            (selectedRevision.confirmedAt ? (
                              <section className="revision-review">
                                <p>
                                  已於{" "}
                                  {new Date(
                                    selectedRevision.confirmedAt,
                                  ).toLocaleString("zh-TW")}{" "}
                                  確認此版本。匯出時會在貼文末尾加入聯盟行銷揭露。
                                </p>
                                <button
                                  className="primary-button"
                                  disabled={saving}
                                  onClick={() => runReviewAction("export")}
                                  type="button"
                                >
                                  {saving ? "匯出中…" : "匯出已確認內容"}
                                </button>
                              </section>
                            ) : (
                              <section className="revision-review">
                                <label>
                                  <input
                                    checked={confirmationAcknowledged}
                                    disabled={saving || !hasCurrentPreview}
                                    onChange={(event) =>
                                      setConfirmationAcknowledged(
                                        event.target.checked,
                                      )
                                    }
                                    type="checkbox"
                                  />
                                  我已預覽短片並核對內容事實與素材使用權，確認此版本可供我自行使用。
                                </label>
                                <button
                                  className="primary-button"
                                  disabled={
                                    saving ||
                                    !hasCurrentPreview ||
                                    !confirmationAcknowledged
                                  }
                                  onClick={() => runReviewAction("confirm")}
                                  type="button"
                                >
                                  {saving ? "確認中…" : "確認此版本"}
                                </button>
                              </section>
                            ))}

                          {exportedContent && (
                            <section className="revision-review" aria-live="polite">
                              <h3>匯出內容</h3>
                              <p>{exportedContent.caption}</p>
                              <p>{exportedContent.disclosure.text}</p>
                              <a
                                className="primary-button"
                                href={exportedContent.videoUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                下載短片
                              </a>
                              <small>
                                下載連結於{" "}
                                {new Date(
                                  exportedContent.expiresAt,
                                ).toLocaleTimeString("zh-TW")}{" "}
                                失效。
                              </small>
                            </section>
                          )}

                          <form
                            className="revision-editor"
                            onSubmit={(event) => {
                              event.preventDefault();
                              saveEdit();
                            }}
                          >
                            <div className="section-title-row">
                              <h3>修改此版本</h3>
                              <span>保存後會建立新版本，不覆寫歷史</span>
                            </div>
                            <label>
                              貼文文字
                              <textarea
                                maxLength={2_000}
                                onChange={(event) => setCaption(event.target.value)}
                                required
                                rows={4}
                                value={caption}
                              />
                            </label>
                            <label>
                              旁白與字幕腳本
                              <textarea
                                maxLength={4_000}
                                onChange={(event) => setScript(event.target.value)}
                                required
                                rows={5}
                                value={script}
                              />
                            </label>
                            <label>
                              內容風格
                              <input
                                maxLength={80}
                                minLength={2}
                                onChange={(event) => setStyle(event.target.value)}
                                required
                                value={style}
                              />
                            </label>
                            <div className="revision-actions">
                              <button
                                className="secondary-button"
                                disabled={saving || selectedGroup.status !== "awaiting_review"}
                                onClick={() => runGroupAction("regenerate")}
                                type="button"
                              >
                                {action === "regenerate" ? "重新製作中…" : "重新製作"}
                              </button>
                              <button
                                className="primary-button"
                                disabled={
                                  saving || selectedGroup.status !== "awaiting_review"
                                }
                                type="submit"
                              >
                                {saving ? "保存中…" : "保存為新版本"}
                              </button>
                            </div>
                          </form>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="workspace-empty">
                      <strong>尚未有可審閱內容</strong>
                      <p>
                        {selectedGroup.failureReason ??
                          "此組仍在等待製作或尚未產生內容。"}
                      </p>
                    </div>
                  )}

                  <div className="attempt-history">
                    <h3>工作與重試紀錄</h3>
                    <ol>
                      {selectedGroup.attempts.map((attempt) => (
                        <li key={attempt.id}>
                          第 {attempt.attempt} 次 · {formatStatus(attempt.status)}
                          {attempt.failureCode ? ` · ${attempt.failureCode}` : ""}
                        </li>
                      ))}
                    </ol>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
