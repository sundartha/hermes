// P6b3: per-Tenant-Kostendecke (tenant_budget) + budgetExceeded. Prueft die
// INVARIANTEN (1) pro-Tenant-Cap, (2) Schnittmenge mit dem globalen Notaus, (3)
// Owner ohne tenant_budget-Zeile byte-identisch zum Bestand - rein ueber state-ops
// (kein Netz, kein Server, kein pglite; Lehre P6a: state-ops-Unit NICHT mit
// Spawn/pglite mischen). Verbrauchsquelle bleibt die usage-Map (trackUsage); neu
// ist nur der effektive Cap. usage_event wird hier NICHT angefasst (getrennte
// Quelle, kein Doppelzaehlen).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  trackUsage,
  budgetExceeded,
  globalBudgetExceeded,
  globalUsageTotals,
  setTenantBudget,
  usageFor,
  addVoiceUsageCostCents,
} from "../src/store/state-ops.js";
import { PRICES, TEST_MODEL_CHEAP, tokensOf } from "./_prices.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

// Token-Mengen unter PRICES (Input 1 USD/MTok * 0.93 = 0.93 EUR/MTok).
const TOKENS_PER_EUR = 1_000_000 / 0.93; // ~1.075M Input-Tokens = 1 EUR

// Preis-Rate des in dieser Datei genutzten Test-Modells (G5: eine Ableitungsstelle
// statt mehrfach verstreuter direkter Preis-Feld-Zugriffe auf PRICES, P7a).
const RATE = PRICES.modelPricesUsd[TEST_MODEL_CHEAP];

test("INV(3): Owner ohne tenant_budget-Zeile = exakt cfg.maxBudgetCents (byte-identisch)", () => {
  const s = makeDefaultState();
  // knapp unter dem Cap -> frei
  trackUsage(s, TENANT_A, tokensOf(Math.floor(TOKENS_PER_EUR * 7.9), 0), PRICES);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "unter 8 EUR -> frei");
  // genau auf/ueber dem Cap (>=) -> exceeded, wie der Bestand (costCents >= maxBudgetCents)
  trackUsage(s, TENANT_A, tokensOf(Math.ceil(TOKENS_PER_EUR * 0.2), 0), PRICES);
  assert.equal(
    budgetExceeded(s, TENANT_A, PRICES),
    true,
    ">= 8 EUR -> exceeded (Grenze inklusiv wie Bestand)",
  );
});

test("INV(1): pro-Tenant-Cap blockt A, B ohne Zeile telefoniert weiter", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 400, hardCapCents: 500 }); // 5 EUR harte Sperre
  // A: 6 EUR Verbrauch -> ueber seinen 5-EUR-Cap (waere unter dem globalen 8-EUR-Cap)
  trackUsage(s, TENANT_A, tokensOf(Math.ceil(TOKENS_PER_EUR * 6), 0), PRICES);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "A ueber seinem pro-Tenant-Cap");
  // B: 4 EUR, keine eigene Zeile -> faellt auf den globalen 8-EUR-Cap -> frei
  trackUsage(s, TENANT_B, tokensOf(Math.floor(TOKENS_PER_EUR * 4), 0), PRICES);
  assert.equal(budgetExceeded(s, TENANT_B, PRICES), false, "B faellt auf maxBudgetCents, frei");
});

test("INV(2): Schnittmenge - globaler Notaus greift, waehrend jeder unter SEINEM Cap bleibt", () => {
  const s = makeDefaultState();
  // Je 5 EUR (unter dem globalen 8-EUR-Cap), Summe 10 EUR -> globaler Notaus.
  trackUsage(s, TENANT_A, tokensOf(Math.floor(TOKENS_PER_EUR * 5), 0), PRICES);
  trackUsage(s, TENANT_B, tokensOf(Math.floor(TOKENS_PER_EUR * 5), 0), PRICES);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "A einzeln unter Cap");
  assert.equal(budgetExceeded(s, TENANT_B, PRICES), false, "B einzeln unter Cap");
  assert.equal(
    globalBudgetExceeded(s, PRICES),
    true,
    "Plattform-Summe ueber Cap (Notaus bleibt parallel)",
  );
});

test("INV(2b): pro-Tenant-Cap greift unabhaengig vom globalen (A blockt, global frei)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 100, hardCapCents: 200 }); // 2 EUR
  trackUsage(s, TENANT_A, tokensOf(Math.ceil(TOKENS_PER_EUR * 3), 0), PRICES); // 3 EUR > 2-EUR-Cap, < 8 global
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "A ueber pro-Tenant-Cap");
  assert.equal(
    globalBudgetExceeded(s, PRICES),
    false,
    "global noch frei -> pro-Tenant greift unabhaengig",
  );
});

test("Grenzfall (T5/G3): hardCapCents exakt = Verbrauch -> exceeded (>= wie Bestand)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 400, hardCapCents: 500 }); // 5 EUR
  trackUsage(s, TENANT_A, tokensOf(Math.round(TOKENS_PER_EUR * 5), 0), PRICES); // genau ~5 EUR
  // costCents ist eine Ganzzahl; >= 5 EUR muss exceeden. Wir runden minimal drueber, um
  // den Inklusiv-Vergleich deterministisch zu treffen.
  trackUsage(s, TENANT_A, tokensOf(1, 0), PRICES);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "Verbrauch >= Cap -> exceeded");
});

test("Grenzfall (T5): hardCapCents=0 = pro-Tenant-Notaus -> sofort exceeded ohne Verbrauch", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 0, hardCapCents: 0 });
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "0-Cap -> sofort gesperrt (0 >= 0)");
});

test("setTenantBudget ist Upsert (eine Zeile pro Tenant, zweiter Aufruf aktualisiert)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 100, hardCapCents: 200 });
  setTenantBudget(s, TENANT_A, { budgetCents: 300, hardCapCents: 900 });
  assert.equal(s.tenantBudgets.length, 1, "kein Duplikat");
  assert.deepEqual(s.tenantBudgets[0], { tenantId: TENANT_A, budgetCents: 300, hardCapCents: 900 });
});

// ---- S1-1 (P1 Integer-Cents-Kern): addVoiceUsageCostCents/globalUsageTotals + der
// Safety-BLOCKER (Sub-Cent-Turns duerfen nie pro Inkrement auf 0 gerundet werden) ----

test("S1-1: addVoiceUsageCostCents bucht ganze Cents exakt (kein Float-Drift)", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 250);
  assert.equal(usageFor(s, TENANT_A).costCents, 250);
  addVoiceUsageCostCents(s, TENANT_A, 250);
  assert.equal(usageFor(s, TENANT_A).costCents, 500, "zweite Buchung addiert exakt, kein Rundungsfehler");
});

test("S1-1: globalUsageTotals summiert costCents als Ganzzahl ueber alle Tenant-Buckets", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 300);
  addVoiceUsageCostCents(s, TENANT_B, 450);
  assert.equal(globalUsageTotals(s).costCents, 750, "Owner-Bucket ist 0, Summe = A+B");
});

test("Grenzfall (T5): cap-1/cap/cap+1 mit ganzen Cents (addVoiceUsageCostCents) - >= wie Bestand", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 500, hardCapCents: 500 });
  addVoiceUsageCostCents(s, TENANT_A, 499);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "499 < 500 -> frei");
  addVoiceUsageCostCents(s, TENANT_A, 1); // -> 500
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "500 >= 500 -> exceeded");
  addVoiceUsageCostCents(s, TENANT_A, 1); // -> 501
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "501 > 500 -> exceeded");
});

// P1-SAFETY-BLOCKER: der KI-Kosten-Live-Gate-Akkumulator (trackUsage) darf einen
// Sub-Cent-Turn NICHT pro Inkrement auf 0 runden - sonst wird die KI-Kosten-Achse des
// Budget-Gates blind (stille Aufweichung von Absolute Regel 1). Ground-Truth ist die
// PRAEZISE (nicht per-Schritt gerundete) Summe ueber alle Turns.
test("S1-1 BLOCKER: viele Sub-Cent-Turns summieren ueber den Cap -> Gate greift", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 500, hardCapCents: 500 });
  const SUBCENT_TOKENS = 1000; // 0.00093 EUR = 0.093 Cent/Turn (<< 0,5 Cent)
  const TURNS = 6000;
  for (let i = 0; i < TURNS; i++) trackUsage(s, TENANT_A, tokensOf(SUBCENT_TOKENS, 0), PRICES);
  const preciseCents = TURNS * (SUBCENT_TOKENS / 1e6) * RATE.inPerMTok * PRICES.usdToEur * 100;
  assert.ok(preciseCents > 500, "Vorbedingung: praezise Summe (~558) reisst den Cap");
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "aufsummierte Sub-Cent-Turns reissen den Cap");
  assert.ok(
    usageFor(s, TENANT_A).costCents >= 500,
    "Sub-Cent-Turns in costCents akkumuliert, NICHT auf 0 gerundet (eine per-Inkrement-Rundung wuerde hier 0 liefern)",
  );
});

test("S1-1: praezise Rekonstruktion aus costCents+costMicroCentsRem (kein per-Schritt-Rounding)", () => {
  const s = makeDefaultState();
  const turns = [
    [1000, 0],
    [777, 200],
    [12345, 6789],
    [1, 0],
    [999999, 999999],
  ];
  let preciseEurSum = 0;
  for (const [inTok, outTok] of turns) {
    trackUsage(s, TENANT_A, tokensOf(inTok, outTok), PRICES);
    preciseEurSum +=
      ((inTok / 1e6) * RATE.inPerMTok + (outTok / 1e6) * RATE.outPerMTok) * PRICES.usdToEur;
  }
  const bucket = usageFor(s, TENANT_A);
  const reconstructedEur = (bucket.costCents + bucket.costMicroCentsRem / 1e6) / 100;
  assert.ok(
    Math.abs(reconstructedEur - preciseEurSum) < 1e-9,
    "Mikro-Cent-Rest fuehrt die volle Praezision ueber die Inkremente mit",
  );
});
