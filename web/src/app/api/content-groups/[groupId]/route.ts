import { createPrincipalResolver } from "@/lib/auth/principal";
import { getDatabasePool } from "@/lib/db/pool";
import { getContentGroupForOwner } from "@/lib/content/workspace";

const principalResolver = createPrincipalResolver(process.env);

export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  const principal = await principalResolver.resolve(request);
  if (!principal) {
    return Response.json(
      { error: "目前沒有可用的身分驗證方式，內容預覽未開放。" },
      { status: 401 },
    );
  }

  const { groupId } = await context.params;
  try {
    const group = await getContentGroupForOwner(
      getDatabasePool(),
      principal.id,
      groupId,
    );
    if (!group) {
      return Response.json(
        { error: "找不到此內容組。" },
        { status: 404 },
      );
    }
    return Response.json({ group });
  } catch (error) {
    console.error("無法讀取內容預覽。", error);
    return Response.json(
      { error: "目前無法讀取內容預覽，請稍後再試。" },
      { status: 503 },
    );
  }
}
