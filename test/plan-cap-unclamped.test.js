process.env.MAX_BUDGET_EUR = "5";
process.env.VOICE_TARIFF_DEFAULT_CENTS = "6";

import test, { before } from "node:test";
import assert from "node:assert/strict";

let PGlite, makePgStore, config, ops, subscribeMod, webhookMod, bootGuardMod;

before(async () => {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ config } = await import("../src/config.js"));
  ops = await import("../src/store/state-ops.js");
  subscribeMod = await import("../src/billing/subscribe.js");
  webhookMod = await import("../src/billing/webhook.js");
  bootGuardMod = await import("../src/boot-guard.js");
  config.billing.stripeStarterPriceId = "price_starter_test";
  config.billing.stripeBusinessPriceId = "price_business_test";
});

async function makeTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

async function captureWarn(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return lines;
}

test("(j2a) KS-P9: applyStripeWebhook ACTIVATE (business) laeuft durch, Decke bleibt 900 (KEINE Klemm-WARN)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_j2a";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "J2A" });
  store.setTenantStripe(tenantId, { customerId: "cus_j2a" });
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.CREATED,
    data: {
      object: {
        id: "sub_j2a",
        status: "active",
        current_period_end: 1893456000,
        current_period_start: 1890864000,
        customer: "cus_j2a",
        default_payment_method: "pm_j2a",
        metadata: { tenant_ref: tenantId, plan_slug: "business" },
      },
    },
  };
  const setStatusCalls = [];
  const provisionCalls = [];
  const warnLines = await captureWarn(() =>
    webhookMod.applyStripeWebhook(event, {
      store,
      accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async (t) => { provisionCalls.push(t); return { ok: true, reason: "queued" }; },
      billing: undefined,
    }),
  );
  assert.equal(store.tenantSubscription(tenantId).subscriptionId, "sub_j2a");
  assert.equal(store.tenantSubscription(tenantId).currentPeriodEnd, 1893456000);
  assert.equal(store.tenantStripe(tenantId).customerId, "cus_j2a", "Karte via Fake gebunden");
  assert.deepEqual(setStatusCalls, [[tenantId, "active"]]);
  assert.deepEqual(provisionCalls, [tenantId], "Provisioning ausgeloest");
  assert.equal(
    store.tenantBudgetSnapshot(tenantId, config.billing).capCents,
    900,
    "verkaufte Business-Decke ungekuerzt (KS-P9: keine Klemme auf die Plattform-Zahl)",
  );
  const clampLines = warnLines.filter((l) => l.includes("grund=clamp"));
  assert.deepEqual(clampLines, [], `keine Klemm-WARN mehr erwartet, war:\n${warnLines.join("\n")}`);
});

test("(j2b) KS-P9: Checkout-Return-Pfad (business) laeuft durch, Decke bleibt 900 (KEINE Klemm-WARN)", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_j2b";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "J2B" });
  store.setTenantStripe(tenantId, { customerId: "cus_j2b" });
  const outcome = {
    customerId: "cus_j2b",
    paymentMethodId: "pm_j2b",
    subscriptionId: "sub_j2b",
    currentPeriodStart: 1890864000,
    currentPeriodEnd: 1893456000,
    planSlug: "business",
  };
  const provisionCalls = [];
  let result;
  const warnLines = await captureWarn(async () => {
    result = await subscribeMod.activateSubscriptionFromCheckoutSession({
      store,
      billing: { getSubscriptionCheckoutResult: async () => outcome },
      accounts: { setStatus: async () => {} },
      provision: async (t) => { provisionCalls.push(t); return { ok: true, reason: "queued" }; },
      tenant: tenantId,
      sessionId: "cs_j2b",
      expectedPlanSlug: "business",
    });
  });
  assert.equal(result.ok, true, "Checkout-Return-Pfad laeuft vollstaendig durch (kein Wurf)");
  assert.equal(store.tenantStripe(tenantId).paymentMethodId, "pm_j2b", "Karte via Fake gebunden");
  assert.deepEqual(provisionCalls, [tenantId], "Provisioning ausgeloest");
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 900, "Decke ungekuerzt");
  const clampLines = warnLines.filter((l) => l.includes("grund=clamp"));
  assert.deepEqual(clampLines, [], `keine Klemm-WARN mehr erwartet, war:\n${warnLines.join("\n")}`);
});

test("(j4) planCapUnderivableFindings: werfender capForSlug -> fatal:true PLAN_CAP_UNDERIVABLE (kein Wurf)", () => {
  let findings;
  assert.doesNotThrow(() => {
    findings = bootGuardMod.planCapUnderivableFindings({
      slugs: ["starter", "enterprise"],
      capForSlug: (slug) => planCapThatThrows(slug),
    });
  });
  assert.equal(findings.length, 1, `genau EIN Finding erwartet, war: ${JSON.stringify(findings)}`);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, bootGuardMod.PLAN_CAP_FINDING.PLAN_CAP_UNDERIVABLE);
  assert.match(findings[0].message, /enterprise/);
});

function planCapThatThrows(slug) {
  if (slug === "starter") return 300;
  throw new Error(`planCapCents: unbekannter Plan-Slug '${slug}'`);
}
