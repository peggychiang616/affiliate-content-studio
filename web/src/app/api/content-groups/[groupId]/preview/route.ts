import { createPrincipalResolver } from "@/lib/auth/principal";
import {
  ContentExportError,
  createContentPreviewLink,
} from "@/lib/content/export";
import { getDatabasePool } from "@/lib/db/pool";

const principalResolver = createPrincipalResolver(process.env);

function exportErrorStatus(error: ContentExportError): number {
  if (error.code === "group_unavailable" || error.code === "revision_unavailable") {
    return 404;
  }
  if (error.code === "media_signer_unavailable") return 503;
  return error.code === "invalid_request" ? 400 : 409;
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
  if (typeof revisionId !== "string") {
    return Response.json({ error: "請提供內容版本。" }, { status: 400 });
  }

  const { groupId } = await context.params;
  try {
    const preview = await createContentPreviewLink(getDatabasePool(), {
      ownerId: principal.id,
      groupId,
      revisionId,
      signer: null,
    });
    return Response.json(preview);
  } catch (error) {
    if (error instanceof ContentExportError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: exportErrorStatus(error) },
      );
    }
    console.error("無法建立短片預覽。", error);
    return Response.json(
      { error: "目前無法建立短片預覽，請稍後再試。" },
      { status: 503 },
    );
  }
}
