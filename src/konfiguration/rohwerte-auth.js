import { csvEnv, stripTrailingSlash } from "./umgebung.js";

function webLoginRohwerte(umgebung) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    ownerIdpSubject: env.OWNER_IDP_SUBJECT || "",
    dashboardPassword: env.DASHBOARD_PASSWORD || "",
    devLoginEnabled:
      boolEnv("DEV_LOGIN_ENABLED", env.DEV_LOGIN_ENABLED, { fallback: false }) &&
      !umgebung.env.RENDER_EXTERNAL_URL,

    sessionSecret: env.SESSION_SECRET || "",
    oidcClientId: env.OIDC_CLIENT_ID || "",
    oidcClientSecret: env.OIDC_CLIENT_SECRET || "",
    workosApiBase: stripTrailingSlash(env.WORKOS_API_BASE || "https://api.workos.com"),
    workosManagementApiKey: env.WORKOS_MANAGEMENT_API_KEY || "",
    adminEmails: csvEnv(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
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

function zugangsTokenRohwerte(env) {
  return {
    mcpAuthToken: env.MCP_AUTH_TOKEN || "",
    mcpAuth: (env.MCP_AUTH || "").toLowerCase(),
    oauthIssuerUrl: stripTrailingSlash(env.OAUTH_ISSUER_URL || ""),
    oauthAudience: env.OAUTH_AUDIENCE || "",
    callConfirmationSecret: env.CALL_CONFIRMATION_SECRET || "",
    deployToken: (env.HERMES_DEPLOY_TOKEN || "").trim(),
  };
}

export function authRohwerte(umgebung) {
  return {
    ...webLoginRohwerte(umgebung),
    ...zugangsTokenRohwerte(umgebung.env),
  };
}
