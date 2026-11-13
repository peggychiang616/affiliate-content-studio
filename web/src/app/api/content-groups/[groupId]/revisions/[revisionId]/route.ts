import { createPrincipalResolver } from "@/lib/auth/principal";
import { getDatabasePool } from "@/lib/db/pool";
import {
  ContentWorkspaceError,
  editContentRevision,
} from "@/lib/content/workspace";

const principalResolver = createPrincipalResolver(process.env);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string; revisionId: string }> },
) {
  const principal = await principalResolver.resolve(request);
  if (!principal) {
    return Response.json(
      { error: "目前沒有可用的身分驗證方式，內容修改未開放。" },
      { status: 401 },
    );
  }

  const { groupId, revisionId } = await context.params;
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
    return Response.json({ error: "請提供有效的修改內容。" }, { status: 400 });
  }
  const caption: unknown = Reflect.get(body, "caption");
  const script: unknown = Reflect.get(body, "script");
  const style: unknown = Reflect.get(body, "style");
  const requestKey = request.headers.get("Idempotency-Key") ?? "";
  if (
    typeof caption !== "string" ||
    typeof script !== "string" ||
    typeof style !== "string"
  ) {
    return Response.json(
      { error: "貼文、腳本與風格皆為必填文字。" },
      { status: 400 },
    );
  }

  try {
    const revision = await editContentRevision(getDatabasePool(), {
      ownerId: principal.id,
      groupId,
      parentRevisionId: revisionId,
      requestKey,
      caption,
      script,
      style,
    });
    return Response.json({ revision });
  } catch (error) {
    if (error instanceof ContentWorkspaceError) {
      const status =
        error.code === "group_unavailable" ||
        error.code === "revision_unavailable"
          ? 404
          : error.code === "invalid_edit"
            ? 400
            : 409;
      return Response.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    console.error("無法儲存內容修改。", error);
    return Response.json(
      { error: "目前無法儲存內容修改，請稍後再試。" },
      { status: 503 },
    );
  }
}
