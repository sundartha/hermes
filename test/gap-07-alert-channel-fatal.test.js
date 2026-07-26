// GAP-07 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-07").
// Eine Fruehwarnung ohne Empfaenger ist keine Sicherung: bei PAYMENT_ENABLED=true UND
// PLATFORM_SPEND_WARN_PERCENT>0 UND leerem PLATFORM_ALERT_SMS_TO darf der Boot NICHT
// durchlaufen. Umgesetzt in P6: alertChannelFindings liefert fuer genau diese Konjunktion
// einen fatal:true-Befund, den assertConfig() in seine Fatal-Menge faltet. Rein, offline
// (Muster test/config-payment-guard.test.js: assertConfig() direkt am config-Singleton).
//
// A3: die Testnamen tragen KEINE Katalog-ID mehr - die Faelle sind seit P6 gruener
// Regressionsschutz und gehoeren damit in `npm test`, nicht in `test:gates`.
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
  numberSetupFeeCents: 100,
};

// Faengt console.error waehrend fn ab (Muster test/boot-guard.test.js captureErrAsync):
// restauriert IMMER, auch bei Wurf.
function captureErr(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}

test("PAYMENT_ENABLED + PLATFORM_SPEND_WARN_PERCENT>0 + leerer PLATFORM_ALERT_SMS_TO verweigert den Boot", () => {
  withConfigOverrides({ ...REQUIRED_OK, platformSpendWarnPercent: 80, platformAlertSmsTo: "" }, () => {
    let ok;
    captureErr(() => {
      ok = assertConfig();
    });
    assert.equal(
      ok,
      false,
      "eine Fruehwarnung ohne Empfaenger ist keine Sicherung - der Boot bricht FATAL ab",
    );
  });
});

test("Warnschwelle 0 (Warnung bewusst aus) + leerer Kanal bootet weiter", () => {
  withConfigOverrides({ ...REQUIRED_OK, platformSpendWarnPercent: 0, platformAlertSmsTo: "" }, () => {
    assert.equal(assertConfig(), true, "ohne scharfe Warnung fehlt kein Empfaenger");
  });
});

test("ohne aktive Buchung (PAYMENT_ENABLED=false) bleibt der leere Kanal eine blosse WARN", () => {
  withConfigOverrides(
    { ...CONFIG_REQUIRED_OK, paymentEnabled: false, platformSpendWarnPercent: 80, platformAlertSmsTo: "" },
    () => {
      assert.equal(assertConfig(), true, "ohne Buchung ist der Dienst blind, nicht unsicher");
    },
  );
});

test("besetzter Kanal + Buchung + Warnschwelle 80 bootet", () => {
  withConfigOverrides(
    { ...REQUIRED_OK, platformSpendWarnPercent: 80, platformAlertSmsTo: "+15005550006" },
    () => {
      assert.equal(assertConfig(), true);
    },
  );
});

test("die Abbruchmeldung nennt PLATFORM_ALERT_SMS_TO und die Abhilfe", () => {
  withConfigOverrides({ ...REQUIRED_OK, platformSpendWarnPercent: 80, platformAlertSmsTo: "" }, () => {
    const logs = captureErr(() => assertConfig());
    assert.match(logs, /PLATFORM_ALERT_SMS_TO/, "der Operator muss die Stellschraube erfahren");
    assert.match(logs, /PLATFORM_SPEND_WARN_PERCENT=0/, "die Abhilfe steht in der Meldung");
  });
});
