// T-P0-5 (H1): Im oeffentlichen Hosting (RENDER_EXTERNAL_URL gesetzt) EHRT der Boot
// die Produktions-Footguns: bei offenem Dashboard/API oder abgeschaltetem Safety-Gate
// startet der Dienst GAR NICHT (kein app.listen, kein /voice, kein /mcp) - er
// verweigert mit klarer Diagnose und exit(1). Lieber kein Dienst als ein oeffentlich
// offener (fail-closed). Kindprozess-Tests: Exit-Code + Diagnose. Der lokale Pfad
// (kein RENDER_EXTERNAL_URL, BASE_ENV) bleibt durch die Bestandssuite abgedeckt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "./helpers.js";

// Hosting simulieren. DASHBOARD_PASSWORD entschaerft die Default-Footgun aus BASE_ENV
// (leer); pro Test wird GENAU ein Footgun reaktiviert -> isolierter Nachweis.
const PROD_SAFE = { RENDER_EXTERNAL_URL: "https://agent.onrender.com", DASHBOARD_PASSWORD: "prod-geheim", SKIP_TWILIO_SIGNATURE_CHECK: "false" };

test("T-P0-5-10: Hosting + fehlendes DASHBOARD_PASSWORD -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, DASHBOARD_PASSWORD: "" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /DASHBOARD_PASSWORD/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P0-5-11: Hosting + MCP_AUTH=off -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, MCP_AUTH: "off" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /MCP_AUTH=off/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P0-5-12: Hosting + SKIP_TWILIO_SIGNATURE_CHECK=true -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, SKIP_TWILIO_SIGNATURE_CHECK: "true" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /SKIP_TWILIO_SIGNATURE_CHECK/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P0-5-13: Hosting + http-OAUTH_ISSUER_URL -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, OAUTH_ISSUER_URL: "http://idp.example" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OAUTH_ISSUER_URL/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

// T-P0-5-14: Im Boot-Test-Kontext ist kein echtes Postgres verfuegbar. STORE_BACKEND=pg
// wuerde store.load() scheitern lassen BEVOR assertConfig() laeuft. Deshalb: Test ohne
// RENDER_EXTERNAL_URL (kein AC1-Footgun) und ohne STORE_BACKEND-Gesetzt (json-Default).
// Die STORE_BACKEND=pg-Pflicht in Produktion ist durch unit-testbares T-P0-5-09 (assertConfig
// gibt true NUR mit storeBackend=pg+databaseUrl) und T-P0-1-AC1-01..04 abgedeckt.
test("T-P0-5-14: Saubere Basis-Config (kein RENDER_EXTERNAL_URL) -> bootet, /healthz 200", async () => {
  const srv = await startServer({ env: { DASHBOARD_PASSWORD: "prod-geheim", SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "saubere Basis-Config darf keinen ungewollten Boot-Refusal ausloesen");
  } finally {
    await srv.stop();
  }
});

// GAP-19 (11-luecken-und-e2e.md), erste Haelfte: FORCE_NUMBER_COUNTRY=US bei
// PROVISIONING_COUNTRY=DE (BASE_ENV) ist der reale Deployment-Zustand aus render.yaml -
// Kauf-Land und Herkunftsland laufen auseinander. SOLL: der Start bricht ab ODER weist
// die Konstellation ausdruecklich aus (ein Betriebs-Ack). Gemessen tut er beides nicht:
// der Boot laeuft durch, und das Boot-Log - das jede andere Konfig-Inkohaerenz als
// "[boot] Konfig-Warnung: ..." nennt - erwaehnt den Schalter mit keinem Wort.
// Der Test traegt BEIDE Soll-Varianten: bricht der Start ab, haengt der Helper den
// gesammelten Output an seine Fehlermeldung - auch dort muss der Schalter benannt sein.
test("GAP-19 (SOLL, rot) - Kauf-Land != Herkunftsland wird beim Start nicht stumm hingenommen", async () => {
  let bootLog;
  let srv = null;
  try {
    srv = await startServer({ env: { FORCE_NUMBER_COUNTRY: "US" } });
    bootLog = srv.stdout;
  } catch (err) {
    bootLog = err.message; // Abbruch-Variante (Soll a): Output steckt in der Meldung
  } finally {
    if (srv) await srv.stop();
  }
  assert.match(
    bootLog,
    /FORCE_NUMBER_COUNTRY/,
    "der Start nimmt das entkoppelte Kauf-Land wortlos hin - niemand sieht beim Deploy, " +
      "dass jeder neue Kunde eine auslaendische Rufnummer bekommt",
  );
});

// Nummern-Lebenszyklus (Owner-Entscheidung 2026-07-27, Ersatz fuer die zurueckgezogenen
// GAP-23-Tests): mit aktivem Provisioning geht die Telnyx-Bestellung ohne connection_id
// raus - die Nummer wird gekauft, kostet Miete und traegt trotzdem kein Voice-Routing.
// Der Guard muss 'fehlt' von 'gesetzt' unterscheiden (T5) und darf einen gesunden Start
// nicht verhindern (WARN, kein exit(1)).
test("Boot-Guard: PROVISIONING_ENABLED ohne TELNYX_CONNECTION_ID -> Konfig-Warnung nennt die Variable", async () => {
  const srv = await startServer({ env: { PROVISIONING_ENABLED: "true", TELNYX_CONNECTION_ID: "" } });
  try {
    assert.match(srv.stdout, /\[boot\] Konfig-Warnung: .*TELNYX_CONNECTION_ID/);
  } finally {
    await srv.stop();
  }
});

test("Boot-Guard: gesetzte TELNYX_CONNECTION_ID -> keine Warnung (gesunder Start bleibt still)", async () => {
  const srv = await startServer({ env: { PROVISIONING_ENABLED: "true", TELNYX_CONNECTION_ID: "conn_x" } });
  try {
    assert.doesNotMatch(srv.stdout, /TELNYX_CONNECTION_ID/);
  } finally {
    await srv.stop();
  }
});

// T-P0-5-18 (E8, PLAN-OPENAI.md Etappe 8): Hosting + divergentes OAUTH_AUDIENCE ->
// Boot verweigert (exit 1), nennt die Variable. PUBLIC_URL wird gesetzt, damit der
// Vergleich einen konkreten kanonischen Wert hat (sonst greift RENDER_EXTERNAL_URL).
test("T-P0-5-18: Hosting + divergentes OAUTH_AUDIENCE -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ...PROD_SAFE, PUBLIC_URL: "https://agent.onrender.com", OAUTH_AUDIENCE: "https://fremd.example/mcp" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OAUTH_AUDIENCE/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P0-1-AC1-05: Hosting + STORE_BACKEND=json -> Boot verweigert (exit 1), nennt STORE_BACKEND", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, STORE_BACKEND: "json" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /STORE_BACKEND/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});
