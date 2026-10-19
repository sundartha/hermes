import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { starteSelfServiceApp } from "../gemeinsam/self-service-app.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const SECRET = "u3-billing-web-secret-0123456789";
const SUB = "sub-u3";
const TENANT = "t_sub-u3";
const SUBSCRIPTION_ID = "sub_u3";
const PERIOD_END = 1893456000;
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
};

function billingOhneTermin() {
  return {
    createSubscription: async () => ({ subscriptionId: "sub_new", currentPeriodEnd: PERIOD_END }),
    scheduleCancellation: async (p) => ({ subscriptionId: p.subscriptionId, cancelAtPeriodEnd: true }),
    unscheduleCancellation: async (p) => ({ subscriptionId: p.subscriptionId, cancelAtPeriodEnd: false }),
  };
}

async function setup({ card = true, paymentEnabled = true, subscription, billing = billingOhneTermin(), breakMailPending = false } = {}) {
  const { store, runner } = await makePgTestStore();
  const auditRows = [];
  const auditStore = { record: async (eintrag) => void auditRows.push(eintrag) };
  store.load().tenants.push({
    id: TENANT,
    status: "active",
    firstName: "Kunde",
    ownerName: "Kunde U3",
    idpSubject: SUB,
  });
  if (card) store.setTenantStripe(TENANT, { customerId: "cus_u3", paymentMethodId: "pm_u3" });
  if (subscription) store.setTenantSubscription(TENANT, subscription);
  if (breakMailPending) {
    store.setCancellationMailPending = () => {
      throw new Error("pending-kaputt");
    };
  }
  const audits = [];
  const unscheduled = [];
  const beobachtet = {
    ...billing,
    unscheduleCancellation: async (p) => {
      unscheduled.push(p);
      return billing.unscheduleCancellation(p);
    },
  };
  const app = await starteSelfServiceApp({
    store,
    runner,
    secret: SECRET,
    sub: SUB,
    tenantId: TENANT,
    email: "u3@kunde.de",
    aktiv: true,
    audit: (action, req, detail) => audits.push({ action, detail }),
    config: withConfigNamespaces({ ...CONFIG, paymentEnabled }),
    billing: beobachtet,
    provision: async () => {},
    auditStore,
  });
  return { ...app, auditRows, audits, unscheduled };
}

async function post(s, path, body) {
  const headers = { Cookie: s.cookie };
  if (body) headers["Content-Type"] = "application/json";
  const res = await abrufMitFrist(`${s.base}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.text() };
}
const subscribe = (s, plan) => post(s, "/api/self-service/billing/subscribe", { plan });
const cancel = (s) => post(s, "/api/self-service/billing/cancel");
const resume = (s) => post(s, "/api/self-service/billing/resume");

async function auditDetails(s, action) {
  return s.auditRows.filter((r) => r.tenantId === TENANT && r.action === action).map((r) => r.detail);
}
const eintraege = (s, action) => s.audits.filter((a) => a.action === action).map((a) => a.detail);

test("subscribe ohne Karte -> Ablehnung wird mit Grund auditiert", async () => {
  const s = await setup({ card: false });
  try {
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 409);
    assert.deepEqual(eintraege(s, "self_service_subscribe_rejected"), [`tenant=${TENANT} reason=no_card`]);
    assert.deepEqual(eintraege(s, "self_service_subscribe"), []);
  } finally {
    await s.close();
  }
});

test("subscribe Erfolg -> Audit traegt Tenant, Plan, Profil- und Provisionierungsstatus", async () => {
  const s = await setup();
  try {
    const res = await subscribe(s, "starter");
    assert.equal(res.status, 200);
    const e = eintraege(s, "self_service_subscribe");
    assert.equal(e.length, 1);
    assert.match(e[0], new RegExp(`^tenant=${TENANT} plan=starter profile=\\S+ provision=\\S+$`));
    assert.deepEqual(eintraege(s, "self_service_subscribe_rejected"), []);
  } finally {
    await s.close();
  }
});

test("cancel ohne Abo -> 409 und Ablehnung mit Grund auditiert", async () => {
  const s = await setup();
  try {
    const res = await cancel(s);
    assert.equal(res.status, 409);
    assert.deepEqual(eintraege(s, "self_service_cancel_rejected"), [`tenant=${TENANT} reason=no_subscription`]);
    assert.deepEqual(eintraege(s, "self_service_cancel"), []);
  } finally {
    await s.close();
  }
});

test("cancel ohne bekannten Termin -> durabler Nachweis nennt unknown", async () => {
  const s = await setup({ subscription: { subscriptionId: SUBSCRIPTION_ID, planSlug: "starter" } });
  try {
    const res = await cancel(s);
    assert.equal(res.status, 200);
    assert.deepEqual(await auditDetails(s, "self_service_cancel_scheduled"), ["current_period_end=unknown"]);
  } finally {
    await s.close();
  }
});

test("cancel: Audit-Eintrag je Aufruf mit already_applied", async () => {
  const s = await setup({ subscription: { subscriptionId: SUBSCRIPTION_ID, planSlug: "starter", currentPeriodEnd: PERIOD_END } });
  try {
    await cancel(s);
    await cancel(s);
    assert.deepEqual(eintraege(s, "self_service_cancel"), [
      `tenant=${TENANT} already_applied=false`,
      `tenant=${TENANT} already_applied=true`,
    ]);
    assert.deepEqual(eintraege(s, "self_service_cancel_rejected"), []);
  } finally {
    await s.close();
  }
});

test("cancel: schlaegt das Vormerken der Bestaetigungsmail fehl, bleibt die Kuendigung 200 und der Fehler wird mit Tenant geloggt", async (t) => {
  const s = await setup({
    subscription: { subscriptionId: SUBSCRIPTION_ID, planSlug: "starter", currentPeriodEnd: PERIOD_END },
    breakMailPending: true,
  });
  const fehler = [];
  t.mock.method(console, "error", (...args) => fehler.push(args.join(" ")));
  try {
    const res = await cancel(s);
    assert.equal(res.status, 200);
    assert.deepEqual(fehler, [`[cancellation-mail] Ausloesen fehlgeschlagen tenant=${TENANT}: pending-kaputt`]);
  } finally {
    await s.close();
  }
});

test("resume ohne Abo -> 409 und Ablehnung mit Grund auditiert", async () => {
  const s = await setup();
  try {
    const res = await resume(s);
    assert.equal(res.status, 409);
    assert.deepEqual(eintraege(s, "self_service_resume_rejected"), [`tenant=${TENANT} reason=no_subscription`]);
    assert.deepEqual(eintraege(s, "self_service_resume"), []);
  } finally {
    await s.close();
  }
});

test("resume bei ausgeschalteter Zahlung -> 404, kein Stripe-Call, kein Audit", async () => {
  const s = await setup({
    paymentEnabled: false,
    subscription: { subscriptionId: SUBSCRIPTION_ID, planSlug: "starter", currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: true },
  });
  try {
    const res = await resume(s);
    assert.equal(res.status, 404);
    assert.equal(s.unscheduled.length, 0);
    assert.deepEqual(s.audits, []);
    assert.deepEqual(await auditDetails(s, "self_service_cancel_resumed"), []);
  } finally {
    await s.close();
  }
});

test("resume mit bekanntem Termin -> Nachweis nennt den Termin, Audit je Aufruf mit already_applied", async () => {
  const s = await setup({
    subscription: { subscriptionId: SUBSCRIPTION_ID, planSlug: "starter", currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: true },
  });
  try {
    await resume(s);
    await resume(s);
    assert.deepEqual(await auditDetails(s, "self_service_cancel_resumed"), [`current_period_end=${PERIOD_END}`]);
    assert.deepEqual(eintraege(s, "self_service_resume"), [
      `tenant=${TENANT} already_applied=false`,
      `tenant=${TENANT} already_applied=true`,
    ]);
  } finally {
    await s.close();
  }
});

test("resume ohne bekannten Termin -> Nachweis nennt unknown", async () => {
  const s = await setup({
    subscription: { subscriptionId: SUBSCRIPTION_ID, planSlug: "starter", cancelAtPeriodEnd: true },
  });
  try {
    const res = await resume(s);
    assert.equal(res.status, 200);
    assert.deepEqual(await auditDetails(s, "self_service_cancel_resumed"), ["current_period_end=unknown"]);
  } finally {
    await s.close();
  }
});
