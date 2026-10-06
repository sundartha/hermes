import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig } from "../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const REQUIRED_OK = {
  ...CONFIG_REQUIRED_OK,
  paymentEnabled: true,
  stripeSecretKey: "x",
  stripeWebhookSecret: "x",
  platformAlertSmsTo: "+15005550006",
};

test("assertConfig: NaN NUMBER_SETUP_FEE_CENTS bei PAYMENT_ENABLED ist fail-closed (KORR1)", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: NaN }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: nicht-ganzzahliges NUMBER_SETUP_FEE_CENTS ist fail-closed", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 5.5 }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: gueltiges ganzzahliges NUMBER_SETUP_FEE_CENTS > 0 ist ok", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 100 }, () => {
    assert.equal(assertConfig(), true);
  });
});

test("assertConfig: PAYMENT_ENABLED ohne STRIPE_WEBHOOK_SECRET ist fail-closed (W4)", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 100, stripeWebhookSecret: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});
