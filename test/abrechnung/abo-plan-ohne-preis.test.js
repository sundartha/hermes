import { test } from "node:test";
import assert from "node:assert/strict";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { starteSelfServiceApp } from "../gemeinsam/self-service-app.js";

const SECRET = "sec-ohne-preis";
const SUB = "sub-ohne-preis";
const TENANT = "t_sub-ohne-preis";
const HTTP_SERVER_ERROR = 500;
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "",
  stripeBusinessPriceId: "price_business",
};

test("Abo mit Tarif ohne hinterlegten Stripe-Preis -> 500 plan_unconfigured, kein Abo", async () => {
  const { store, runner } = await makePgTestStore();
  store.load().tenants.push({
    id: TENANT,
    status: "active",
    firstName: "Kunde",
    ownerName: "Kunde Ohne",
    idpSubject: SUB,
  });
  store.setTenantStripe(TENANT, { customerId: "cus_x", paymentMethodId: "pm_x" });
  const app = await starteSelfServiceApp({
    store,
    runner,
    secret: SECRET,
    sub: SUB,
    tenantId: TENANT,
    email: "ohne@kunde.de",
    aktiv: true,
    audit: () => {},
    config: withConfigNamespaces(CONFIG),
    billing: {
      createSubscription: async () => assert.fail("Stripe darf ohne Preis nicht aufgerufen werden"),
    },
    provision: async () => {},
  });
  try {
    const res = await request("POST", `${app.base}/api/self-service/billing/subscribe`, {
      cookie: app.cookie,
      body: { plan: "starter" },
    });
    assert.equal(res.status, HTTP_SERVER_ERROR);
    assert.deepEqual(JSON.parse(res.body), { error: "plan_unconfigured" });
    const t = store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeSubscriptionId ?? null, null);
  } finally {
    await app.close();
  }
});
