import { createPrincipalResolver } from "@/lib/auth/principal";
import {
  confirmContentRevision,
  ContentExportError,
} from "@/lib/content/export";
import { getDatabasePool } from "@/lib/db/pool";

const principalResolver = createPrincipalResolver(process.env);

function exportErrorStatus(error: ContentExportError): number {
  if (error.code === "group_unavailable" || error.code === "revision_unavailable") {
    return 404;
  }
  if (error.code === "invalid_request" || error.code === "confirmation_required") {
    return 400;
  }
  return 409;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  const principal = await principalResolver.resolve(request);
  if (!principal) {
    return Response.json({ error: "目前沒有可用的身分驗證方式。" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "請求內容不是有效的 JSON。" }, { status: 400 });
  }
  const revisionId =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Reflect.get(body, "revisionId")
      : null;
  const confirmed =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Reflect.get(body, "confirmed")
      : false;
  const requestKey = request.headers.get("Idempotency-Key") ?? "";
  if (typeof revisionId !== "string" || typeof confirmed !== "boolean") {
    return Response.json({ error: "請提供內容版本與確認狀態。" }, { status: 400 });
  }

  const { groupId } = await context.params;
  try {
    const result = await confirmContentRevision(getDatabasePool(), {
      ownerId: principal.id,
      groupId,
      revisionId,
      requestKey,
      confirmed,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ContentExportError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: exportErrorStatus(error) },
      );
    }
    console.error("無法確認內容版本。", error);
    return Response.json(
      { error: "目前無法確認內容版本，請稍後再試。" },
      { status: 503 },
    );
  }
}
