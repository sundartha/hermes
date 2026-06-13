#!/usr/bin/env node
// Setup-Checker: prueft VOR der ersten Demo alle bekannten Stolpersteine.
// Aufruf: npm run check   (Gateway muss fuer den Tunnel-Check laufen: npm start)
import twilio from "twilio";
import { config } from "../src/config.js";

let pass = 0, fail = 0, warn = 0;
const ok = (m) => { pass++; console.log("  \x1b[32m✓\x1b[0m " + m); };
const bad = (m, hint) => { fail++; console.log("  \x1b[31m✗\x1b[0m " + m + (hint ? "\n      → " + hint : "")); };
const wrn = (m, hint) => { warn++; console.log("  \x1b[33m!\x1b[0m " + m + (hint ? "\n      → " + hint : "")); };
const h = (t) => console.log("\n\x1b[1m" + t + "\x1b[0m");
const norm = (n) => (n || "").replace(/[\s\-()]/g, "");

console.log("\n═══ Vodafone Agent — Setup-Check ═══");

// ---------- 1. .env Grundlagen ----------
h("1. Konfiguration (.env)");
config.anthropicApiKey ? ok("ANTHROPIC_API_KEY gesetzt") : bad("ANTHROPIC_API_KEY fehlt");
config.twilioSid && config.twilioToken ? ok("Twilio-Credentials gesetzt") : bad("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN fehlen");
config.twilioNumber ? ok(`TWILIO_NUMBER: ${config.twilioNumber}`) : bad("TWILIO_NUMBER fehlt");
config.publicUrl && !config.publicUrl.includes("CHANGE-ME")
  ? ok(`PUBLIC_URL: ${config.publicUrl}`)
  : bad("PUBLIC_URL fehlt oder ist Platzhalter", "ngrok http " + config.port + " starten und URL eintragen");
config.allowedNumbers.length
  ? ok(`Allowlist: ${config.allowedNumbers.join(", ")}`)
  : wrn("ALLOWED_NUMBERS ist leer", "Outbound-Anrufe sind damit komplett gesperrt");
// Laender-Gate + Widerspruch zur Allowlist (Pre-Mortem 0.2): eine Allowlist-Nummer,
// deren Laendervorwahl nicht erlaubt ist, wuerde VOR der Allowlist am Land-Gate haengen.
if (config.allowedCountryCodes.includes("*")) {
  wrn("Laender-Gate: alle Laendervorwahlen erlaubt (*)", "Bewusst? Das Land-Gate ist damit aus - nur Allowlist + Stundenlimit bremsen");
} else {
  ok(`Laender-Gate: ${config.allowedCountryCodes.join(", ")}`);
  for (const n of config.allowedNumbers) {
    if (!config.allowedCountryCodes.some((c) => norm(n).startsWith(c)))
      bad(`Allowlist-Nummer ${n} passt zu keiner erlaubten Laendervorwahl`, "ALLOWED_COUNTRY_CODES erweitern oder Nummer entfernen - sonst blockt das Land-Gate sie VOR der Allowlist");
  }
}
config.maxCallsPerHour > 0
  ? ok(`Max. Outbound-Calls/Stunde: ${config.maxCallsPerHour}`)
  : wrn(`MAX_CALLS_PER_HOUR ist ${config.maxCallsPerHour}`, "0 oder ungueltig -> jeder Outbound-Call wird gesperrt (Not-Aus)");
config.ownerNumber ? ok(`OWNER_NUMBER: ${config.ownerNumber}`) : wrn("OWNER_NUMBER fehlt", "Keine SMS-Summaries moeglich");
if (config.voiceEngine === "realtime") {
  config.openaiApiKey ? ok("Voice-Engine: realtime, OPENAI_API_KEY gesetzt") : bad("VOICE_ENGINE=realtime, aber OPENAI_API_KEY fehlt");
} else {
  ok("Voice-Engine: budget (Twilio STT/TTS + Claude Haiku)");
}
// MCP-Auth-Modus melden (Detailpruefung fuer oauth weiter unten in Abschnitt 6)
if (config.mcpAuth === "oauth") {
  config.oauthIssuerUrl ? ok(`MCP-Auth: oauth (Issuer ${config.oauthIssuerUrl})`) : bad("MCP_AUTH=oauth, aber OAUTH_ISSUER_URL fehlt");
} else if (config.mcpAuth === "off") {
  wrn("MCP-Auth: off", "/mcp ist OHNE jede Pruefung offen - nur fuer lokale Demos!");
} else if (config.mcpAuth === "token" || config.mcpAuthToken) {
  config.mcpAuthToken ? ok("MCP-Auth: statisches Bearer-Token gesetzt") : bad("MCP_AUTH=token, aber MCP_AUTH_TOKEN fehlt");
} else {
  wrn("MCP-Auth: leer ohne Token", "/mcp ist nur von localhost erreichbar - claude.ai-Connector braucht MCP_AUTH_TOKEN oder MCP_AUTH=oauth");
}

// ---------- 2. Anthropic ----------
h("2. Anthropic API");
if (config.anthropicApiKey) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    });
    if (r.ok) {
      const models = (await r.json()).data?.map((m) => m.id) || [];
      ok("API-Key gueltig");
      models.some((m) => m.startsWith(config.claudeModel))
        ? ok(`Modell verfuegbar: ${config.claudeModel}`)
        : wrn(`Modell '${config.claudeModel}' nicht in der Modell-Liste`, "CLAUDE_MODEL in .env pruefen");
    } else bad(`API-Key abgelehnt (HTTP ${r.status})`, "Key unter console.anthropic.com pruefen");
  } catch (e) { bad("Anthropic nicht erreichbar: " + e.message); }
}

// ---------- 3. Twilio ----------
h("3. Twilio");
let trialAccount = false;
if (config.twilioSid && config.twilioToken) {
  const client = twilio(config.twilioSid, config.twilioToken, { edge: config.twilioEdge });
  try {
    const acct = await client.api.v2010.accounts(config.twilioSid).fetch();
    ok(`Credentials gueltig (Account: ${acct.friendlyName})`);
    trialAccount = acct.type === "Trial";
    trialAccount
      ? wrn("Trial-Account", "Nur verifizierte Zielnummern + Ansage vor jedem Call. Upgrade ~20 EUR entfernt beides.")
      : ok("Voll-Account (keine Trial-Einschraenkungen)");

    // Nummer vorhanden + Webhooks korrekt?
    const nums = await client.incomingPhoneNumbers.list({ limit: 20 });
    const mine = nums.find((n) => norm(n.phoneNumber) === norm(config.twilioNumber));
    if (!mine) {
      bad(`TWILIO_NUMBER ${config.twilioNumber} gehoert nicht zu diesem Account`, "Nummer in der Twilio-Console pruefen");
    } else {
      ok("TWILIO_NUMBER gehoert zum Account");
      const wantVoice = `${config.publicUrl}/voice/incoming`;
      const wantStatus = `${config.publicUrl}/voice/status`;
      norm(mine.voiceUrl) === norm(wantVoice)
        ? ok("Voice-Webhook korrekt gesetzt")
        : bad(`Voice-Webhook ist '${mine.voiceUrl || "(leer)"}'`, `In der Console auf ${wantVoice} (POST) setzen`);
      norm(mine.statusCallback) === norm(wantStatus)
        ? ok("Status-Callback korrekt gesetzt")
        : wrn(`Status-Callback ist '${mine.statusCallback || "(leer)"}'`, `Empfohlen: ${wantStatus} (POST) - sonst keine Summaries bei Inbound-Calls`);
      mine.capabilities?.sms === false && config.sendSmsSummary
        ? wrn("Nummer kann kein SMS", "SEND_SMS_SUMMARY=false setzen oder SMS-faehige Nummer holen")
        : null;
    }

    // Verified Caller IDs vs. Allowlist/Owner (nur im Trial relevant)
    if (trialAccount) {
      const verified = (await client.outgoingCallerIds.list({ limit: 50 })).map((v) => norm(v.phoneNumber));
      for (const n of config.allowedNumbers) {
        verified.includes(norm(n))
          ? ok(`Allowlist-Nummer ${n} ist verifiziert`)
          : bad(`Allowlist-Nummer ${n} ist NICHT verifiziert`, "Console -> Phone Numbers -> Verified Caller IDs");
      }
      if (config.ownerNumber) {
        verified.includes(norm(config.ownerNumber))
          ? ok(`OWNER_NUMBER ist verifiziert (SMS-Summaries moeglich)`)
          : bad(`OWNER_NUMBER ${config.ownerNumber} ist NICHT verifiziert`, "Sonst kommen keine SMS-Summaries an");
      }
    }
  } catch (e) {
    bad("Twilio-Credentials abgelehnt oder API nicht erreichbar: " + e.message);
  }
}

// ---------- 4. OpenAI (nur bei realtime) ----------
if (config.voiceEngine === "realtime" && config.openaiApiKey) {
  h("4. OpenAI (Realtime-Engine)");
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    });
    if (r.ok) {
      const ids = (await r.json()).data?.map((m) => m.id) || [];
      ok("API-Key gueltig");
      ids.includes(config.realtimeModel)
        ? ok(`Realtime-Modell verfuegbar: ${config.realtimeModel}`)
        : wrn(`Modell '${config.realtimeModel}' nicht gelistet`, "Fallback: REALTIME_MODEL=gpt-4o-realtime-preview");
    } else bad(`OpenAI-Key abgelehnt (HTTP ${r.status})`);
  } catch (e) { bad("OpenAI nicht erreichbar: " + e.message); }
}

// ---------- 5. Tunnel: erreicht die Aussenwelt DIESEN Server? ----------
h("5. Oeffentlicher Tunnel (ngrok)");
if (config.publicUrl && !config.publicUrl.includes("CHANGE-ME")) {
  try {
    const [pub, loc] = await Promise.all([
      fetch(`${config.publicUrl}/api/state`, { headers: { "ngrok-skip-browser-warning": "1" } }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`http://localhost:${config.port}/api/state`).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (!loc) {
      wrn("Gateway laeuft lokal nicht", "Erst 'npm start', dann diesen Check erneut ausfuehren");
    } else if (!pub) {
      bad("PUBLIC_URL antwortet nicht", "Laeuft ngrok? URL gewechselt? (ngrok-Free-URLs aendern sich bei jedem Start)");
    } else if (pub.agent?.number === loc.agent?.number && pub.usage?.calls === loc.usage?.calls) {
      ok("Tunnel zeigt auf dieses Gateway - Twilio & Claude-Connector koennen durchgreifen");
    } else {
      wrn("PUBLIC_URL antwortet, scheint aber ein anderer Server zu sein", "ngrok-URL und PUBLIC_URL abgleichen");
    }
  } catch (e) { bad("Tunnel-Check fehlgeschlagen: " + e.message); }
}

// ---------- 6. MCP-OAuth (nur bei MCP_AUTH=oauth) ----------
if (config.mcpAuth === "oauth") {
  h("6. MCP-OAuth (Resource Server)");
  // (a) Issuer erreichbar + Metadata mit jwks_uri (OIDC oder OAuth-2.1-Stil)
  if (config.oauthIssuerUrl) {
    let jwksUri = null;
    for (const p of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"]) {
      try {
        const r = await fetch(`${config.oauthIssuerUrl}${p}`);
        if (r.ok) {
          const meta = await r.json();
          if (meta.jwks_uri) { jwksUri = meta.jwks_uri; break; }
        }
      } catch { /* naechsten Pfad versuchen */ }
    }
    jwksUri
      ? ok(`IdP erreichbar, jwks_uri: ${jwksUri}`)
      : bad("IdP-Metadata nicht erreichbar oder ohne jwks_uri", "OAUTH_ISSUER_URL pruefen");
  }
  // (b) Gateway liefert Protected-Resource-Metadata, (c) /mcp ohne Token -> 401
  try {
    const base = `http://localhost:${config.port}`;
    const meta = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!meta) {
      wrn("Gateway laeuft lokal nicht oder liefert keine Metadata", "Erst 'npm start', dann erneut pruefen");
    } else {
      meta.authorization_servers?.includes(config.oauthIssuerUrl)
        ? ok("Gateway-Metadata zeigt auf den Issuer")
        : bad("Gateway-Metadata-authorization_servers passt nicht zum Issuer");
      const noTok = await fetch(`${base}/mcp`, { method: "POST" }).catch(() => null);
      noTok && noTok.status === 401 && noTok.headers.get("www-authenticate")
        ? ok("/mcp ohne Token -> 401 + WWW-Authenticate")
        : bad(`/mcp ohne Token liefert ${noTok ? noTok.status : "(kein Response)"}`, "Erwartet 401 mit WWW-Authenticate");
    }
  } catch (e) { bad("Gateway-OAuth-Check fehlgeschlagen: " + e.message); }
}

// ---------- Ergebnis ----------
console.log(`\n═══ Ergebnis: \x1b[32m${pass} ok\x1b[0m, \x1b[33m${warn} Warnungen\x1b[0m, \x1b[31m${fail} Fehler\x1b[0m ═══`);
console.log(fail === 0
  ? "Bereit fuer die Demo." + (warn ? " (Warnungen oben lesen)" : "")
  : "Erst die Fehler oben beheben, dann erneut: npm run check");
console.log();
process.exit(fail ? 1 : 0);
