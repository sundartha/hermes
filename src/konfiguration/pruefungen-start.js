import { existsSync } from "fs";
import path from "path";
import { isInsecureHttpIssuer, isSelfServiceLive } from "./pruefungen-produktion.js";

const isPositiveIntegerFee = (cents) => Number.isInteger(cents) && cents > 0;

const webLoginInfraReady = (config) =>
  Boolean(config.auth.sessionSecret) && config.store.storeBackend === "pg";

const REQUIRED_CONFIG = (config, { llmProvider, begruessungslautPfad }) => [
  { fehlt: () => !config.llm.anthropicApiKey, name: "ANTHROPIC_API_KEY" },
  {
    fehlt: () =>
      (config.llm.llmProvider === llmProvider.DEEPSEEK ||
        config.llm.llmProviderFallback === llmProvider.DEEPSEEK) &&
      !config.llm.deepseekApiKey,
    name: "DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)",
  },
  {
    fehlt: () => !config.server.publicUrl || config.server.publicUrl.includes("CHANGE-ME"),
    name: "PUBLIC_URL",
  },
  {
    fehlt: () => config.auth.mcpAuth === "oauth" && !config.auth.oauthIssuerUrl,
    name: "OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)",
  },
  {
    fehlt: () => config.store.storeBackend === "pg" && !config.store.databaseUrl,
    name: "DATABASE_URL (weil STORE_BACKEND=pg)",
  },
  {
    fehlt: () => config.billing.paymentEnabled && !config.billing.stripeSecretKey,
    name: "STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)",
  },
  {
    fehlt: () => config.billing.paymentEnabled && !config.billing.stripeWebhookSecret,
    name: "STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)",
  },
  {
    fehlt: () =>
      config.billing.paymentEnabled && !isPositiveIntegerFee(config.billing.numberSetupFeeCents),
    name: "NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)",
  },
  {
    fehlt: () =>
      Boolean(config.server.webDistDir) &&
      !existsSync(path.join(config.server.webDistDir, "index.html")),
    name: "WEB_DIST_DIR-Build (kein index.html im angegebenen Verzeichnis - 'astro build' in apps/web?)",
  },
  {
    fehlt: () =>
      config.voice.elevenLabsInbound.begruessungslautEnabled &&
      !existsSync(path.join(config.server.publicDir, begruessungslautPfad)),
    name: `Begruessungslaut-Asset (public${begruessungslautPfad} fehlt - node scripts/render-begruessungslaut.mjs)`,
  },
];

function sharedTokenFindings({ statusToken, deployToken }) {
  if (!statusToken || statusToken !== deployToken) return [];
  return [
    "HERMES_STATUS_TOKEN und HERMES_DEPLOY_TOKEN sind gleich - der Statusschluessel braucht einen eigenen Wert.",
  ];
}

function fatalConfigFindings(config, isProduction, abhaengigkeiten) {
  const { fehlerliste, productionFootguns, alertChannelInputs, alertChannelFindings } =
    abhaengigkeiten;
  const alertChannelConfig = alertChannelInputs({
    billing: config.billing,
    mail: config.mail,
    voice: config.voice,
  });
  return fehlerliste()
    .concat(productionFootguns(config, isProduction))
    .concat(sharedTokenFindings(config.auth))
    .concat(
      alertChannelFindings(alertChannelConfig)
        .filter((befund) => befund.fatal)
        .map((befund) => befund.message),
    );
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

export function pruefungenStartMit(abhaengigkeiten) {
  const { standardConfig, erkenneProduktion, productionAuthHints } = abhaengigkeiten;
  return {
    assertConfig() {
      const config = standardConfig();
      const isProduction = erkenneProduktion();
      const missing = REQUIRED_CONFIG(config, abhaengigkeiten)
        .filter((eintrag) => eintrag.fehlt())
        .map((eintrag) => eintrag.name);
      const fatal = fatalConfigFindings(config, isProduction, abhaengigkeiten);
      if (missing.length || fatal.length) reportFatalConfig(missing, fatal);
      if (!isProduction) warnLocalOnlyFootguns(config);
      warnConfigurationHints(config);
      if (!isProduction && isInsecureHttpIssuer(config.auth.oauthIssuerUrl))
        console.error(
          "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!",
        );
      for (const hint of productionAuthHints(config, isProduction)) console.error(hint);
      return missing.length === 0 && fatal.length === 0;
    },
  };
}
