import { createPrincipalResolver } from "@/lib/auth/principal";
import {
  ContentGenerationError,
  generateSourcedContent,
} from "@/lib/content/generation";
import {
  ContentWorkspaceError,
  getContentGroupForOwner,
  requestContentGroupAttempt,
} from "@/lib/content/workspace";
import { getDatabasePool } from "@/lib/db/pool";
import {
  createProviderAdapters,
  ProviderAdapterError,
} from "@/lib/providers/adapters";

const principalResolver = createPrincipalResolver(process.env);

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  const principal = await principalResolver.resolve(request);
  if (!principal) {
    return Response.json(
      { error: "目前沒有可用的身分驗證方式，重新製作未開放。" },
      { status: 401 },
    );
  }

  const { groupId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "請求內容不是有效的 JSON。" },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "請提供目前內容版本。" }, { status: 400 });
  }
  const expectedRevisionId: unknown = Reflect.get(body, "revisionId");
  if (typeof expectedRevisionId !== "string") {
    return Response.json({ error: "請提供目前內容版本。" }, { status: 400 });
  }

  const requestKey = request.headers.get("Idempotency-Key") ?? "";
  try {
    const database = getDatabasePool();
    const adapters = createProviderAdapters(process.env);
    const attempt = await requestContentGroupAttempt(database, {
      ownerId: principal.id,
      groupId,
      action: "regenerate",
      requestKey,
      expectedRevisionId,
    });
    if (attempt.idempotentReplay) {
      const group = await getContentGroupForOwner(
        database,
        principal.id,
        groupId,
      );
      if (attempt.status === "failed") {
        return Response.json(
          {
            error: group?.failureReason ?? "此次重新製作失敗，請使用新的請求識別碼再試。",
            attempt,
          },
          { status: 409 },
        );
      }
      return Response.json({ group, attempt }, {
        status: attempt.status === "succeeded" ? 200 : 202,
      });
    }

    const revision = await generateSourcedContent(
      database,
      adapters,
      principal.id,
      groupId,
    );
    return Response.json({ revision, attempt }, { status: 201 });
  } catch (error) {
    if (error instanceof ContentWorkspaceError) {
      const status =
        error.code === "group_unavailable"
          ? 404
          : error.code === "invalid_edit"
            ? 400
            : 409;
      return Response.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    if (error instanceof ContentGenerationError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    if (error instanceof ProviderAdapterError) {
      return Response.json(
        {
          error:
            error.code === "not_enabled" ||
            error.code === "adapter_unavailable"
              ? "內容服務尚未通過啟用檢查，目前無法重新製作。"
              : "內容服務目前無法產生結果，請稍後重試。",
          code: error.code,
        },
        { status: 503 },
      );
    }
    console.error("無法重新製作內容組。", error);
    return Response.json(
      { error: "目前無法重新製作內容組，請稍後再試。" },
      { status: 503 },
    );
  }
}
