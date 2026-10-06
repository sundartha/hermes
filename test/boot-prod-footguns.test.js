import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "./helpers.js";

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

test("T-P0-5-14: Saubere Basis-Config (kein RENDER_EXTERNAL_URL) -> bootet, /healthz 200", async () => {
  const srv = await startServer({ env: { DASHBOARD_PASSWORD: "prod-geheim", SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "saubere Basis-Config darf keinen ungewollten Boot-Refusal ausloesen");
  } finally {
    await srv.stop();
  }
});

test("GAP-19 (SOLL, rot) - Kauf-Land != Herkunftsland wird beim Start nicht stumm hingenommen", async () => {
  let bootLog;
  let srv = null;
  try {
    srv = await startServer({ env: { FORCE_NUMBER_COUNTRY: "US" } });
    bootLog = srv.stdout;
  } catch (err) {
    bootLog = err.message;
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

test("T-P0-5-18: Hosting + divergentes OAUTH_AUDIENCE -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ...PROD_SAFE, PUBLIC_URL: "https://agent.onrender.com", OAUTH_AUDIENCE: "https://fremd.example/mcp" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OAUTH_AUDIENCE/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T2-04-04: Hosting + fehlendes PUBLIC_URL -> Boot verweigert (exit 1), nennt Var + Sollform", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, PUBLIC_URL: "" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /PUBLIC_URL/);
  assert.match(output, /https:\/\/<host>/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T2-04-05: Hosting + gesetztes PUBLIC_URL -> der neue Footgun feuert NICHT (Spezifitaet)", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE } });
  assert.equal(code, 1, `erwartet exit 1 (Bestands-Footgun STORE_BACKEND), Output:\n${output}`);
  assert.doesNotMatch(output, /der angekuendigte Origin faellt sonst still/);
});

test("T-P0-1-AC1-05: Hosting + STORE_BACKEND=json -> Boot verweigert (exit 1), nennt STORE_BACKEND", async () => {
  const { code, output } = await startServerExpectExit({ env: { ...PROD_SAFE, STORE_BACKEND: "json" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /STORE_BACKEND/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});
