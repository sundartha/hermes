// P7a (PLAN-CONVERSATION-QUALITY-V2): der Budget-Guard rechnet PRO MODELL.
// Regel 1: ein Modell, das nicht in der Preistabelle steht, darf NIEMALS zu Preis 0
// oder zum Haiku-Default gebucht werden - es gilt die TEUERSTE hinterlegte Rate
// (fail-closed). Ein zu NIEDRIGER Preis macht die KI-Kosten-Achse des Gates blind.
// Reine state-ops-Unit (kein Netz, kein Server, kein pglite) - Lehre P6a.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState, trackUsage, aiCostCents, budgetExceeded, setTenantBudget, usageFor,
} from "../src/store/state-ops.js";
import { config } from "../src/config.js";
import { PRICES, TEST_MODEL_CHEAP, TEST_MODEL_EXPENSIVE, tokensOf } from "./_prices.js";

const T = "tenant_p7a";
const ONE_M = 1_000_000;
// Erwartete Cents fuer 1M Input-Tokens, aus der FIXTURE abgeleitet (kein gepinnter
// Literalwert - die Fixture darf sich aendern, ohne dass diese Datei luegt).
const centsFor = (m) => Math.round(PRICES.modelPricesUsd[m].inPerMTok * PRICES.usdToEur * 100);

test("P7a: ein Nicht-Haiku-Modell bucht zu SEINEM hinterlegten Preis", () => {
  const s = makeDefaultState();
  trackUsage(s, T, tokensOf(ONE_M, 0, TEST_MODEL_EXPENSIVE), PRICES);
  assert.equal(usageFor(s, T).costCents, centsFor(TEST_MODEL_EXPENSIVE)); // 279
});

test("P7a: dieselben Token kosten unter zwei Modellen VERSCHIEDEN (Modell-ID wird nicht ignoriert)", () => {
  const s = makeDefaultState();
  trackUsage(s, "cheap", tokensOf(ONE_M, 0, TEST_MODEL_CHEAP), PRICES);
  trackUsage(s, "expensive", tokensOf(ONE_M, 0, TEST_MODEL_EXPENSIVE), PRICES);
  assert.equal(usageFor(s, "cheap").costCents, centsFor(TEST_MODEL_CHEAP)); // 93
  assert.ok(
    usageFor(s, "expensive").costCents > usageFor(s, "cheap").costCents,
    "eine Implementierung, die das model-Argument annimmt aber ignoriert, faellt hier durch",
  );
});

test("P7a FAIL-CLOSED: unbekannte Modell-ID bucht zur TEUERSTEN Rate - nie Haiku, nie 0", () => {
  const s = makeDefaultState();
  trackUsage(s, T, tokensOf(ONE_M, 0, "claude-gibt-es-nicht-9"), PRICES);
  const booked = usageFor(s, T).costCents;
  assert.notEqual(booked, 0, "unbekanntes Modell darf NIE gratis sein");
  assert.notEqual(booked, centsFor(TEST_MODEL_CHEAP), "unbekanntes Modell darf NICHT auf Haiku fallen");
  assert.equal(booked, centsFor(TEST_MODEL_EXPENSIVE), "teuerste hinterlegte Rate");
});

test("P7a FAIL-CLOSED: ein unbekanntes Modell macht das Budget-Gate NICHT blind", () => {
  const s = makeDefaultState();
  // Cap liegt ZWISCHEN guenstiger und teuerster Rate fuer denselben Verbrauch:
  // zum Haiku-Preis (93) bliebe der Tenant frei, zur teuersten Rate (279) reisst er.
  const cap = Math.round((centsFor(TEST_MODEL_CHEAP) + centsFor(TEST_MODEL_EXPENSIVE)) / 2);
  setTenantBudget(s, T, { budgetCents: cap, hardCapCents: cap });
  trackUsage(s, T, tokensOf(ONE_M, 0, "claude-gibt-es-nicht-9"), PRICES);
  assert.equal(budgetExceeded(s, T, PRICES), true, "Regel 1: Gate greift auch fuer unbekannte Modelle");
});

test("P7a: aiCostCents (Stripe-Ledger) nutzt DIESELBE Preistabelle wie das Live-Gate", () => {
  assert.equal(aiCostCents(tokensOf(ONE_M, 0, TEST_MODEL_EXPENSIVE), PRICES), centsFor(TEST_MODEL_EXPENSIVE));
  assert.equal(aiCostCents(tokensOf(ONE_M, 0, TEST_MODEL_CHEAP), PRICES), centsFor(TEST_MODEL_CHEAP));
  assert.equal(aiCostCents(tokensOf(ONE_M, 0, "claude-gibt-es-nicht-9"), PRICES), centsFor(TEST_MODEL_EXPENSIVE));
});

// Der Fail-closed-Zweig muss auf der ECHTEN config-Oberflaeche laufen, nicht nur auf
// einem Plain-Object-Mock: config.llm.modelPricesUsd ist ein guardedConfig-PROXY, dessen
// get-Trap bei einem unbekannten Schluessel WIRFT. Ein Roh-Index (prices[model] ?? x)
// wuerde den Turn hier mit TypeError killen (500 auf /voice/turn) statt konservativ zu
// buchen - ein Plain-Mock wuerde diese Regression NICHT fangen.
// Env-unabhaengig: modelPricesUsd/usdToEur sind Literale, keine Env-Vars.
test("P7a: unbekannte Modell-ID wirft NICHT auf der echten config-Oberflaeche (Proxy-Trap)", () => {
  const s = makeDefaultState();
  assert.doesNotThrow(() =>
    trackUsage(s, T, tokensOf(ONE_M, 0, "claude-gibt-es-nicht-9"), config.llm),
  );
  assert.ok(usageFor(s, T).costCents > 0, "und bucht dabei einen echten Betrag, nicht 0");
});
