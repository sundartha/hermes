// OUTBOUND-E4 Review-Blocker (Blocker 6, Review Runde 2): scripts/check-outbound-drift.mjs
// (142 Zeilen Produktionscode) hatte KEINEN einzigen automatisierten Test - Bestandstests
// pruefen die Datei nur per Quelltext-Grep. Muster test/check-setup-script.test.js: der
// echte Kindprozess laeuft, KEIN Netz ausserhalb eines LOKALEN Stub-Servers auf 127.0.0.1
// (kein echter Anbieter-Aufruf).
//
// (a) Negativ-Kontrolle: OHNE TELNYX_API_KEY -> Exit 1 + Fail-closed-Meldung, VOR jedem
//     Netzzugriff (schluesselFehlt()).
// (b) Positiv-Kontrolle: gegen einen lokalen Stub-Server, der beide Anbieter-Basen
//     (Telnyx UND ElevenLabs, unterschiedliche Pfad-Praefixe, EIN Server reicht) bedient
//     -> Exit 0, die Umfangszeile "N von 9" und der D7-Anker "pruefung3 ownership=ok" im
//     stdout (Plan-Abnahmepunkt D7, woertlich verlangt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { ROOT } from "./helpers.js";

const PLATFORM_ANI = "+15551230099"; // fiktive Test-ANI, kein echter Anbieter-Kontakt
const AGENT_ID = "agent_stub_test";
const AGENT_PHONE_NUMBER_ID = "phnum_stub_test";
const FQDN_CONNECTION_ID = "conn_stub_test";
const OVP_ID = "ovp_stub_test";
const SPAWN_TIMEOUT_MS = 8000;
const HTTP_NOT_FOUND = 404;

function runCheckOutboundDrift(env) {
  const child = spawn(process.execPath, ["scripts/check-outbound-drift.mjs"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`check-outbound-drift.mjs ist nicht rechtzeitig beendet. Output bisher:\n${output}`));
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

// EIN lokaler Stub fuer BEIDE Anbieter-Basen (Telnyx UND ElevenLabs) - die Pfade
// ueberschneiden sich nicht (/v2/... vs. /v1/convai/...), ein Server reicht. Antwortet
// GESUND auf alle sechs Telnyx-GETs + den EL-GET, ECHOT die angefragte Rufnummer bei
// /v2/phone_numbers als kontoeigen zurueck (Pruefung 3 UND ein etwaiger Pruefung-9-Aufruf
// treffen so unabhaengig davon, welche E.164 tatsaechlich gefragt wird).
function startStubServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/v2/phone_numbers") {
      const e164 = url.searchParams.get("filter[phone_number]");
      res.end(JSON.stringify({ data: [{ phone_number: e164, status: "active" }] }));
      return;
    }
    if (url.pathname === "/v2/verified_numbers") {
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (url.pathname === `/v2/fqdn_connections/${FQDN_CONNECTION_ID}`) {
      res.end(JSON.stringify({ data: { active: true, outbound: { ani_override: PLATFORM_ANI } } }));
      return;
    }
    if (url.pathname === "/v2/fqdns") {
      res.end(JSON.stringify({ data: [{ connection_id: FQDN_CONNECTION_ID }] }));
      return;
    }
    if (url.pathname === `/v2/outbound_voice_profiles/${OVP_ID}`) {
      res.end(JSON.stringify({ data: { enabled: true, whitelisted_destinations: ["DE"] } }));
      return;
    }
    if (url.pathname === "/v2/balance") {
      res.end(JSON.stringify({ data: { available_credit: "10000.00" } }));
      return;
    }
    if (url.pathname === `/v1/convai/phone-numbers/${AGENT_PHONE_NUMBER_ID}`) {
      // KEIN supports_outbound-Feld (K-15, entspricht der real beobachteten EL-Antwort) -
      // der zugehoerige unbekannt:pruefung1_supports_outbound-Befund ist in
      // outbound-drift-ausnahmen.json deklariert ausgenommen.
      res.end(JSON.stringify({ phone_number: PLATFORM_ANI, assigned_agent: { agent_id: AGENT_ID } }));
      return;
    }
    res.writeHead(HTTP_NOT_FOUND); // content-type ist bereits oben gesetzt (setHeader, alle Pfade)
    res.end(JSON.stringify({ errors: [{ detail: `Stub kennt ${url.pathname} nicht` }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stopStubServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("check-outbound-drift.mjs: Negativ-Kontrolle - OHNE TELNYX_API_KEY -> Exit 1, Fail-closed-Meldung, KEIN Netzzugriff", async () => {
  const { code, output } = await runCheckOutboundDrift({});
  assert.equal(code, 1, "ohne Schluessel muss der Lauf mit Exit 1 enden");
  assert.match(output, /Fehler \(fail-closed\)/, "die Meldung muss den Fail-closed-Anker tragen");
  assert.match(output, /TELNYX_API_KEY fehlt/, "der Grund muss den fehlenden Schluessel nennen");
  assert.doesNotMatch(output, /von 9 Pruefungen gefahren/, "ohne Schluessel darf KEINE Pruefung als gefahren gemeldet werden");
});

test("check-outbound-drift.mjs: Positiv-Kontrolle gegen einen lokalen Stub-Server -> Exit 0, Umfangszeile, D7-Anker", async () => {
  const server = await startStubServer();
  try {
    const { port } = server.address();
    const stubBase = `http://127.0.0.1:${port}`;
    const { code, output } = await runCheckOutboundDrift({
      TELNYX_API_KEY: "stub-telnyx-key",
      TELNYX_API_BASE: stubBase,
      TELNYX_FQDN_CONNECTION_ID: FQDN_CONNECTION_ID,
      TELNYX_OUTBOUND_VOICE_PROFILE_ID: OVP_ID,
      ELEVENLABS_API_KEY: "stub-elevenlabs-key",
      ELEVENLABS_API_BASE: stubBase,
      ELEVENLABS_AGENT_ID: AGENT_ID,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: AGENT_PHONE_NUMBER_ID,
      PLATFORM_ANI_E164: PLATFORM_ANI,
      ALLOWED_COUNTRY_CODES: "+49",
    });
    assert.equal(code, 0, `der Lauf gegen den gesunden Stub muss durchlaufen, Output:\n${output}`);
    assert.match(output, /\d+ von 9 Pruefungen gefahren/, "die Umfangszeile (Betriebs-Positiv-Kontrolle) muss stehen");
    assert.match(output, /pruefung3 ownership=ok/, "der D7-Anker (Plan-Abnahmepunkt) muss im stdout stehen");
    assert.match(output, /OK -/, "ein gesunder Lauf muss die OK-Zeile drucken");
  } finally {
    await stopStubServer(server);
  }
});
