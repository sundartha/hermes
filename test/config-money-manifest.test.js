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
import { CONFIG_NAMESPACES } from "../src/config.js";

// EINE Liste aller Geld-Felder in config.js (G26: Cents-Ganzzahlen bzw. EUR/USD-Preise).
const MONEY_CONFIG_KEYS = Object.freeze([
  "platformSpendCapCents",
  "numberSetupFeeCents",
  "voiceTariffDomesticCents",
  "voiceTariffDefaultCents",
  "voiceTariffFullCostFloorCents",
  "defaultTenantBudgetCents",
  "smsCostCents",
  "usdToEur",
  // P7a: eine Preistabelle pro Modell-ID ersetzt die vormals zwei globalen
  // Preis-Skalare (Input/Output pro 1M Tokens). Der Namens-Scan greift ueber
  // das Usd-Suffix weiter.
  "modelPricesUsd",
  // LCT P7 (Fixkosten sichtbar machen): DID-Listenmiete je Nummer (EUR-Cent).
  "numberMonthlyCostCents",
  // platformFixedCostCentsPerMonth traegt kein Cents-/Eur-/Usd-Suffix am WORTENDE (endet
  // auf "PerMonth") und wird deshalb bewusst zusaetzlich manuell eingetragen: reine Anzeige-
  // Fixkosten in GANZZAHL EUR-Cent, dasselbe Geld-Feld-Muster wie die Cents-Suffix-Felder.
  "platformFixedCostCentsPerMonth",
  // AL-P10: Preis EINER serverseitigen Vorab-Suche (Ganzzahl EUR-Cent, Muster
  // smsCostCents) - Geld-Feld der Vorab-Recherche im Pre-Call-Briefing.
  "researchSearchFeeCents",
]);

const MONEY_NAME_PATTERN = /(Cents|Eur|Usd)$/;

// PA-20 (Flip): config selbst traegt nur noch die 13 Namespaces (Object.keys(config) waere
// hier blind - "platformSpendCapCents" in config ist seit dem Flip false). Der Scan laeuft daher
// auf CONFIG_NAMESPACES (den 99 Blaettern), nicht mehr auf der Laufzeit-Oberflaeche - der
// Manifest-Guard bleibt so wirksam statt vakuum-gruen zu werden.
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
