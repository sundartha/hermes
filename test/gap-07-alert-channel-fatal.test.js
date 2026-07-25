// GAP-07 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-07").
// Eine Fruehwarnung ohne Empfaenger ist keine Sicherung: bei PAYMENT_ENABLED=true UND
// PLATFORM_SPEND_WARN_PERCENT>0 UND leerem PLATFORM_ALERT_SMS_TO (exakt der Deployment-
// Zustand, tasks/i18n-tests/13-live-env-befund.md Abschnitt 3+GAP-33-Bericht Abschnitt 3
// B3) darf der Boot NICHT durchlaufen - heute ist alertChannelFindings() bewusst NUR
// eine WARN (src/boot-guard.js:317-324, fatal:false), assertConfig() prueft
// platformAlertSmsTo/platformSpendWarnPercent an keiner Stelle. Rein, offline
// (Muster test/config-payment-guard.test.js: assertConfig() direkt am config-Singleton).
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

test("GAP-07 SOLL: PAYMENT_ENABLED + PLATFORM_SPEND_WARN_PERCENT>0 + leerer PLATFORM_ALERT_SMS_TO muss den Boot verweigern (heute nur WARN)", () => {
  withConfigOverrides(
    { ...REQUIRED_OK, platformSpendWarnPercent: 80, platformAlertSmsTo: "" },
    () => {
      assert.equal(
        assertConfig(),
        false,
        "SOLL: eine Fruehwarnung ohne Empfaenger ist keine Sicherung - der Boot muss FATAL " +
          "abbrechen; heute liefert assertConfig() true, weil platformAlertSmsTo/" +
          "platformSpendWarnPercent an keiner Stelle in assertConfig() geprueft werden " +
          "(alertChannelFindings ist NUR eine boot.js-WARN, src/boot-guard.js:317-324 " +
          "fatal:false, src/boot.js:161-165)",
      );
    },
  );
});
