// W4 — Abo-Buchung ueber den Self-Service-Pfad (web-session-only). Kompositions-
// Integrationstest nach Muster i9-self-service.test.js: reines pglite (offline,
// F.I.R.S.T.), KEIN Server-Spawn (Lehre p6a-Stall). Prueft: eingeloggt+Karte ->
// subscribe -> Abo-Felder persistiert + accounts.setStatus(active) -> webAuthMw laesst
// danach durch; ohne Karte -> 409; bereits abonniert -> 409; PAYMENT_ENABLED aus -> 404.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";

const SECRET = "subscribe-web-secret-0123456789";
const SUB_B = "sub-b";
const TENANT_B = "t_sub-b";
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
};

function fakeBilling(spy = {}) {
  return {
    createSubscription: async (params) => {
      spy.params = params;
      return { subscriptionId: "sub_new", currentPeriodEnd: 1893456000 };
    },
  };
}

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function setup({ card = true, paymentEnabled = true } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  // Tenant B im Mirror + DB anlegen, vorerst suspended (Subscribe soll aktivieren).
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Kunde", lastName: "B" });
  const t = s.tenants.find((x) => x.id === TENANT_B);
  t.idpSubject = SUB_B;
  if (card) {
    ops.setTenantStripe(s, TENANT_B, { customerId: "cus_b", paymentMethodId: "pm_b" });
  }
  await accounts.upsertOnFirstLogin({ sub: SUB_B, email: "b@kunde.de" });
  await accounts.setStatus(TENANT_B, "active"); // Session-Auth braucht active fuer den Durchlass
  // (Hinweis: webAuthMw prueft DB-status; wir testen den Abo-Effekt auf den Mirror + DB-Setter.)
  const { id: sessionId } = await sessions.create({ sub: SUB_B, tenantId: TENANT_B, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const billingSpy = {};
  const app = express();
  app.use(express.json());
  const cfg = { ...CONFIG, paymentEnabled };
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      audit: () => {},
      config: cfg,
      billing: fakeBilling(billingSpy),
      accounts,
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    billingSpy,
    cookieB: cookieFor(sessionId),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const subscribe = (s, plan, cookie = s.cookieB) =>
  request("POST", `${s.base}/api/self-service/billing/subscribe`, { cookie, body: { plan } });
const getState = (s, cookie = s.cookieB) =>
  request("GET", `${s.base}/api/self-service/state`, { cookie });

test("(a) Happy: subscribe mit Karte -> Abo persistiert + Tenant aktiv (accounts.setStatus)", async () => {
  const s = await setup();
  try {
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.plan, "starter");
    assert.equal(body.currentPeriodEnd, 1893456000);
    // Abo-Felder im Mirror.
    const t = s.store.load().tenants.find((x) => x.id === TENANT_B);
    assert.equal(t.stripeSubscriptionId, "sub_new");
    assert.equal(t.stripePlanSlug, "starter");
    // Status-Flip ueber den pg-Status-Seam (webAuthMw-Quelle).
    const acct = await s.accounts.resolve(SUB_B);
    assert.equal(acct.status, "active", "Tenant ueber accounts.setStatus aktiviert");
    // Stripe-Call mit dem richtigen Price.
    assert.equal(s.billingSpy.params.priceId, "price_starter");
  } finally {
    await s.close();
  }
});

test("(b) state zeigt das Abo (planSlug/currentPeriodEnd), KEIN subscriptionId-Leak", async () => {
  const s = await setup();
  try {
    await subscribe(s, "business");
    const st = JSON.parse((await getState(s)).body);
    assert.equal(st.subscription.planSlug, "business");
    assert.equal(st.subscription.currentPeriodEnd, 1893456000);
    assert.equal("subscriptionId" in st.subscription, false, "sub_-Referenz nicht in der UI-View");
  } finally {
    await s.close();
  }
});

test("(c) ohne Karte -> 409 no_card, kein Abo, kein Status-Flip", async () => {
  const s = await setup({ card: false });
  try {
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, "no_card");
    const t = s.store.load().tenants.find((x) => x.id === TENANT_B);
    assert.equal(t.stripeSubscriptionId ?? null, null, "kein Abo ohne Karte");
  } finally {
    await s.close();
  }
});

test("(d) bereits abonniert -> 409 already_subscribed (Doppelabbuchungs-Schutz)", async () => {
  const s = await setup();
  try {
    assert.equal((await subscribe(s, "starter")).status, 200);
    const second = await subscribe(s, "business");
    assert.equal(second.status, 409);
    assert.equal(JSON.parse(second.body).error, "already_subscribed");
  } finally {
    await s.close();
  }
});

test("(e) unbekannter Plan -> 400 unknown_plan", async () => {
  const s = await setup();
  try {
    const res = await subscribe(s, "gold");
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, "unknown_plan");
  } finally {
    await s.close();
  }
});

test("(f) PAYMENT_ENABLED aus -> 404 (byte-identisch), kein subscription im state", async () => {
  const s = await setup({ paymentEnabled: false });
  try {
    assert.equal((await subscribe(s, "starter")).status, 404);
    const st = JSON.parse((await getState(s)).body);
    assert.equal("subscription" in st, false, "kein Abo-Feld bei Flag aus");
    assert.equal("hasCard" in st, false, "kein hasCard bei Flag aus");
  } finally {
    await s.close();
  }
});

test("(g) ohne Session-Cookie -> 401, kein Abo", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/billing/subscribe`, {
      body: { plan: "starter" },
    });
    assert.equal(res.status, 401);
  } finally {
    await s.close();
  }
});
