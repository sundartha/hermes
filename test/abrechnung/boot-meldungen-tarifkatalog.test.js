import { test } from "node:test";
import assert from "node:assert/strict";

import { startServerExpectExit } from "../helpers.js";

test("Boot ohne Stripe-Price-Id nennt PLAN_CATALOG und keinen veralteten Dateipfad", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      PAYMENT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_test_x",
      STRIPE_API_BASE: "http://127.0.0.1:9",
      NUMBER_SETUP_FEE_CENTS: "500",
      STRIPE_STARTER_PRICE_ID: "price_a",
      STRIPE_BUSINESS_PRICE_ID: "",
    },
  });
  assert.equal(code, 1, output);
  assert.match(output, /Slug aus PLAN_CATALOG eine STRIPE_<TARIF>_PRICE_ID/);
  assert.doesNotMatch(output, /src\/plans\.js/);
});
