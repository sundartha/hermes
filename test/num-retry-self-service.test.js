// NUM-RETRY — POST /api/self-service/onboard/retry: der Ausweg aus numberStatus
// 'failed' fuer den zahlenden Kunden selbst. Kompositions-Integrationstest nach dem
// Muster 312k-p3-self-service-cancel.test.js (pglite, offline, F.I.R.S.T., kein
// Server-Spawn ausser dem lokalen express-Listener).
//
// Ausgangsfall (live, 2026-09-11): Abo gebucht und bezahlt, danach scheiterte der Hold
// der einmaligen Einrichtungsgebuehr (Stripe 402) -> Nummer 'failed'. Das Dashboard
// zeigte den Fehler und bot KEINEN Weg zurueck; der einzige Retry-Hebel hing hinter
// einer Admin-Sitzung. Diese Datei pinnt die Kanten der neuen Kunden-Route:
// Geld-Gate, Erfolg, Grund->Status-Abbildung und die Session-Grenze.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeNumberRetryRoute } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";


const SECRET = "num-retry-web-secret-0123456789";
const SUB = "sub-retry";
const TENANT = "t_sub-retry"; // upsertOnFirstLogin: tenantId = `t_${sub}`
const PERIOD_END = 1893456000;

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVICE_UNAVAILABLE = 503;
const SESSION_TTL_SECONDS = 3600;

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

// kycLevel/status bilden zusammen das Geld-Gate (tenantActiveSubscriber): ohne
// Karten-KYC bzw. ohne aktiven Status darf KEIN Nummernkauf ausgeloest werden.
async function setup({ status = "active", kycLevel = "card", provisionResult } = {}) {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const state = store.load();
  ops.registerTenant(state, TENANT, { firstName: "Kunde", lastName: "R" });
  const tenant = state.tenants.find((row) => row.id === TENANT);
  tenant.idpSubject = SUB;
  tenant.kycLevel = kycLevel;
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "retry@kunde.de" });
  await accounts.setStatus(TENANT, status);
  const { id: sessionId } = await sessions.create({
    sub: SUB,
    tenantId: TENANT,
    ttlSeconds: SESSION_TTL_SECONDS,
  });
  store.setTenantSubscription(TENANT, {
    subscriptionId: "sub_retry_1",
    planSlug: "starter",
    currentPeriodEnd: PERIOD_END,
  });

  // Spion statt echtem Provisioning: diese Datei prueft die ROUTE (Gate, Weiterreichung,
  // Status-Abbildung) - der Kauf-Pfad selbst ist in bk3-auto-provision/p2-onboard-retry
  // gepinnt und wird hier bewusst NICHT ein zweites Mal nachgebaut.
  const provisionCalls = [];
  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  // Der Retry-Router wird direkt montiert - genau so haengt er in der Produktion
  // (mountSelfServiceRoutes montiert ihn NEBEN makeSelfServiceRoutes, damit die grosse
  // Router-Fabrik unveraendert bleibt). Der Herkunfts-Guard darueber ist eigene
  // Praefix-Schicht und in sec-p3-* gepinnt, nicht Gegenstand dieser Datei.
  app.use(
    makeNumberRetryRoute({
      store,
      webAuthMw,
      audit: () => {},
      provision: async (tenantId) => {
        provisionCalls.push(tenantId);
        return provisionResult || { ok: true, reason: "queued", numberId: "num_1", jobId: "job_1" };
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    provisionCalls,
    cookie: cookieFor(sessionId),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function request(method, url, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers = cookie ? { Cookie: cookie } : {};
    const req = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname, method, headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const retry = (ctx, cookie = ctx.cookie) =>
  request("POST", `${ctx.base}/api/self-service/onboard/retry`, { cookie });

test("(a) aktiver Subscriber: Retry reicht GENAU den eigenen Tenant weiter -> 200 mit reason", async () => {
  const ctx = await setup();
  try {
    const res = await retry(ctx);
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(JSON.parse(res.body), { reason: "queued" });
    // Die Identitaet kommt ausschliesslich aus der Session - die Route nimmt gar keine
    // tenantId entgegen, es gibt also keinen faelschbaren Fremd-Tenant-Parameter (H3).
    assert.deepEqual(ctx.provisionCalls, [TENANT]);
  } finally {
    await ctx.close();
  }
});

test("(b) Geld-Gate: ohne Karten-KYC KEIN Nummernkauf -> 403 no_active_subscriber", async () => {
  const ctx = await setup({ kycLevel: "none" });
  try {
    const res = await retry(ctx);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal(JSON.parse(res.body).error, "no_active_subscriber");
    assert.deepEqual(ctx.provisionCalls, [], "kein Kauf-Trigger fuer einen Nicht-Zahler");
  } finally {
    await ctx.close();
  }
});

test("(c) suspendierter Tenant kommt gar nicht erst durch webAuthMw (active-only)", async () => {
  const ctx = await setup({ status: "suspended" });
  try {
    const res = await retry(ctx);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(ctx.provisionCalls, []);
  } finally {
    await ctx.close();
  }
});

test("(d) ohne Sitzung: 401, kein Kauf-Trigger", async () => {
  const ctx = await setup();
  try {
    const res = await request("POST", `${ctx.base}/api/self-service/onboard/retry`);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    assert.deepEqual(ctx.provisionCalls, []);
  } finally {
    await ctx.close();
  }
});

// Die Grund->Status-Abbildung entscheidet, ob das Dashboard "gleich nochmal" oder
// "ist schon unterwegs" sagt. Jeder Grund kommt als sprachneutraler Token zurueck -
// NIE der Runbook-Klartext der Operator-Route (der richtet sich an den Owner).
test("(e) already_provisioned -> 409 mit sprachneutralem Token", async () => {
  const ctx = await setup({ provisionResult: { ok: false, reason: "already_provisioned" } });
  try {
    const res = await retry(ctx);
    assert.equal(res.status, HTTP_CONFLICT);
    assert.deepEqual(JSON.parse(res.body), { error: "already_provisioned" });
  } finally {
    await ctx.close();
  }
});

test("(f) global_cap -> 429 (spaeter erneut), persist_error -> 503", async () => {
  const capped = await setup({ provisionResult: { ok: false, reason: "global_cap" } });
  try {
    assert.equal((await retry(capped)).status, HTTP_TOO_MANY_REQUESTS);
  } finally {
    await capped.close();
  }
  const broken = await setup({ provisionResult: { ok: false, reason: "persist_error" } });
  try {
    assert.equal((await retry(broken)).status, HTTP_SERVICE_UNAVAILABLE);
  } finally {
    await broken.close();
  }
});

test("(g) unbekannter/kuenftiger Grund faellt fail-closed auf 409 statt auf 200", async () => {
  const ctx = await setup({ provisionResult: { ok: false, reason: "etwas_neues" } });
  try {
    const res = await retry(ctx);
    assert.equal(res.status, HTTP_CONFLICT);
    assert.equal(JSON.parse(res.body).error, "etwas_neues");
  } finally {
    await ctx.close();
  }
});
