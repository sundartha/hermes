// P5 — Onboarding-Funnel: gefuehrte Aktivierung. Deckt den 403-Deadlock-Fix
// (webAuthAllowPending laesst suspended an die Aktivierungs-Routen) UND die volle
// 3-Effekt-Aktivierung (status=active + kyc=CARD + idempotentes Provisioning) ab.
// Kompositions-Integrationstest nach Muster w4/i9: reines pglite (offline, F.I.R.S.T.),
// KEIN Server-Spawn (Lehre p6a-Stall). Der PG-Account bleibt suspended (upsertOnFirstLogin-
// Default, KEIN accounts.setStatus(active)), damit der Deadlock real ist; der Store-Mirror
// traegt status=ACTIVE (registerTenant-Default) als P0-Voraussetzung fuer das W5-Gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import {
  webAuth,
  webAuthAllowPending,
  makeAccounts,
  makeSessions,
  signValue,
} from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";

const SECRET = "p5-onboarding-secret-0123456789";
const SUB = "sub-p5";
const TENANT = "t_sub-p5";
const PERIOD_END = 1893456000;
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
};

// Fake-Billing: nur die zwei Seams, die die Aktivierungs-Routen ziehen (createSubscription
// fuer subscribe, createSetupCheckoutSession fuer setup-checkout) - kein echter Stripe-Call.
function fakeBilling() {
  return {
    createSubscription: async () => ({ subscriptionId: "sub_new", currentPeriodEnd: PERIOD_END }),
    createSetupCheckoutSession: async () => ({ url: "https://stripe.test/checkout" }),
  };
}

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function setup({ card = true } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  // Store-Mirror: Tenant mit status=ACTIVE (registerTenant-Default) + optional Karte.
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "P5", idpSubject: SUB });
  if (card) ops.setTenantStripe(s, TENANT, { customerId: "cus_p5", paymentMethodId: "pm_p5" });

  // PG-Account: upsertOnFirstLogin legt den Tenant 'suspended' an. KEIN accounts.setStatus
  // (active) -> der frisch eingeloggte Tenant ist im Account-Layer suspended (Deadlock real).
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "p5@kunde.de" });
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const provisionSpy = [];
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: CONFIG,
      billing: fakeBilling(),
      accounts,
      provision: async (t) => provisionSpy.push(t),
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    provisionSpy,
    cookie: cookieFor(sessionId),
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
const subscribe = (s, plan) =>
  request("POST", `${s.base}/api/self-service/billing/subscribe`, { cookie: s.cookie, body: { plan } });

test("(1) suspended + Karte -> subscribe aktiviert voll: active + kyc=card + provision 1x", async () => {
  const s = await setup();
  try {
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 200);
    // PG-Status auf active gehoben (Deadlock geloest).
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "active", "PG-Account ueber accounts.setStatus aktiviert");
    // Mirror: KYC auf CARD -> Outbound-Gate offen.
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.kycLevel, "card", "KYC auf CARD gehoben");
    // Provisioning genau 1x mit dem eigenen Tenant.
    assert.deepEqual(s.provisionSpy, [TENANT], "Provisioning genau 1x");
    // Akzeptanz 2: das Outbound-Allowlist-Gate (W5) erkennt den aktiven Subscriber.
    assert.equal(
      ops.tenantActiveSubscriber(s.store.load(), TENANT, KYC_OUTBOUND_MIN),
      true,
      "aktiver, KYC-verifizierter Subscriber",
    );
  } finally {
    await s.close();
  }
});

test("(2) suspended -> GET /state 403 (kein Daten-Leak: kein calls/settings)", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/api/self-service/state`, { cookie: s.cookie });
    assert.equal(res.status, 403);
    const body = JSON.parse(res.body);
    assert.equal("calls" in body, false, "kein calls-Leak");
    assert.equal("settings" in body, false, "kein settings-Leak");
  } finally {
    await s.close();
  }
});

test("(3) suspended + KEINE Karte -> subscribe 409 no_card, keine Aktivierung", async () => {
  const s = await setup({ card: false });
  try {
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, "no_card");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "suspended", "kein Status-Flip ohne Karte");
    assert.deepEqual(s.provisionSpy, [], "kein Provisioning ohne Karte");
  } finally {
    await s.close();
  }
});

test("(4) suspended -> POST /billing/setup-checkout 200 {url} (nicht 403)", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/billing/setup-checkout`, {
      cookie: s.cookie,
    });
    assert.equal(res.status, 200);
    assert.equal(typeof JSON.parse(res.body).url, "string");
  } finally {
    await s.close();
  }
});

test("(5) suspended -> GET /billing/status 200 mit den Lifecycle-Flags (kein PII-Leak)", async () => {
  const s = await setup({ card: false });
  try {
    const res = await request("GET", `${s.base}/api/self-service/billing/status`, {
      cookie: s.cookie,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), {
      paymentEnabled: true,
      hasCard: false,
      planSlug: null,
      status: "suspended",
    });
  } finally {
    await s.close();
  }
});

test("(6) closed -> subscribe 403 (pending-mw Hard-Block, kein Reaktivieren)", async () => {
  const s = await setup();
  try {
    await s.accounts.setStatus(TENANT, "closed");
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 403);
    assert.deepEqual(s.provisionSpy, [], "geschlossener Tenant provisioniert nie");
  } finally {
    await s.close();
  }
});

test("(7) idempotent: zweiter subscribe -> 409 already_subscribed, provision bleibt bei 1", async () => {
  const s = await setup();
  try {
    assert.equal((await subscribe(s, "starter")).status, 200);
    const second = await subscribe(s, "business");
    assert.equal(second.status, 409);
    assert.equal(JSON.parse(second.body).error, "already_subscribed");
    assert.deepEqual(s.provisionSpy, [TENANT], "kein zweites Provisioning (Invariante 4)");
  } finally {
    await s.close();
  }
});
