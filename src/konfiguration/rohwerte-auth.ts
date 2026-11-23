import type { umgebungMit } from "./umgebung.ts";

type Umgebung = ReturnType<typeof umgebungMit>;

function mcpUndOauth(
  env: {
    MCP_AUTH_TOKEN?: string | undefined;
    MCP_AUTH?: string | undefined;
    OAUTH_ISSUER_URL?: string | undefined;
    OAUTH_AUDIENCE?: string | undefined;
  },
  { stripTrailingSlash }: Pick<Umgebung, "stripTrailingSlash">,
): { mcpAuthToken: string; mcpAuth: string; oauthIssuerUrl: string; oauthAudience: string } {
  return {
    mcpAuthToken: env.MCP_AUTH_TOKEN ?? "",
    mcpAuth: (env.MCP_AUTH ?? "").toLowerCase(),
    oauthIssuerUrl: stripTrailingSlash(env.OAUTH_ISSUER_URL ?? ""),
    oauthAudience: env.OAUTH_AUDIENCE ?? "",
  };
}

function sitzungUndOidc(
  env: {
    SESSION_SECRET?: string | undefined;
    OIDC_CLIENT_ID?: string | undefined;
    OIDC_CLIENT_SECRET?: string | undefined;
    WORKOS_API_BASE?: string | undefined;
    WORKOS_MANAGEMENT_API_KEY?: string | undefined;
  },
  { stripTrailingSlash, textEnv }: Pick<Umgebung, "stripTrailingSlash" | "textEnv">,
): {
  sessionSecret: string;
  oidcClientId: string;
  oidcClientSecret: string;
  workosApiBase: string;
  workosManagementApiKey: string;
} {
  return {
    sessionSecret: env.SESSION_SECRET ?? "",
    oidcClientId: env.OIDC_CLIENT_ID ?? "",
    oidcClientSecret: env.OIDC_CLIENT_SECRET ?? "",
    workosApiBase: stripTrailingSlash(textEnv(env.WORKOS_API_BASE, "https://api.workos.com")),
    workosManagementApiKey: env.WORKOS_MANAGEMENT_API_KEY ?? "",
  };
}

function betreiberZugaenge(
  env: {
    WEBHOOK_ZUSTELLUNG_SECRET?: string | undefined;
    HERMES_DEPLOY_TOKEN?: string | undefined;
    HERMES_STATUS_TOKEN?: string | undefined;
    HERMES_PROBE_TOKEN?: string | undefined;
    ADMIN_EMAILS?: string | undefined;
    OWNER_IDP_SUBJECT?: string | undefined;
    DASHBOARD_PASSWORD?: string | undefined;
    DEV_LOGIN_ENABLED?: string | undefined;
    RENDER_EXTERNAL_URL?: string | undefined;
  },
  { boolEnv, csvEnv }: Pick<Umgebung, "boolEnv" | "csvEnv">,
): {
  webhookZustellungSecret: string;
  deployToken: string;
  statusToken: string;
  probeToken: string;
  adminEmails: string[];
  ownerIdpSubject: string;
  dashboardPassword: string;
  devLoginEnabled: boolean;
} {
  return {
    webhookZustellungSecret: env.WEBHOOK_ZUSTELLUNG_SECRET ?? "",
    deployToken: (env.HERMES_DEPLOY_TOKEN ?? "").trim(),
    statusToken: (env.HERMES_STATUS_TOKEN ?? "").trim(),
    probeToken: (env.HERMES_PROBE_TOKEN ?? "").trim(),
    adminEmails: csvEnv(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    ownerIdpSubject: env.OWNER_IDP_SUBJECT ?? "",
    dashboardPassword: env.DASHBOARD_PASSWORD ?? "",
    devLoginEnabled:
      boolEnv("DEV_LOGIN_ENABLED", env.DEV_LOGIN_ENABLED, { fallback: false }) &&
      !env.RENDER_EXTERNAL_URL,
  };
}

function anmeldeGrenzen(
  env: {
    LOGIN_RATE_LIMIT_PER_MIN?: string | undefined;
    SESSION_TTL_SECONDS?: string | undefined;
    LOGIN_COOKIE_TTL_SECONDS?: string | undefined;
  },
  { numEnv }: Pick<Umgebung, "numEnv">,
): { loginRateLimitPerMin: number; sessionTtlSeconds: number; loginCookieTtlSeconds: number } {
  return {
    loginRateLimitPerMin: numEnv("LOGIN_RATE_LIMIT_PER_MIN", env.LOGIN_RATE_LIMIT_PER_MIN, {
      fallback: 10,
      min: 0,
    }),
    sessionTtlSeconds: numEnv("SESSION_TTL_SECONDS", env.SESSION_TTL_SECONDS, {
      fallback: 3600,
      min: 0,
    }),
    loginCookieTtlSeconds: numEnv("LOGIN_COOKIE_TTL_SECONDS", env.LOGIN_COOKIE_TTL_SECONDS, {
      fallback: 1800,
      min: 0,
    }),
  };
}

export function rohwerteAuth(
  env: Parameters<typeof mcpUndOauth>[0] &
    Parameters<typeof sitzungUndOidc>[0] &
    Parameters<typeof betreiberZugaenge>[0] &
    Parameters<typeof anmeldeGrenzen>[0],
  umgebung: Umgebung,
): ReturnType<typeof mcpUndOauth> &
  ReturnType<typeof sitzungUndOidc> &
  ReturnType<typeof betreiberZugaenge> &
  ReturnType<typeof anmeldeGrenzen> {
  return {
    ...mcpUndOauth(env, umgebung),
    ...sitzungUndOidc(env, umgebung),
    ...betreiberZugaenge(env, umgebung),
    ...anmeldeGrenzen(env, umgebung),
  };
}
