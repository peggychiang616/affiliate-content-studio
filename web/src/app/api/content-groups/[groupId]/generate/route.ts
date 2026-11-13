import { createPrincipalResolver } from "@/lib/auth/principal";
import {
  ContentGenerationError,
  generateSourcedContent,
} from "@/lib/content/generation";
import { getDatabasePool } from "@/lib/db/pool";
import {
  createProviderAdapters,
  ProviderAdapterError,
} from "@/lib/providers/adapters";

const principalResolver = createPrincipalResolver(process.env);

function unauthorizedResponse() {
  return Response.json(
    { error: "目前沒有可用的身分驗證方式，內容製作未開放。" },
    { status: 401 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  const principal = await principalResolver.resolve(request);
  if (!principal) return unauthorizedResponse();

  const { groupId } = await context.params;

  try {
    const adapters = createProviderAdapters(process.env);
    const revision = await generateSourcedContent(
      getDatabasePool(),
      adapters,
      principal.id,
      groupId,
    );
    return Response.json({ revision }, { status: 201 });
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      const status = error.code === "group_unavailable" ? 404 : 409;
      return Response.json(
        { error: error.message, code: error.code },
        { status },
      );
    }

    if (error instanceof ProviderAdapterError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }

    console.error("無法產生有來源依據的內容。", error);
    return Response.json(
      { error: "目前無法產生內容，請稍後再試。" },
      { status: 503 },
    );
  }
}
