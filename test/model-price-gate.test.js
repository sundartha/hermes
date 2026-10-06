import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState, trackUsage, aiCostCents, budgetExceeded, setTenantBudget, usageFor, tokenCostMicroCents,
} from "../src/store/state-ops.js";
import { config } from "../src/config.js";
import { PRICES, TEST_MODEL_CHEAP, TEST_MODEL_EXPENSIVE, tokensOf, tokensWithCache } from "./_prices.js";

const T = "tenant_p7a";
const ONE_M = 1_000_000;
const centsFor = (m) => Math.round(PRICES.modelPricesUsd[m].inPerMTok * PRICES.usdToEur * 100);

test("P7a: ein Nicht-Haiku-Modell bucht zu SEINEM hinterlegten Preis", () => {
  const s = makeDefaultState();
  trackUsage(s, T, tokensOf(ONE_M, 0, TEST_MODEL_EXPENSIVE), PRICES);
  assert.equal(usageFor(s, T).costCents, centsFor(TEST_MODEL_EXPENSIVE));
});

test("P7a: dieselben Token kosten unter zwei Modellen VERSCHIEDEN (Modell-ID wird nicht ignoriert)", () => {
  const s = makeDefaultState();
  trackUsage(s, "cheap", tokensOf(ONE_M, 0, TEST_MODEL_CHEAP), PRICES);
  trackUsage(s, "expensive", tokensOf(ONE_M, 0, TEST_MODEL_EXPENSIVE), PRICES);
  assert.equal(usageFor(s, "cheap").costCents, centsFor(TEST_MODEL_CHEAP));
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

test("P7a: unbekannte Modell-ID wirft NICHT auf der echten config-Oberflaeche (Proxy-Trap)", () => {
  const s = makeDefaultState();
  assert.doesNotThrow(() =>
    trackUsage(s, T, tokensOf(ONE_M, 0, "claude-gibt-es-nicht-9"), config.llm),
  );
  assert.ok(usageFor(s, T).costCents > 0, "und bucht dabei einen echten Betrag, nicht 0");
});

const CACHE_MIX = { uncached: 5, cacheWrite: 20, cacheRead: 100, output: 7 };
const MICRO_CENTS_AFTER = 6975;
const MICRO_CENTS_BEFORE = 14880;

test("B4A-FORM-1: jede Token-Sorte rechnet mit IHRER Rate - der gebuchte Betrag sinkt bei Cache-Treffern", () => {
  assert.equal(tokenCostMicroCents(tokensWithCache({ ...CACHE_MIX }), PRICES), MICRO_CENTS_AFTER);
  assert.ok(
    MICRO_CENTS_AFTER < MICRO_CENTS_BEFORE,
    "der Rueckgang ist beziffert, nicht behauptet: 6975 statt 14880 Mikro-Cent bei diesem Cache-Mix",
  );
});

test("B4A-FORM-2: getauschte Sorten ergeben einen ANDEREN Betrag (ein Copy-Paste-Fehler an einer Rate faellt auf)", () => {
  const swapped = tokensWithCache({
    ...CACHE_MIX,
    cacheWrite: CACHE_MIX.cacheRead,
    cacheRead: CACHE_MIX.cacheWrite,
  });
  assert.notEqual(tokenCostMicroCents(swapped, PRICES), MICRO_CENTS_AFTER);
});

test("B4A-FORM-3: cache-freier Verbrauch rechnet byte-identisch zum Bestand", () => {
  const s = makeDefaultState();
  trackUsage(s, "b4a_ohne_cache", tokensOf(ONE_M, 0, TEST_MODEL_CHEAP), PRICES);
  assert.equal(usageFor(s, "b4a_ohne_cache").costCents, centsFor(TEST_MODEL_CHEAP));
});

const CROSSED_PRICES = Object.freeze({
  modelPricesUsd: Object.freeze({
    a: { inPerMTok: 9.0, cacheWritePerMTok: 11.0, cacheReadPerMTok: 0.9, outPerMTok: 1.0 },
    b: { inPerMTok: 1.0, cacheWritePerMTok: 1.2, cacheReadPerMTok: 0.1, outPerMTok: 9.0 },
  }),
  usdToEur: PRICES.usdToEur,
});

test("B4A-WORST-1 FAIL-CLOSED: unbekannte ID bucht das punktweise Maximum JEDER Rate, nicht einen Einzeleintrag", () => {
  const booked = tokenCostMicroCents(tokensWithCache({ ...CACHE_MIX, model: "modell-gibt-es-nicht" }), CROSSED_PRICES);
  const underA = tokenCostMicroCents(tokensWithCache({ ...CACHE_MIX, model: "a" }), CROSSED_PRICES);
  const underB = tokenCostMicroCents(tokensWithCache({ ...CACHE_MIX, model: "b" }), CROSSED_PRICES);
  assert.ok(
    booked > underA && booked > underB,
    "teurer als JEDER Einzeleintrag - das schafft nur das punktweise Maximum",
  );
});

test("B4A-WORST-2: eine LEERE Preistabelle wirft weiterhin mit der woertlich erhaltenen Meldung", () => {
  assert.throws(
    () => tokenCostMicroCents(tokensOf(ONE_M, 0, "egal"), { modelPricesUsd: {}, usdToEur: 1 }),
    /modelPricesUsd ist leer - keine Preisquelle fuer den Budget-Guard \(Regel 1\)/,
  );
});

test("B4A-WORST-3: der Fail-closed-Zweig wirft auch MIT Cache-Sorten nicht auf der echten config-Oberflaeche", () => {
  const s = makeDefaultState();
  const tokens = tokensWithCache({ ...CACHE_MIX, uncached: ONE_M, model: "claude-gibt-es-nicht-9" });
  assert.doesNotThrow(() => trackUsage(s, "b4a_proxy", tokens, config.llm));
  assert.ok(usageFor(s, "b4a_proxy").costCents > 0, "und bucht dabei einen echten Betrag, nicht 0");
});
