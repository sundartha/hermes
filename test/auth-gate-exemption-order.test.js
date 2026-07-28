// P14 (Server-Slim) - Einfrier-Test fuer die extrahierte Basic-Auth-Gate-Kette
// (src/wiring/auth-gate.js). Reiner In-Process-Middleware-Test nach dem Muster
// test/outbound-gates-order.test.js (Order-Snapshot) + test/auth-mcp-bypass.test.js
// (fakeRes()/next-Flag): offline, kein Spawn, keine DB, kein Netz. Ruft
// makeAuthGate(deps) direkt auf (nicht die Server-Loop in server.js).
//
// Gates-P14: die frueher erste, flag-gegatete Exemption (altes Kunden-Portal
// public/tenant.html) ist mit dem Loeschen der Datei entfallen - Test (c) prueft jetzt
// ihre Abwesenheit statt ihres Flag-Gates.
//
// UNCONDITIONAL_EXEMPT_PATHS ist bewusst NICHT aus dem Modul reexportiert, sondern
// hier hartkodiert (wie EXPECTED_ORDER in outbound-gates-order.test.js): eine
// kuenftige Umsortierung/Auslassung der Exemption-Kette (INV-3) soll DIESEN Test
// bewusst brechen, statt trivial gruen zu bleiben (G31/G27).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAuthGate } from "../src/wiring/auth-gate.js";
import { safeEqual } from "../src/util.js";
import { BRAND_ASSETS_PREFIX } from "../src/mcp-server-info.js";

// Server-lokale Pfad-Konstanten (server.js L193/L204): hier als injizierte Werte
// hartkodiert, genau wie server.js sie an makeAuthGate hereinreicht (INV-1 bleibt
// die EINE Quelle in server.js selbst - dieser Test prueft nur die Gate-Logik, die
// die injizierten Werte entgegennimmt).
// LEGACY_PORTAL_PATH: der Altpfad des mit Gates-P14 geloeschten Kunden-Dashboards.
// KEINE Gate-Konstante mehr (die frueher erste, flag-gegatete Exemption ist entfallen) -
// hier nur noch als Gegenprobe-Pfad, s. Test (c).
const LEGACY_PORTAL_PATH = "/tenant.html";
const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";
const VOICE_PATH_PREFIX = "/voice";

// Minimal-Express-Double: status()/set() chainbar, send() erfassend (Muster
// auth-mcp-bypass.test.js fakeRes(), um send() statt json() erweitert).
function fakeRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.set = (name, value) => {
    res.headers[name] = value;
    return res;
  };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.send = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

const auditCalls = [];
function fakeAudit(action, req, details) {
  auditCalls.push({ action, path: req?.path, details });
}

function fakeReq(path, headers = {}) {
  return { path, headers, ip: "203.0.113.7" };
}

const DASHBOARD_PASSWORD = "s3cret-pw";

// PA-18: auth-gate.js liest config.auth.dashboardPassword + config.tenancy.<key>
// (beide namespaced) - der Fake baut die Namespace-Struktur hier direkt (hybrid mit
// tenancy), NICHT ueber withConfigNamespaces (das wuerde das literal-nested tenancy
// per Getter ueberschreiben und selfServiceEnabled auf undefined zurueckfallen lassen).
function makeGate(overrides = {}) {
  auditCalls.length = 0;
  return makeAuthGate({
    config: {
      auth: { dashboardPassword: DASHBOARD_PASSWORD },
      tenancy: { selfServiceEnabled: false, multiTenant: false },
      ...overrides.config,
    },
    audit: overrides.audit ?? fakeAudit,
    isTrustedLocalCaller: overrides.isTrustedLocalCaller ?? (() => false),
    safeEqual,
    BRAND_ASSETS_PREFIX,
    VOICE_PATH_PREFIX,
    paths: { STRIPE_WEBHOOK_PATH },
  });
}

// Ruft die Middleware auf und meldet zurueck, ob next() lief.
async function run(gate, req, res) {
  let nexted = false;
  await gate(req, res, () => {
    nexted = true;
  });
  return nexted;
}

// === (a) Unbedingte Exemptions: next(), kein 401 =================================

const UNCONDITIONAL_EXEMPT_PATHS = [
  "/voice",
  "/voice/incoming",
  "/mcp",
  "/mcp/x",
  "/.well-known/oauth-authorization-server",
  STRIPE_WEBHOOK_PATH,
  "/healthz",
  BRAND_ASSETS_PREFIX + "hermes-icon.png",
  "/favicon.ico",
];

test("auth-gate: unbedingte Exemptions passieren ohne Credentials", async () => {
  for (const path of UNCONDITIONAL_EXEMPT_PATHS) {
    const gate = makeGate();
    const res = fakeRes();
    const nexted = await run(gate, fakeReq(path), res);
    assert.equal(nexted, true, path);
    assert.equal(res.statusCode, null, path);
  }
});

// === (b) Gegenprobe: geschuetzte Pfade -> 401, kein next() =======================

const GUARDED_PATHS = ["/api/state", "/api/calls", "/", "/index.html"];

test("auth-gate: geschuetzte Pfade ohne Credentials -> 401, auth_failed geloggt", async () => {
  for (const path of GUARDED_PATHS) {
    const gate = makeGate();
    const res = fakeRes();
    const nexted = await run(gate, fakeReq(path), res);
    assert.equal(nexted, false, path);
    assert.equal(res.statusCode, 401, path);
    assert.equal(auditCalls.length, 1, path);
    assert.equal(auditCalls[0].action, "auth_failed", path);
  }
});

// === (c) Gates-P14: die flag-gegatete Portal-Exemption ist ERSATZLOS entfallen =====
// Frueher passierte /tenant.html das Gate, wenn SELF_SERVICE und MULTI_TENANT beide an
// waren. Die Datei public/tenant.html ist geloescht, die Ausnahme entfernt (Richtung
// fail-closed). Der Test prueft die Abwesenheit da, wo sie frueher griff: BEIDE Flags an.

test("auth-gate: /tenant.html ist auch mit beiden Flags NICHT mehr exempt (Gates-P14)", async () => {
  const beideFlagsAn = makeGate({ config: { tenancy: { selfServiceEnabled: true, multiTenant: true } } });
  const res = fakeRes();
  assert.equal(await run(beideFlagsAn, fakeReq(LEGACY_PORTAL_PATH), res), false);
  assert.equal(res.statusCode, 401);
});

// === (d) Gate deaktiviert (kein dashboardPassword): alles offen ==================

test("auth-gate: leeres dashboardPassword -> jeder Pfad passiert ungeprueft", async () => {
  const gate = makeGate({ config: { auth: { dashboardPassword: "" } } });
  for (const path of [...GUARDED_PATHS, ...UNCONDITIONAL_EXEMPT_PATHS]) {
    assert.equal(await run(gate, fakeReq(path), fakeRes()), true, path);
  }
});

// === (e) isTrustedLocalCaller-Bypass ==============================================

test("auth-gate: isTrustedLocalCaller=true oeffnet geschuetzten Pfad ohne Credentials", async () => {
  const gate = makeGate({ isTrustedLocalCaller: () => true });
  const nexted = await run(gate, fakeReq("/api/state"), fakeRes());
  assert.equal(nexted, true);
});

// === (f) Credential-Pfad + 401-Antwortform =========================================

test("auth-gate: korrekte Basic-Auth -> next(); falsche -> 401 mit korrektem Shape, kein Secret im Audit-Detail", async () => {
  const gate = makeGate();
  const validAuth = "Basic " + Buffer.from("admin:" + DASHBOARD_PASSWORD).toString("base64");

  const okRes = fakeRes();
  const okNexted = await run(gate, fakeReq("/api/state", { authorization: validAuth }), okRes);
  assert.equal(okNexted, true);
  assert.equal(okRes.statusCode, null);

  const badRes = fakeRes();
  const badNexted = await run(
    gate,
    fakeReq("/api/state", { authorization: "Basic bogus" }),
    badRes,
  );
  assert.equal(badNexted, false);
  assert.equal(badRes.statusCode, 401);
  assert.equal(badRes.body, "Auth required");
  assert.equal(badRes.headers["WWW-Authenticate"], 'Basic realm="Hermes"');
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "auth_failed");
  assert.equal(auditCalls[0].details, "path=/api/state");
  assert.ok(!auditCalls[0].details.includes(DASHBOARD_PASSWORD), "kein Secret im Audit-Detail");
});
