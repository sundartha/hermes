import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeBillingRoutes } from "../../src/routes/api-billing.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "../operator-route-app.js";

const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const ERLAUBT_PRO_MINUTE = 10;

async function mitApp(ablauf) {
  const billing = {
    createSetupCheckoutSession: () => Promise.resolve({ url: "https://stripe.test/c/1" }),
    getCheckoutSessionResult: () => Promise.resolve({ customerId: "cus_b" }),
  };
  const app = express();
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled: true, publicUrl: "https://agent.test" }),
      store: { tenantStripe: () => ({ customerId: "cus_b" }), setTenantStripe: () => {} },
      audit: () => {},
      billing,
      costTruing: {},
      operatorAuth: operatorAuthPassThrough(),
      tenant: { requireTenant: () => "t-b" },
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await ablauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function wiederholt(url, optionen, anzahl) {
  const antworten = [];
  for (let i = 0; i < anzahl; i += 1) antworten.push(await abrufMitFrist(url, optionen));
  return antworten;
}

async function pruefeGrenze(pfad, optionen) {
  await mitApp(async (base) => {
    const darunter = await wiederholt(`${base}${pfad}`, optionen, ERLAUBT_PRO_MINUTE);
    assert.deepEqual(darunter.map((a) => a.status), Array(ERLAUBT_PRO_MINUTE).fill(HTTP_OK));
    const darueber = await abrufMitFrist(`${base}${pfad}`, optionen);
    assert.equal(darueber.status, HTTP_TOO_MANY_REQUESTS);
    assert.ok(Number(darueber.headers.get("retry-after")) >= 1);
  });
}

test("h11 setup-checkout: ab der elften Anfrage in der Minute antwortet der Server 429 mit Retry-After, davor wie bisher", async () => {
  await pruefeGrenze("/api/billing/setup-checkout", { method: "POST" });
});

test("h11 checkout-return: ab der elften Anfrage in der Minute antwortet der Server 429 mit Retry-After, davor wie bisher", async () => {
  await pruefeGrenze("/api/billing/checkout-return?session_id=cs_b", {});
});

test("h11 Begrenzung: setup-checkout und checkout-return zaehlen getrennt", async () => {
  await mitApp(async (base) => {
    await wiederholt(`${base}/api/billing/setup-checkout`, { method: "POST" }, ERLAUBT_PRO_MINUTE + 1);
    const res = await abrufMitFrist(`${base}/api/billing/checkout-return?session_id=cs_b`);
    assert.notEqual(res.status, HTTP_TOO_MANY_REQUESTS);
  });
});
