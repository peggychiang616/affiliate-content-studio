import { createPrincipalResolver } from "@/lib/auth/principal";
import {
  getContentGroupForOwner,
} from "@/lib/content/workspace";
import {
  renderVideoTemplate,
  createVideoTemplate,
  saveValidatedVideoArtifact,
  VideoOutputValidationError,
  VideoTemplateError,
} from "@/lib/content/video";
import { getDatabasePool } from "@/lib/db/pool";
import { listProductsForOwner } from "@/lib/products/repository";
import { getPreferencesVersionForOwner } from "@/lib/preferences/repository";
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
      { error: "目前沒有可用的身分驗證方式，影片製作未開放。" },
      { status: 401 },
    );
  }

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
    return Response.json({ error: "請提供內容版本。" }, { status: 400 });
  }
  const revisionId: unknown = Reflect.get(body, "revisionId");
  if (typeof revisionId !== "string") {
    return Response.json({ error: "請提供內容版本。" }, { status: 400 });
  }

  const { groupId } = await context.params;
  try {
    const database = getDatabasePool();
    const group = await getContentGroupForOwner(
      database,
      principal.id,
      groupId,
    );
    const revision = group?.revisions.find((item) => item.id === revisionId);
    if (!group || !revision) {
      return Response.json(
        { error: "找不到此內容組或內容版本。" },
        { status: 404 },
      );
    }
    if (
      group.status !== "awaiting_review" ||
      group.revisions[0]?.id !== revisionId ||
      group.revisions[0]?.hasVideoArtifact
    ) {
      return Response.json(
        { error: "只有尚未製作影片的待審閱最新版本可以進行渲染。" },
        { status: 409 },
      );
    }

    const product = (await listProductsForOwner(database, principal.id)).find(
      (item) => item.id === group.productId,
    );
    if (!product) {
      return Response.json(
        { error: "找不到此商品或目前使用者無權存取。" },
        { status: 404 },
      );
    }
    const preferences = await getPreferencesVersionForOwner(
      database,
      principal.id,
      revision.preferenceVersion,
    );
    if (!preferences) {
      return Response.json(
        { error: "此內容版本的偏好設定已無法讀取。" },
        { status: 409 },
      );
    }

    const adapters = createProviderAdapters(process.env);
    const template = createVideoTemplate(
      product,
      {
        productSourceVersion: revision.productSourceVersion,
        sourceFactKeys: revision.sourceFacts.map((fact) => fact.key),
        script: revision.script,
        subtitles: revision.subtitles,
        isSynthetic: revision.isSynthetic,
      },
      preferences.voice,
    );
    const rendered = await renderVideoTemplate(
      template,
      adapters,
      revision.isSynthetic,
    );
    const artifactId = await saveValidatedVideoArtifact(database, {
      ownerId: principal.id,
      groupId,
      revisionId,
      productSourceVersion: revision.productSourceVersion,
      sourceAssetId: template.authorizedAssetId,
      artifact: rendered.artifact,
      productionEligible: rendered.productionEligible,
    });

    return Response.json(
      { artifactId, revisionId },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof VideoTemplateError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    if (error instanceof VideoOutputValidationError) {
      return Response.json(
        { error: "影片未通過格式、字幕、音訊或同步檢查。" },
        { status: 422 },
      );
    }
    if (error instanceof ProviderAdapterError) {
      return Response.json(
        {
          error:
            error.code === "not_enabled" ||
            error.code === "adapter_unavailable"
              ? "配音或影片服務尚未通過啟用檢查。"
              : "配音或影片服務目前無法完成工作。",
          code: error.code,
        },
        { status: 503 },
      );
    }
    console.error("無法製作影片。", error);
    return Response.json(
      { error: "目前無法製作影片，請稍後再試。" },
      { status: 503 },
    );
  }
}
