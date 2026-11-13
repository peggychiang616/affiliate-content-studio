export type AuthenticatedPrincipal = {
  id: string;
  mode: "authenticated" | "development-demo";
};

export type PrincipalEnvironment = Record<string, string | undefined>;

export type PrincipalResolver = {
  resolve(request: Request): Promise<AuthenticatedPrincipal | null>;
};

export type AuthenticatedPrincipalProvider = (
  request: Request,
) => Promise<AuthenticatedPrincipal | null>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveDevelopmentPrincipal(
  env: PrincipalEnvironment,
): AuthenticatedPrincipal | null {
  if (env.NODE_ENV !== "development" || env.APP_MODE !== "demo") {
    return null;
  }

  const id = env.DEMO_PRINCIPAL_ID?.trim();
  if (!id || !uuidPattern.test(id)) return null;

  return { id, mode: "development-demo" };
}

export function createPrincipalResolver(
  env: PrincipalEnvironment,
  authenticatedProvider?: AuthenticatedPrincipalProvider,
): PrincipalResolver {
  return {
    async resolve(request) {
      if (authenticatedProvider) return authenticatedProvider(request);
      return resolveDevelopmentPrincipal(env);
    },
  };
}
