export function webLoginBasisKonfiguration(workosApiBase) {
  return {
    storeBackend: "pg",
    tenancy: { selfServiceEnabled: false, multiTenant: false },
    auth: {
      workosApiBase,
      oidcClientId: "wl_client",
      oidcClientSecret: "wl_secret",
      sessionSecret: "s",
      adminEmails: [],
      loginRateLimitPerMin: 30,
      sessionTtlSeconds: 3600,
      loginCookieTtlSeconds: 600,
      devLoginEnabled: false,
    },
    server: { publicUrl: "http://localhost", webDistDir: "" },
    provisioning: { releaseGraceMs: 0 },
    billing: { paymentEnabled: false },
    safety: { csrfEnforce: true },
    mail: { smtpHost: "" },
  };
}
