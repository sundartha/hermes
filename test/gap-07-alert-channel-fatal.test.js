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
