function mcpUndOauth(env, { stripTrailingSlash }) {
  return {
    mcpAuthToken: env.MCP_AUTH_TOKEN || "",
    mcpAuth: (env.MCP_AUTH || "").toLowerCase(),
    oauthIssuerUrl: stripTrailingSlash(env.OAUTH_ISSUER_URL || ""),
    oauthAudience: env.OAUTH_AUDIENCE || "",
  };
}

function sitzungUndOidc(env, { stripTrailingSlash }) {
  return {
    sessionSecret: env.SESSION_SECRET || "",
    oidcClientId: env.OIDC_CLIENT_ID || "",
    oidcClientSecret: env.OIDC_CLIENT_SECRET || "",
    workosApiBase: stripTrailingSlash(env.WORKOS_API_BASE || "https://api.workos.com"),
    workosManagementApiKey: env.WORKOS_MANAGEMENT_API_KEY || "",
  };
}

function betreiberZugaenge(env, { boolEnv, csvEnv }) {
  return {
    webhookZustellungSecret: env.WEBHOOK_ZUSTELLUNG_SECRET || "",
    deployToken: (env.HERMES_DEPLOY_TOKEN || "").trim(),
    statusToken: (env.HERMES_STATUS_TOKEN || "").trim(),
    adminEmails: csvEnv(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    ownerIdpSubject: env.OWNER_IDP_SUBJECT || "",
    dashboardPassword: env.DASHBOARD_PASSWORD || "",
    devLoginEnabled:
      boolEnv("DEV_LOGIN_ENABLED", env.DEV_LOGIN_ENABLED, { fallback: false }) &&
      !env.RENDER_EXTERNAL_URL,
  };
}

function anmeldeGrenzen(env, { numEnv }) {
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

export function rohwerteAuth(env, umgebung) {
  return {
    ...mcpUndOauth(env, umgebung),
    ...sitzungUndOidc(env, umgebung),
    ...betreiberZugaenge(env, umgebung),
    ...anmeldeGrenzen(env, umgebung),
  };
}
