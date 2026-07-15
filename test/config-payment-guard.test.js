// Regression fuer KORR1 (P6b1-Review): die "NUMBER_SETUP_FEE_CENTS muss > 0"-
// Geldsicherung in assertConfig darf von einem nicht-numerischen Wert (NaN aus
// parseInt) NICHT still umgangen werden (NaN <= 0 ist false). assertConfig liest
// den config-Singleton -> wir setzen die Pflichtfelder, variieren NUR den Fee-Wert
// und stellen den Ausgangszustand wieder her (Test-Isolation, kein Spawn/keine Env).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig } from "../src/config.js";

function withConfig(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = config[k];
  Object.assign(config, overrides);
  try {
    return fn();
  } finally {
    Object.assign(config, saved);
  }
}

// Alle anderen Pflichtfelder erfuellt -> NUR der Fee-Wert entscheidet ueber das Urteil.
const REQUIRED_OK = {
  anthropicApiKey: "x",
  twilioSid: "x",
  twilioToken: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: true,
  stripeSecretKey: "x",
  stripeWebhookSecret: "x", // W4: Boot-Pflicht bei PAYMENT_ENABLED (sonst Webhook unverifizierbar)
};

test("assertConfig: NaN NUMBER_SETUP_FEE_CENTS bei PAYMENT_ENABLED ist fail-closed (KORR1)", () => {
  withConfig({ ...REQUIRED_OK, numberSetupFeeCents: NaN }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: nicht-ganzzahliges NUMBER_SETUP_FEE_CENTS ist fail-closed", () => {
  withConfig({ ...REQUIRED_OK, numberSetupFeeCents: 5.5 }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: gueltiges ganzzahliges NUMBER_SETUP_FEE_CENTS > 0 ist ok", () => {
  withConfig({ ...REQUIRED_OK, numberSetupFeeCents: 100 }, () => {
    assert.equal(assertConfig(), true);
  });
});

test("assertConfig: PAYMENT_ENABLED ohne STRIPE_WEBHOOK_SECRET ist fail-closed (W4)", () => {
  // Ohne Webhook-Secret ist der Stripe-Webhook fail-closed unverifizierbar (kein
  // Abo-Lifecycle) -> Boot-Refusal, exakt wie STRIPE_SECRET_KEY.
  withConfig({ ...REQUIRED_OK, numberSetupFeeCents: 100, stripeWebhookSecret: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});
