import { createPrincipalResolver } from "@/lib/auth/principal";
import { BatchCreationError, createContentBatch } from "@/lib/content/batches";
import { getDatabasePool } from "@/lib/db/pool";

const principalResolver = createPrincipalResolver(process.env);

function unauthorizedResponse() {
  return Response.json(
    { error: "目前沒有可用的身分驗證方式，批次製作未開放。" },
    { status: 401 },
  );
}

function isProductIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((productId) => typeof productId === "string")
  );
}

export async function POST(request: Request) {
  const principal = await principalResolver.resolve(request);
  if (!principal) return unauthorizedResponse();

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
    return Response.json(
      { error: "請提供有效的商品清單。" },
      { status: 400 },
    );
  }
  const productIds: unknown = Reflect.get(body, "productIds");
  if (!isProductIdList(productIds)) {
    return Response.json(
      { error: "請提供有效的商品清單。" },
      { status: 400 },
    );
  }

  const requestKey = request.headers.get("Idempotency-Key") ?? "";

  try {
    const batch = await createContentBatch(getDatabasePool(), {
      ownerId: principal.id,
      productIds,
      requestKey,
    });

    return Response.json(
      { batch },
      { status: batch.idempotentReplay ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof BatchCreationError) {
      const status =
        error.code === "product_unavailable"
          ? 404
          : error.code === "invalid_request"
            ? 400
            : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }

    console.error("無法建立內容批次。", error);
    return Response.json(
      { error: "目前無法建立內容批次，請稍後再試。" },
      { status: 503 },
    );
  }
}
