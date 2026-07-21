// CFG-03 (PLAN-LAUNCH-TESTS.md, P2): PAYMENT_ENABLED=true + PROVISIONING_ENABLED=false ist
// aktuell NUR eine console.error-Warnung (kein Boot-Stop) - assertConfig() faltet sie NICHT
// in die Fatal-Menge. Dieser Test macht das Ist-Verhalten sichtbar (Grundlage fuer Owner-
// Sichtbarkeit): die Warn-Zeile MUSS zuverlaessig erscheinen, auch wenn der Boot weiterlaeuft.
// Modelliert auf config-prod-footguns.test.js (captureConsoleError-Helfer) und
// config-payment-guard.test.js (REQUIRED_OK-Fixture fuer den PAYMENT_ENABLED-Pfad). Reiner
// Unit-Test gegen den config-Singleton (kein Spawn, keine Env-Datei, kein Server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig } from "../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

// Alle Pflichtfelder erfuellt (Basis CONFIG_REQUIRED_OK + der PAYMENT_ENABLED-Pfad: Stripe-
// Secret/-Webhook/-Fee, sonst wuerde assertConfig() schon VOR der Warnung fatal ablehnen).
// PROVISIONING_ENABLED bewusst false -> NUR dieser eine Aspekt wird geprueft.
const REQUIRED_OK = {
  ...CONFIG_REQUIRED_OK,
  paymentEnabled: true,
  stripeSecretKey: "x",
  stripeWebhookSecret: "x",
  numberSetupFeeCents: 100,
  provisioningEnabled: false,
};

test("CFG-03: PAYMENT_ENABLED=true + PROVISIONING_ENABLED=false -> Warn-Zeile erscheint zuverlaessig", () => {
  withConfigOverrides(REQUIRED_OK, () => {
    const lines = captureConsoleError(() => {
      assertConfig();
    });
    const out = lines.join("\n");
    assert.match(
      out,
      /\[Konfiguration\] PAYMENT_ENABLED ohne PROVISIONING_ENABLED/,
      "die Warnung muss erscheinen, unabhaengig davon ob der Boot gestoppt wird",
    );
  });
});

test("CFG-03b: dieselbe Config bootet trotzdem weiter (Ist-Zustand: kein Boot-Stop, nur Warnung)", () => {
  withConfigOverrides(REQUIRED_OK, () => {
    captureConsoleError(() => {
      assert.equal(
        assertConfig(),
        true,
        "aktueller Ist-Zustand (PLAN-LAUNCH-TESTS.md CFG-03): PAYMENT_ENABLED ohne " +
          "PROVISIONING_ENABLED stoppt den Boot NICHT - nur console.error, keine Fatal-Menge",
      );
    });
  });
});

test("CFG-03c: PROVISIONING_ENABLED=true -> keine Warnung (Kontrastfall, beweist die Bedingung)", () => {
  withConfigOverrides({ ...REQUIRED_OK, provisioningEnabled: true }, () => {
    const lines = captureConsoleError(() => {
      assertConfig();
    });
    const out = lines.join("\n");
    assert.doesNotMatch(out, /PAYMENT_ENABLED ohne PROVISIONING_ENABLED/);
  });
});
