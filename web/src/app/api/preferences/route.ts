import { createPrincipalResolver } from "@/lib/auth/principal";
import { getDatabasePool } from "@/lib/db/pool";
import {
  getPreferencesForOwner,
  savePreferencesForOwner,
} from "@/lib/preferences/repository";
import { validatePreferences } from "@/lib/preferences/validation";

const principalResolver = createPrincipalResolver(process.env);

function unauthorizedResponse() {
  return Response.json(
    { error: "目前沒有可用的身分驗證方式，偏好設定未開放。" },
    { status: 401 },
  );
}

export async function GET(request: Request) {
  const principal = await principalResolver.resolve(request);
  if (!principal) return unauthorizedResponse();

  try {
    const preferences = await getPreferencesForOwner(
      getDatabasePool(),
      principal.id,
    );
    return Response.json({ preferences });
  } catch (error) {
    console.error("無法讀取使用者偏好設定。", error);
    return Response.json(
      { error: "目前無法讀取偏好設定，請稍後再試。" },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
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

  const validation = validatePreferences(body);
  if (!validation.valid) {
    return Response.json({ error: validation.message }, { status: 400 });
  }

  try {
    const preferences = await savePreferencesForOwner(
      getDatabasePool(),
      principal.id,
      validation.value,
    );
    return Response.json({ preferences });
  } catch (error) {
    console.error("無法儲存使用者偏好設定。", error);
    return Response.json(
      { error: "目前無法儲存偏好設定，請稍後再試。" },
      { status: 503 },
    );
  }
}
