// Geld-Manifest-Guard (PLAN-CLEAN-CODE-COUPLING-AUDIT.md, Option B): config.js mischt
// Money/Safety/Locale in einer Datei, jede Feature-Serie editiert sie. Historisch hat das
// noch nie zu einer stillen Geld-Aenderung durch einen fachfremden PR gefuehrt (Audit-Befund),
// aber die Datei bleibt strukturell anfaellig dafuer. Dieser Test ist die billige Absicherung
// statt eines Datei-Splits: jedes neue ODER entfernte Geld-Feld MUSS bewusst im Manifest
// eintragen/austragen werden, sonst schlaegt CI fehl -- ein Reviewer sieht die Aenderung
// dann garantiert, statt dass sie im Rauschen eines unrelated Diffs untergeht.
//
// Bewusst NUR Existenz-/Namens-Check, KEIN Pin auf konkrete Werte: numEnv()-Fallbacks
// werden von process.env ueberschrieben, sobald ein Entwickler lokal ein echtes .env
// geladen hat -- ein Werte-Pin waere umgebungsabhaengig-flaky. Der Namens-Scan ist
// env-unabhaengig (prueft nur Property-Keys, nie Werte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";

// EINE Liste aller Geld-Felder in config.js (G26: Cents-Ganzzahlen bzw. EUR/USD-Preise).
const MONEY_CONFIG_KEYS = Object.freeze([
  "maxBudgetCents",
  "numberSetupFeeCents",
  "voiceTariffDomesticCents",
  "voiceTariffDefaultCents",
  "defaultTenantBudgetCents",
  "smsCostCents",
  "usdToEur",
  "priceInPerMTokUsd",
  "priceOutPerMTokUsd",
]);

const MONEY_NAME_PATTERN = /(Cents|Eur|Usd)$/;

test("Geld-Manifest: jedes Cents-/Eur-/Usd-Feld in config.js ist im Manifest erfasst", () => {
  const moneyShapedKeys = Object.keys(config).filter((k) => MONEY_NAME_PATTERN.test(k));
  const unregistered = moneyShapedKeys.filter((k) => !MONEY_CONFIG_KEYS.includes(k));
  assert.deepEqual(
    unregistered,
    [],
    `Neues Geld-Feld in config.js nicht im Manifest eingetragen: ${unregistered.join(", ")}. ` +
      `Bewusst in MONEY_CONFIG_KEYS (test/config-money-manifest.test.js) aufnehmen.`,
  );
});

test("Geld-Manifest: kein gelistetes Feld wurde stillschweigend aus config.js entfernt", () => {
  const missing = MONEY_CONFIG_KEYS.filter((k) => !(k in config));
  assert.deepEqual(
    missing,
    [],
    `Manifest-Feld existiert nicht mehr in config.js: ${missing.join(", ")}. Manifest nachziehen.`,
  );
});
