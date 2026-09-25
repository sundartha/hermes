// KV2-6: HTTP-Test fuer GET /api/billing/kosten-deckung (Deckung je Traeger + der
// faelligkeits-unabhaengige Herzschlag). pglite (kein Spawn, kein echtes Netz) - Muster
// test/auth-p6-operator-routes.test.js (echte webAuthMw+adminMw-Kette ueber
// makePgTestStore); der Store-/Billing-Kollaborator selbst bleibt ein Double (Subjekt
// dieser Datei ist die Sicherung UND die Response-Form, nicht die Fachlogik - die
// rechnet test/kv2-6-deckung-herzschlag.test.js nach). Testname ohne Katalog-Praefix
// (Lehre catalog-id-prefix-misroutes-tests) - landet im Regressionslauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, adminOnly, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { PROVIDER, COST_TRUING_SOURCE } from "../src/store/defaults.js";

const SECRET = "kv2-6-route-web-secret-0123456789";
const ADMIN_EMAILS = ["admin@x"];
const ROUTE_PATH = "/api/billing/kosten-deckung";

const HEARTBEAT_FENSTER_H = 6;
const MIN_COVERAGE_PERCENT = 80;
const DELAY_MINUTES = 30;
const SWEEP_INTERVAL_MS = 3_600_000;
const ROUTE_CONFIG = withConfigNamespaces({
  kostenHeartbeatFensterH: HEARTBEAT_FENSTER_H,
  costTruingMinCoveragePercent: MIN_COVERAGE_PERCENT,
  costTruingDelayMinutes: DELAY_MINUTES,
  costTruingSweepIntervalMs: SWEEP_INTERVAL_MS,
});

// PII-Fixturen: markant, damit ein Leak in der Antwort nicht in generischen Zahlen
// untergeht.
const PII_TENANT_ID = "t_kv2_6_route_pii";
const PII_PHONE = "+4915155512399";
const TWO_HOURS_MS = 7_200_000;
const ONE_HOUR_MS = 3_600_000;
const STANDARD_ESTIMATE_CENTS = 30;

// EIN beendeter Anruf mit PII-tragenden Feldern - genug, um die Antwort inhaltlich zu
// fuellen (deckung/herzschlag nicht leer) und den PII-Scan aussagekraeftig zu machen.
function seedPiiCall(state) {
  const call = createCall(state, {
    direction: "outbound", from: PII_PHONE, to: PII_PHONE, tenantId: PII_TENANT_ID, provider: PROVIDER.TELNYX,
  });
  call.status = "completed";
  call.answeredAt = new Date(Date.now() - TWO_HOURS_MS).toISOString();
  call.endedAt = new Date(Date.now() - ONE_HOUR_MS).toISOString();
  call.estimatedCostCents = STANDARD_ESTIMATE_CENTS;
  call.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  call.costTruedAt = call.endedAt;
  return call;
}

const ONE_HOUR_S = 3600;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

async function setup() {
  const { runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  await accounts.upsertOnFirstLogin({ sub: "admin1", email: "admin@x" });
  await accounts.setStatus("t_admin1", "active");
  const adminSession = (await sessions.create({ sub: "admin1", tenantId: "t_admin1", ttlSeconds: ONE_HOUR_S })).id;

  await accounts.upsertOnFirstLogin({ sub: "cust1", email: "cust@x" });
  await accounts.setStatus("t_cust1", "active");
  const custSession = (await sessions.create({ sub: "cust1", tenantId: "t_cust1", ttlSeconds: ONE_HOUR_S })).id;

  const operatorAuth = {
    webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
    adminMw: adminOnly({ adminEmails: ADMIN_EMAILS }),
  };

  const state = makeDefaultState();
  seedPiiCall(state);
  const store = { load: () => state };

  const app = express();
  app.use(express.json());
  app.use(makeBillingRoutes({
    config: ROUTE_CONFIG, store, audit: () => {}, billing: {}, tenant: {}, costTruing: {}, operatorAuth,
  }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    adminSession,
    custSession,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function request(app, sessionId) {
  const headers = {};
  if (sessionId) headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}`;
  return fetch(`${app.base}${ROUTE_PATH}`, { headers });
}

test("GET /api/billing/kosten-deckung: ohne Sitzung -> kein 200 (401, webAuthGateMiddleware)", async () => {
  const app = await setup();
  try {
    const res = await request(app, null);
    assert.notEqual(res.status, HTTP_OK);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
  } finally {
    await app.close();
  }
});

test("GET /api/billing/kosten-deckung: aktive Nicht-Admin-Sitzung -> kein 200 (403, adminOnlyMiddleware)", async () => {
  const app = await setup();
  try {
    const res = await request(app, app.custSession);
    assert.notEqual(res.status, HTTP_OK);
    assert.equal(res.status, HTTP_FORBIDDEN);
  } finally {
    await app.close();
  }
});

test("GET /api/billing/kosten-deckung: Admin-Sitzung -> 200 mit den erwarteten Feldern", async () => {
  const app = await setup();
  try {
    const res = await request(app, app.adminSession);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.ok(Array.isArray(body.deckung));
    assert.ok(Array.isArray(body.herzschlag));
    assert.equal(typeof body.nieBeendet, "number");
    assert.equal(typeof body.profillos, "number");
    assert.equal(typeof body.zeile, "string");
    assert.ok(Array.isArray(body.befunde));
  } finally {
    await app.close();
  }
});

test("GET /api/billing/kosten-deckung: Antwort ist PII-frei (kein E.164, keine Tenant-Kennung)", async () => {
  const app = await setup();
  try {
    const raw = JSON.stringify(await (await request(app, app.adminSession)).json());
    assert.ok(!raw.includes(PII_PHONE), "keine Rufnummer in der Antwort");
    assert.ok(!raw.includes(PII_TENANT_ID), "keine Tenant-Kennung in der Antwort");
  } finally {
    await app.close();
  }
});
