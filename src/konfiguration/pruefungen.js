import {
  alertChannelFindings,
  alertChannelInputs,
  fuerAudienceVergleich,
  kanonischeAudience,
} from "../boot-guard.js";
import { LLM_PROVIDER } from "../llm/provider.js";
import { detectProduction } from "./umgebung.js";

function isInsecureHttpIssuer(issuerUrl) {
  return (
    !!issuerUrl &&
    issuerUrl.startsWith("http://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(issuerUrl)
  );
}

const PRODUCTION_FOOTGUNS = Object.freeze([
  {
    trifftZu: (cfg) => !cfg.auth.dashboardPassword,
    befund:
      "DASHBOARD_PASSWORD fehlt - seit AUTH-P7 liest keine Route mehr diese Variable; " +
      "Boot-Pflicht bleibt bis AUTH-P8 ausschliesslich als Rollback-Sicherung (ein " +
      "Rollback auf einen Commit vor AUTH-P7 findet damit ein scharfes Gate vor).",
  },
  {
    trifftZu: (cfg) => cfg.auth.mcpAuth === "off",
    befund: "MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => cfg.safety.skipTwilioSignatureCheck,
    befund:
      "SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => isInsecureHttpIssuer(cfg.auth.oauthIssuerUrl),
    befund: "OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => cfg.store.storeBackend !== "pg",
    befund:
      "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg + DATABASE_URL Pflicht.",
  },
  {
    trifftZu: (cfg) =>
      Boolean(cfg.auth.oauthAudience) &&
      fuerAudienceVergleich(cfg.auth.oauthAudience) !== kanonischeAudience(cfg.server.publicUrl),
    befund:
      "OAUTH_AUDIENCE weicht von der kanonischen MCP-Audience (PUBLIC_URL + /mcp) ab - " +
      "Wert leeren (kanonischer Default) oder exakt darauf setzen.",
  },
  {
    trifftZu: (cfg) => !cfg.server.publicUrlExplicit,
    befund:
      "PUBLIC_URL fehlt - der angekuendigte Origin faellt sonst still auf den " +
      "Hosting-Host zurueck. Pflichtform: https://<host>[:<port>], ohne Pfad/Query/Slash " +
      "am Ende, und exakt der Origin der OpenAI-Einreichung (nicht der Hosting-Host): " +
      "ein Origin-Wechsel nach der Publikation verlangt ein neues Plugin.",
  },
  {
    trifftZu: (cfg, env) => env.DEV_LOGIN_ENABLED === "true",
    befund: "DEV_LOGIN_ENABLED=true - Login-Shim umgeht WorkOS (im Hosting unzulaessig).",
  },
]);

export function isSelfServiceLive(cfg) {
  return Boolean(cfg.tenancy.selfServiceEnabled && cfg.tenancy.multiTenant);
}

const REQUIRED_CONFIG = Object.freeze([
  { fehlt: (config) => !config.llm.anthropicApiKey, name: "ANTHROPIC_API_KEY" },
  {
    fehlt: (config) =>
      (config.llm.llmProvider === LLM_PROVIDER.DEEPSEEK ||
        config.llm.llmProviderFallback === LLM_PROVIDER.DEEPSEEK) &&
      !config.llm.deepseekApiKey,
    name: "DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)",
  },
  {
    fehlt: (config) => !config.server.publicUrl || config.server.publicUrl.includes("CHANGE-ME"),
    name: "PUBLIC_URL",
  },
  {
    fehlt: (config) => config.auth.mcpAuth === "oauth" && !config.auth.oauthIssuerUrl,
    name: "OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)",
  },
  {
    fehlt: (config) => config.store.storeBackend === "pg" && !config.store.databaseUrl,
    name: "DATABASE_URL (weil STORE_BACKEND=pg)",
  },
  {
    fehlt: (config) => config.billing.paymentEnabled && !config.billing.stripeSecretKey,
    name: "STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)",
  },
  {
    fehlt: (config) => config.billing.paymentEnabled && !config.billing.stripeWebhookSecret,
    name: "STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)",
  },
  {
    fehlt: (config) =>
      config.billing.paymentEnabled && !isPositiveIntegerFee(config.billing.numberSetupFeeCents),
    name: "NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)",
  },
]);

const isPositiveIntegerFee = (cents) => Number.isInteger(cents) && cents > 0;

function sharedTokenFindings({ statusToken, deployToken }) {
  if (!statusToken || statusToken !== deployToken) return [];
  return [
    "HERMES_STATUS_TOKEN und HERMES_DEPLOY_TOKEN sind gleich - der Statusschluessel braucht einen eigenen Wert.",
  ];
}

function reportFatalConfig(missing, fatal) {
  console.error("\n[Konfiguration fatal] Boot wird verweigert:");
  for (const name of missing) console.error(`  - fehlt/ungueltig: ${name}`);
  for (const befund of fatal) console.error(`  - ${befund}`);
  console.error("(.env pruefen; .env.example kopieren: cp .env.example .env)\n");
}

function warnLocalOnlyFootguns(config) {
  if (config.safety.skipTwilioSignatureCheck)
    console.error(
      "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!",
    );
  if (config.auth.mcpAuth === "off")
    console.error("[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!");
}

function warnConfigurationHints(config) {
  if (config.billing.paymentEnabled && !config.provisioning.provisioningEnabled)
    console.error(
      "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).",
    );
  if (config.store.storeBackend !== "pg" && config.auth.sessionSecret)
    console.error("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).");
  if (isSelfServiceLive(config) && !webLoginInfraReady(config))
    console.error(
      "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.",
    );
}

const webLoginInfraReady = (config) =>
  Boolean(config.auth.sessionSecret) && config.store.storeBackend === "pg";

export function pruefungenMit(config, beigaben, env) {
  const { fehlerliste, pfadPruefungen } = beigaben;
  const pflichtwerte = [...REQUIRED_CONFIG, ...pfadPruefungen];

  function productionFootguns(cfg = config, isProduction = detectProduction(env)) {
    if (!isProduction) return [];
    return PRODUCTION_FOOTGUNS.filter((footgun) => footgun.trifftZu(cfg, env)).map(
      (footgun) => footgun.befund,
    );
  }

  function productionAuthHints(cfg = config, isProduction = detectProduction(env)) {
    if (!isProduction) return [];
    if (cfg.auth.mcpAuth === "oauth" || cfg.auth.mcpAuth === "off") return [];
    return [
      "[Sicherheit] MCP_AUTH ist nicht 'oauth' - /mcp laeuft im Hosting mit statischem " +
        "Bearer statt OAuth 2.1; Claude-/ChatGPT-Connectoren erhalten 401 (T-5). Kein " +
        "Boot-Stopp (Hinweis).",
    ];
  }

  function fatalConfigFindings(isProduction) {
    const alertChannelConfig = alertChannelInputs({
      billing: config.billing,
      mail: config.mail,
      voice: config.voice,
    });
    return fehlerliste
      .concat(productionFootguns(config, isProduction))
      .concat(sharedTokenFindings(config.auth))
      .concat(
        alertChannelFindings(alertChannelConfig)
          .filter((befund) => befund.fatal)
          .map((befund) => befund.message),
      );
  }

  function assertConfig() {
    const isProduction = detectProduction(env);
    const missing = pflichtwerte
      .filter((eintrag) => eintrag.fehlt(config))
      .map((eintrag) => eintrag.name);
    const fatal = fatalConfigFindings(isProduction);
    if (missing.length || fatal.length) reportFatalConfig(missing, fatal);
    if (!isProduction) warnLocalOnlyFootguns(config);
    warnConfigurationHints(config);
    if (!isProduction && isInsecureHttpIssuer(config.auth.oauthIssuerUrl))
      console.error(
        "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!",
      );
    for (const hint of productionAuthHints(config, isProduction)) console.error(hint);
    return missing.length === 0 && fatal.length === 0;
  }

  return { productionFootguns, productionAuthHints, assertConfig };
}
