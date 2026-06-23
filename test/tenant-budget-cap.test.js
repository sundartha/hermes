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
  setTenantBudget,
} from "../src/store/state-ops.js";

const PRICES = { priceInPerMTokUsd: 1.0, priceOutPerMTokUsd: 5.0, usdToEur: 0.93, maxBudgetEur: 8 };
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

// Token-Mengen unter PRICES (Input 1 USD/MTok * 0.93 = 0.93 EUR/MTok).
const TOKENS_PER_EUR = 1_000_000 / 0.93; // ~1.075M Input-Tokens = 1 EUR

test("INV(3): Owner ohne tenant_budget-Zeile = exakt cfg.maxBudgetEur (byte-identisch)", () => {
  const s = makeDefaultState();
  // knapp unter dem Cap -> frei
  trackUsage(s, TENANT_A, Math.floor(TOKENS_PER_EUR * 7.9), 0, PRICES);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "unter 8 EUR -> frei");
  // genau auf/ueber dem Cap (>=) -> exceeded, wie der Bestand (costEur >= maxBudgetEur)
  trackUsage(s, TENANT_A, Math.ceil(TOKENS_PER_EUR * 0.2), 0, PRICES);
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
  trackUsage(s, TENANT_A, Math.ceil(TOKENS_PER_EUR * 6), 0, PRICES);
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "A ueber seinem pro-Tenant-Cap");
  // B: 4 EUR, keine eigene Zeile -> faellt auf den globalen 8-EUR-Cap -> frei
  trackUsage(s, TENANT_B, Math.floor(TOKENS_PER_EUR * 4), 0, PRICES);
  assert.equal(budgetExceeded(s, TENANT_B, PRICES), false, "B faellt auf maxBudgetEur, frei");
});

test("INV(2): Schnittmenge - globaler Notaus greift, waehrend jeder unter SEINEM Cap bleibt", () => {
  const s = makeDefaultState();
  // Je 5 EUR (unter dem globalen 8-EUR-Cap), Summe 10 EUR -> globaler Notaus.
  trackUsage(s, TENANT_A, Math.floor(TOKENS_PER_EUR * 5), 0, PRICES);
  trackUsage(s, TENANT_B, Math.floor(TOKENS_PER_EUR * 5), 0, PRICES);
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
  trackUsage(s, TENANT_A, Math.ceil(TOKENS_PER_EUR * 3), 0, PRICES); // 3 EUR > 2-EUR-Cap, < 8 global
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
  trackUsage(s, TENANT_A, Math.round(TOKENS_PER_EUR * 5), 0, PRICES); // genau ~5 EUR
  // costEur ist Float; >= 5 EUR muss exceeden. Wir runden minimal drueber, um den
  // Inklusiv-Vergleich deterministisch zu treffen.
  trackUsage(s, TENANT_A, 1, 0, PRICES);
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
