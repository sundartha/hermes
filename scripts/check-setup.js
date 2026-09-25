#!/usr/bin/env node
// Setup-Checker: prueft VOR der ersten Demo alle bekannten Stolpersteine.
// Aufruf: npm run check   (Gateway muss fuer den Tunnel-Check laufen: npm start)
import { config } from "../src/config.js";
import * as store from "../src/store.js";
import { findActiveNumber } from "../src/store/views.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Owner-Nummer kommt aus dem Store (der Owner ist Tenant Null). Ohne Provider-Filter:
// seit C-P4 gibt es genau einen Anbieter, ein Filter waere eine Aussage ohne Alternative.
// Leer -> Hinweis aufs Seed-CLI.
const ownerNumber = findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID)?.e164 || "";

let pass = 0,
  fail = 0,
  warn = 0;
const ok = (m) => {
  pass++;
  console.log("  \x1b[32m✓\x1b[0m " + m);
};
const bad = (m, hint) => {
  fail++;
  console.log("  \x1b[31m✗\x1b[0m " + m + (hint ? "\n      → " + hint : ""));
};
const wrn = (m, hint) => {
  warn++;
  console.log("  \x1b[33m!\x1b[0m " + m + (hint ? "\n      → " + hint : ""));
};
const h = (t) => console.log("\n\x1b[1m" + t + "\x1b[0m");

console.log("\n═══ Hermes — Setup-Check ═══");

// ---------- 1. .env Grundlagen ----------
h("1. Konfiguration (.env)");
config.llm.anthropicApiKey ? ok("ANTHROPIC_API_KEY gesetzt") : bad("ANTHROPIC_API_KEY fehlt");
ownerNumber
  ? ok(`Owner-Nummer (Store): ${ownerNumber}`)
  : bad("Keine aktive Owner-Nummer im Store", "npm run seed-owner-number -- <e164> telnyx");
config.server.publicUrl && !config.server.publicUrl.includes("CHANGE-ME")
  ? ok(`PUBLIC_URL: ${config.server.publicUrl}`)
  : bad(
      "PUBLIC_URL fehlt oder ist Platzhalter",
      "ngrok http " + config.server.port + " starten und URL eintragen",
    );
ok("Outbound-Freigabe: per-Tenant-Verifikation (Abo+KYC); keine statische Allowlist mehr");
// Laender-Gate (Pre-Mortem 0.2): begrenzt teure Ziel-Laender. Die statische Allowlist
// entfaellt seit outbound-p3 (Permit = per-Tenant-Verifikation), daher kein Nummern-Cross-Check mehr.
if (config.safety.allowedCountryCodes.includes("*")) {
  wrn(
    "Laender-Gate: alle Laendervorwahlen erlaubt (*)",
    "Bewusst? Das Land-Gate ist damit aus - nur Denylist + Stundenlimit + Verifikation bremsen",
  );
} else {
  ok(`Laender-Gate: ${config.safety.allowedCountryCodes.join(", ")}`);
}
config.safety.maxCallsPerHour > 0
  ? ok(`Max. Outbound-Calls/Stunde: ${config.safety.maxCallsPerHour}`)
  : wrn(
      `MAX_CALLS_PER_HOUR ist ${config.safety.maxCallsPerHour}`,
      "0 oder ungueltig -> jeder Outbound-Call wird gesperrt (Not-Aus)",
    );
ok("Voice-Engine: budget (Telnyx TeXML STT/TTS + Claude Haiku)");
// MCP-Auth-Modus melden (Detailpruefung fuer oauth weiter unten in Abschnitt 5)
if (config.auth.mcpAuth === "oauth") {
  config.auth.oauthIssuerUrl
    ? ok(`MCP-Auth: oauth (Issuer ${config.auth.oauthIssuerUrl})`)
    : bad("MCP_AUTH=oauth, aber OAUTH_ISSUER_URL fehlt");
} else if (config.auth.mcpAuth === "off") {
  wrn("MCP-Auth: off", "/mcp ist OHNE jede Pruefung offen - nur fuer lokale Demos!");
} else if (config.auth.mcpAuth === "token" || config.auth.mcpAuthToken) {
  config.auth.mcpAuthToken
    ? ok("MCP-Auth: statisches Bearer-Token gesetzt")
    : bad("MCP_AUTH=token, aber MCP_AUTH_TOKEN fehlt");
} else {
  wrn(
    "MCP-Auth: leer ohne Token",
    "/mcp ist nur von localhost erreichbar - claude.ai-Connector braucht MCP_AUTH_TOKEN oder MCP_AUTH=oauth",
  );
}

// ---------- 2. Anthropic ----------
h("2. Anthropic API");
if (config.llm.anthropicApiKey) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": config.llm.anthropicApiKey, "anthropic-version": "2023-06-01" },
    });
    if (r.ok) {
      const models = (await r.json()).data?.map((m) => m.id) || [];
      ok("API-Key gueltig");
      models.some((m) => m.startsWith(config.llm.claudeModel))
        ? ok(`Modell verfuegbar: ${config.llm.claudeModel}`)
        : wrn(
            `Modell '${config.llm.claudeModel}' nicht in der Modell-Liste`,
            "CLAUDE_MODEL in .env pruefen",
          );
    } else bad(`API-Key abgelehnt (HTTP ${r.status})`, "Key unter console.anthropic.com pruefen");
  } catch (e) {
    bad("Anthropic nicht erreichbar: " + e.message);
  }
}

// ---------- 4. Tunnel: erreicht die Aussenwelt DIESEN Server? ----------
h("4. Oeffentlicher Tunnel (ngrok)");
if (config.server.publicUrl && !config.server.publicUrl.includes("CHANGE-ME")) {
  try {
    const [pub, loc] = await Promise.all([
      fetch(`${config.server.publicUrl}/api/state`, { headers: { "ngrok-skip-browser-warning": "1" } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`http://localhost:${config.server.port}/api/state`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    if (!loc) {
      wrn("Gateway laeuft lokal nicht", "Erst 'npm start', dann diesen Check erneut ausfuehren");
    } else if (!pub) {
      bad(
        "PUBLIC_URL antwortet nicht",
        "Laeuft ngrok? URL gewechselt? (ngrok-Free-URLs aendern sich bei jedem Start)",
      );
    } else if (pub.agent?.number === loc.agent?.number && pub.usage?.calls === loc.usage?.calls) {
      ok(
        "Tunnel zeigt auf dieses Gateway - Telefonie-Provider & Claude-Connector koennen durchgreifen",
      );
    } else {
      wrn(
        "PUBLIC_URL antwortet, scheint aber ein anderer Server zu sein",
        "ngrok-URL und PUBLIC_URL abgleichen",
      );
    }
  } catch (e) {
    bad("Tunnel-Check fehlgeschlagen: " + e.message);
  }
}

// ---------- 5. MCP-OAuth (nur bei MCP_AUTH=oauth) ----------
if (config.auth.mcpAuth === "oauth") {
  h("5. MCP-OAuth (Resource Server)");
  // (a) Issuer erreichbar + Metadata mit jwks_uri (OIDC oder OAuth-2.1-Stil)
  if (config.auth.oauthIssuerUrl) {
    let jwksUri = null;
    for (const p of [
      "/.well-known/openid-configuration",
      "/.well-known/oauth-authorization-server",
    ]) {
      try {
        const r = await fetch(`${config.auth.oauthIssuerUrl}${p}`);
        if (r.ok) {
          const meta = await r.json();
          if (meta.jwks_uri) {
            jwksUri = meta.jwks_uri;
            break;
          }
        }
      } catch {
        /* naechsten Pfad versuchen */
      }
    }
    jwksUri
      ? ok(`IdP erreichbar, jwks_uri: ${jwksUri}`)
      : bad("IdP-Metadata nicht erreichbar oder ohne jwks_uri", "OAUTH_ISSUER_URL pruefen");
  }
  // (b) Gateway liefert Protected-Resource-Metadata, (c) /mcp ohne Token -> 401
  try {
    const base = `http://localhost:${config.server.port}`;
    const meta = await fetch(`${base}/.well-known/oauth-protected-resource`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!meta) {
      wrn(
        "Gateway laeuft lokal nicht oder liefert keine Metadata",
        "Erst 'npm start', dann erneut pruefen",
      );
    } else {
      meta.authorization_servers?.includes(config.auth.oauthIssuerUrl)
        ? ok("Gateway-Metadata zeigt auf den Issuer")
        : bad("Gateway-Metadata-authorization_servers passt nicht zum Issuer");
      const noTok = await fetch(`${base}/mcp`, { method: "POST" }).catch(() => null);
      noTok && noTok.status === 401 && noTok.headers.get("www-authenticate")
        ? ok("/mcp ohne Token -> 401 + WWW-Authenticate")
        : bad(
            `/mcp ohne Token liefert ${noTok ? noTok.status : "(kein Response)"}`,
            "Erwartet 401 mit WWW-Authenticate",
          );
    }
  } catch (e) {
    bad("Gateway-OAuth-Check fehlgeschlagen: " + e.message);
  }
}

// ---------- Ergebnis ----------
console.log(
  `\n═══ Ergebnis: \x1b[32m${pass} ok\x1b[0m, \x1b[33m${warn} Warnungen\x1b[0m, \x1b[31m${fail} Fehler\x1b[0m ═══`,
);
console.log(
  fail === 0
    ? "Bereit fuer die Demo." + (warn ? " (Warnungen oben lesen)" : "")
    : "Erst die Fehler oben beheben, dann erneut: npm run check",
);
console.log();
process.exit(fail ? 1 : 0);
