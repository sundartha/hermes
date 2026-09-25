// GP-P5, Teil 3: GET /api/self-service/state nennt den GRUND eines gescheiterten
// Nummern-Setups (agent.numberStatusReason). Vorher zeigte das Dashboard nur
// "Einrichtung der Nummer fehlgeschlagen" - der Server kannte die Lage seit GP-P2/P3,
// sagte sie aber niemandem. Fuer den Vorfall vom 11.09.2026 war genau das entscheidend:
// die Zahlungsmethode (Typ 'link') kann strukturell keinen Hold tragen, es half also
// weder Warten noch erneutes Klicken, sondern ausschliesslich eine Karte.
//
// Kompositions-Integrationstest nach dem Muster f2-self-service-state-private-number.js:
// reines pglite (offline, F.I.R.S.T.), KEIN Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "gp-p5-web-secret-0123456789";
const SUB = "sub-p5";
const TENANT = "t_sub-p5";
const WALLET_TYPE = "link";
const HIGH_CAP = 999;
const SESSION_TTL_SECONDS = 3600;
const HTTP_OK = 200;
const DEFAULT_MAX_ATTEMPTS = 3;

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

async function setup({ paymentMethodType, anzahlFailed, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) =>
      fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const state = store.load();
  ops.registerTenant(state, TENANT, { firstName: "Kunde", lastName: "P5" });
  const tenant = state.tenants.find((row) => row.id === TENANT);
  tenant.status = "active";
  tenant.idpSubject = SUB;
  ops.setKycLevel(state, TENANT, KYC_OUTBOUND_MIN);
  if (paymentMethodType !== undefined)
    ops.setTenantStripe(state, TENANT, {
      customerId: "cus_p5",
      paymentMethodId: "pm_p5",
      paymentMethodType,
    });
  ops.setTenantSubscription(state, TENANT, { subscriptionId: "sub_p5", planSlug: "starter" });
  for (let lauf = 0; lauf < (anzahlFailed || 0); lauf += 1) {
    const { number } = ops.requestNumber(state, {
      tenantId: TENANT,
      maxNumbers: HIGH_CAP,
      maxNumbersPerTenant: HIGH_CAP,
    });
    ops.failNumber(state, number.id);
  }
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p5@kunde.de" });
  await accounts.setStatus(TENANT, "active");
  const { id: sessionId } = await sessions.create({
    sub: SUB,
    tenantId: TENANT,
    ttlSeconds: SESSION_TTL_SECONDS,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces({
        paymentEnabled: false,
        provisioningRetryMaxAttempts: maxAttempts,
      }),
      billing: {},
      accounts,
      provision: async () => {},
    }),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: cookieFor(sessionId),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function leseState(ctx) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${ctx.base}/api/self-service/state`);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "GET",
        headers: { Cookie: ctx.cookie },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body || "{}") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Der Fall aus dem Vorfall: Wallet-Typ, der keinen Hold traegt. Nur hier darf das
// Dashboard dem Kunden eine Handlung anbieten - sie ist die einzige, die wirkt.
test("Wallet-Zahlungsmethode -> payment_method_unsuitable", async () => {
  const ctx = await setup({ paymentMethodType: WALLET_TYPE, anzahlFailed: 1 });
  try {
    const { status, body } = await leseState(ctx);
    assert.equal(status, HTTP_OK);
    assert.equal(body.agent.numberStatus, "failed");
    assert.equal(body.agent.numberStatusReason, "payment_method_unsuitable");
  } finally {
    await ctx.close();
  }
});

// Bestands-Mandant vor GP-P2: Typ null. Er ist aus demselben Grund ausgeschlossen -
// das Dashboard muss ihm dieselbe Handlung anbieten, sonst bleibt er ohne Ausweg.
test("fehlender Typ (Bestand vor GP-P2) -> ebenfalls payment_method_unsuitable", async () => {
  const ctx = await setup({ paymentMethodType: null, anzahlFailed: 1 });
  try {
    const { body } = await leseState(ctx);
    assert.equal(body.agent.numberStatusReason, "payment_method_unsuitable");
  } finally {
    await ctx.close();
  }
});

// Hold-faehige Karte, Versuche frei: der Wiederanlauf greift von selbst - hier waere
// ein Handlungsaufruf ein Fehlalarm.
test("hold-faehige Karte mit freien Versuchen -> retry_pending", async () => {
  const ctx = await setup({ paymentMethodType: PAYMENT_METHOD_TYPE_CARD, anzahlFailed: 1 });
  try {
    const { body } = await leseState(ctx);
    assert.equal(body.agent.numberStatusReason, "retry_pending");
  } finally {
    await ctx.close();
  }
});

// Deckel erreicht: ein Kartenwechsel stoesst nichts mehr an (resolveAutoProvisionRetry
// prueft den Deckel NACH der Eignung). Ein Handlungsaufruf waere hier eine leere Zusage.
test("erschoepfte Versuche -> manual_review", async () => {
  const ctx = await setup({
    paymentMethodType: PAYMENT_METHOD_TYPE_CARD,
    anzahlFailed: DEFAULT_MAX_ATTEMPTS,
  });
  try {
    const { body } = await leseState(ctx);
    assert.equal(body.agent.numberStatusReason, "manual_review");
  } finally {
    await ctx.close();
  }
});

// Der Not-Aus (maxAttempts=0) wird im Kern VOR dem Zustands-Gate beantwortet. Ohne die
// eigene 'failed'-Vorpruefung in numberSetupReason truege JEDER Mandant einen Grund -
// auch der mit laufender Nummer.
test("ohne gescheiterte Nummer bleibt der Grund leer - auch bei abgeschaltetem Wiederanlauf", async () => {
  for (const maxAttempts of [DEFAULT_MAX_ATTEMPTS, 0]) {
    const ctx = await setup({ paymentMethodType: PAYMENT_METHOD_TYPE_CARD, maxAttempts });
    try {
      const { body } = await leseState(ctx);
      assert.notEqual(body.agent.numberStatus, "failed");
      assert.equal(body.agent.numberStatusReason, "");
    } finally {
      await ctx.close();
    }
  }
});
