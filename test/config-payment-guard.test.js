// Regression fuer KORR1 (P6b1-Review): die "NUMBER_SETUP_FEE_CENTS muss > 0"-
// Geldsicherung in assertConfig darf von einem nicht-numerischen Wert (NaN aus
// parseInt) NICHT still umgangen werden (NaN <= 0 ist false). assertConfig liest
// den config-Singleton -> wir setzen die Pflichtfelder, variieren NUR den Fee-Wert
// und stellen den Ausgangszustand wieder her (Test-Isolation, kein Spawn/keine Env).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig } from "../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

// Alle anderen Pflichtfelder erfuellt -> NUR der Fee-Wert entscheidet ueber das Urteil.
// Basis CONFIG_REQUIRED_OK (helpers.js) + PAYMENT_ENABLED-Pfad-spezifische Felder.
const REQUIRED_OK = {
  ...CONFIG_REQUIRED_OK,
  paymentEnabled: true,
  stripeSecretKey: "x",
  stripeWebhookSecret: "x", // W4: Boot-Pflicht bei PAYMENT_ENABLED (sonst Webhook unverifizierbar)
  // GAP-07: besetzter Kanal, damit NUR der Fee-Wert entscheidet. Ohne diese Zeile
  // haengt das Urteil zusaetzlich am Code-Default PLATFORM_SPEND_WARN_PERCENT=80, der
  // bei PAYMENT_ENABLED einen leeren PLATFORM_ALERT_SMS_TO fatal macht.
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
  // Ohne Webhook-Secret ist der Stripe-Webhook fail-closed unverifizierbar (kein
  // Abo-Lifecycle) -> Boot-Refusal, exakt wie STRIPE_SECRET_KEY.
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 100, stripeWebhookSecret: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});
