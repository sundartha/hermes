import { fuerAudienceVergleich, kanonischeAudience } from "../boot-guard.js";
import { detectProduction } from "./umgebung.js";

export function isInsecureHttpIssuer(issuerUrl) {
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

export function pruefungenMit(config, env) {
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

  return { productionFootguns, productionAuthHints };
}
