// P7a (PLAN-CONVERSATION-QUALITY-V2): der Budget-Guard rechnet PRO MODELL.
// Regel 1: ein Modell, das nicht in der Preistabelle steht, darf NIEMALS zu Preis 0
// oder zum Haiku-Default gebucht werden - es gilt die TEUERSTE hinterlegte Rate
// (fail-closed). Ein zu NIEDRIGER Preis macht die KI-Kosten-Achse des Gates blind.
// Reine state-ops-Unit (kein Netz, kein Server, kein pglite) - Lehre P6a.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState, trackUsage, aiCostCents, budgetExceeded, setTenantBudget, usageFor, tokenCostMicroCents,
} from "../src/store/state-ops.js";
import { config } from "../src/config.js";
import { PRICES, TEST_MODEL_CHEAP, TEST_MODEL_EXPENSIVE, tokensOf, tokensWithCache } from "./_prices.js";

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

// ---- B4a: die Preisrechnung je Token-Sorte (vier Raten statt zweier) -----------------

// Die Fixture aus test/llm.test.js (T-I13-2), paarweise verschiedene Zahlen gegen
// paarweise verschiedene Raten - jede Vertauschung aendert das Ergebnis.
const CACHE_MIX = { uncached: 5, cacheWrite: 20, cacheRead: 100, output: 7 };
// Von Hand, Fixture-Raten des guenstigen Modells (1.00 / 1.25 / 0.10 / 5.00), Kurs 0.93:
//   NACHHER: (5*1.00 + 20*1.25 + 100*0.10 + 7*5.00)/1e6 = 0.000075 USD -> 6975 Mikro-ct
//   VORHER (Faltung von 125 Eingabe-Token auf die volle Eingabe-Rate):
//           (125*1.00 + 7*5.00)/1e6 = 0.000160 USD -> 14880 Mikro-ct
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

// ---- B4a: worstCasePrice ist die PUNKTWEISE Obergrenze -------------------------------

// Zwei Staffeln, von denen KEINE in allen vier Raten dominiert: A ist bei der Eingabe
// teuer und bei der Ausgabe billig, B umgekehrt. "Der teuerste EINTRAG" koennte hier nur
// eine der beiden waehlen und waere in der jeweils anderen Rate zu billig.
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
