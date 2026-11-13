import { createPrincipalResolver } from "@/lib/auth/principal";
import { getDatabasePool } from "@/lib/db/pool";
import { listContentGroupsForOwner } from "@/lib/content/workspace";

const principalResolver = createPrincipalResolver(process.env);

export async function GET(request: Request) {
  const principal = await principalResolver.resolve(request);
  if (!principal) {
    return Response.json(
      { error: "目前沒有可用的身分驗證方式，內容工作區未開放。" },
      { status: 401 },
    );
  }

  try {
    const groups = await listContentGroupsForOwner(
      getDatabasePool(),
      principal.id,
    );
    return Response.json({ groups });
  } catch (error) {
    console.error("無法讀取內容工作區。", error);
    return Response.json(
      { error: "目前無法讀取內容工作區，請稍後再試。" },
      { status: 503 },
    );
  }
}
