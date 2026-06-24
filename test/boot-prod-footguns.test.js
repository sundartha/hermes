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

test("T-P0-1-AC1-05: Hosting + STORE_BACKEND=json -> Boot verweigert (exit 1), nennt STORE_BACKEND", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, STORE_BACKEND: "json" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /STORE_BACKEND/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});
