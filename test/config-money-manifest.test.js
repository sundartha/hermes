import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_NAMESPACES } from "../src/config.js";

const MONEY_CONFIG_KEYS = Object.freeze([
  "platformSpendCapCents",
  "numberSetupFeeCents",
  "voiceTariffDomesticCents",
  "voiceTariffDefaultCents",
  "voiceTariffInboundCents",
  "voiceTariffFullCostFloorCents",
  "defaultTenantBudgetCents",
  "smsCostCents",
  "usdToEur",
  "modelPricesUsd",
  "numberMonthlyCostCents",
  "platformFixedCostUsdCentsPerMonth",
  "voiceTariffGrundbetragCentsJeRoute",
  "researchSearchFeeCents",
  "lookupSearchFeeCents",
]);

const MONEY_NAME_PATTERN = /(Cents|Eur|Usd)$/;

test("Geld-Manifest: jedes Cents-/Eur-/Usd-Feld in config.js ist im Manifest erfasst", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const moneyShapedKeys = allNamespacedKeys.filter((k) => MONEY_NAME_PATTERN.test(k));
  const unregistered = moneyShapedKeys.filter((k) => !MONEY_CONFIG_KEYS.includes(k));
  assert.deepEqual(
    unregistered,
    [],
    `Neues Geld-Feld in config.js nicht im Manifest eingetragen: ${unregistered.join(", ")}. ` +
      `Bewusst in MONEY_CONFIG_KEYS (test/config-money-manifest.test.js) aufnehmen.`,
  );
});

test("Geld-Manifest: kein gelistetes Feld wurde stillschweigend aus config.js entfernt", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const missing = MONEY_CONFIG_KEYS.filter((k) => !allNamespacedKeys.includes(k));
  assert.deepEqual(
    missing,
    [],
    `Manifest-Feld existiert nicht mehr in config.js: ${missing.join(", ")}. Manifest nachziehen.`,
  );
});
