// outbound-p1c: Vorab-Reservierung (reserveExceedsBudget) + Budget-Reconcile
// (addVoiceUsageCostCents) auf STATE-OPS-Ebene. Prueft die INVARIANTEN: (1) Worst-Case-
// Reserve > verbleibender effektiver Cap -> true (402 vor Dial), (2) Reserve unter dem
// Rest erlaubt, (3) Reconcile bucht die Ist-Minuten in DENSELBEN usage-Bucket und hebt
// damit budgetExceeded + Reservierung an, (4) Reservierung nutzt die per-Tenant-Cap-
// Aufloesung (effectiveCapCents) - der globale Notaus bleibt davon unberuehrt, (5) Owner
// ohne tenant_budget-Zeile faellt auf platformSpendCapCents. Rein ueber state-ops (kein Netz, kein
// Server, kein pglite; Lehre P6a: state-ops-Unit NICHT mit Spawn/pglite mischen).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  trackUsage,
  budgetExceeded,
  setTenantBudget,
  usageFor,
  reserveExceedsBudget,
  addVoiceUsageCostCents,
} from "../src/store/state-ops.js";
import { PRICES, tokensOf } from "./_prices.js";

const TENANT_A = "tenant_a";

test("INV(1): teure Worst-Case-Reserve > kleiner Rest-Cap -> true (402 vor Dial)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 50, hardCapCents: 50 }); // 0.50 EUR Cap
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, 1500, PRICES),
    true,
    "15 EUR Reserve > 0.50 EUR Cap",
  );
});

test("INV(2): Reserve unter dem Rest -> false (erlaubt)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 800, hardCapCents: 800 }); // 8 EUR Cap
  assert.equal(reserveExceedsBudget(s, TENANT_A, 60, PRICES), false, "0.60 EUR Reserve < 8 EUR Cap");
});

test("INV(3): Reconcile bucht die Ist-Minuten in den Budget-Bucket (costCents)", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 100); // 1.00 EUR Ist
  assert.equal(usageFor(s, TENANT_A).costCents, 100, "100 ct -> exakt 100 Cents im Live-Bucket");
});

test("INV(3b): Reconcile hebt budgetExceeded + reserveExceedsBudget an (Carrier-Minuten sichtbar)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 150, hardCapCents: 150 }); // 1.50 EUR Cap
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "leerer Bucket unter 1.50 EUR");
  addVoiceUsageCostCents(s, TENANT_A, 200); // 2.00 EUR Ist > 1.50 EUR
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "Ist-Minuten reissen den Cap");
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, 1, PRICES),
    true,
    "auch eine Mini-Reserve ueberschreitet jetzt",
  );
});

test("INV(4): Reservierung nutzt per-Tenant effectiveCapCents (Zeile gewinnt)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 200, hardCapCents: 200 }); // 2 EUR
  // Reserve 3 EUR > 2-EUR-Zeile, aber < 8-EUR-Fallback -> die Zeile gewinnt.
  assert.equal(reserveExceedsBudget(s, TENANT_A, 300, PRICES), true, "pro-Tenant-Zeile (2 EUR) gewinnt");
  // budgetExceeded byte-identisch (kein Verbrauch).
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "leerer Bucket -> budgetExceeded unveraendert");
});

test("INV(5): Owner ohne tenant_budget-Zeile -> Cap = platformSpendCapCents (byte-identisch)", () => {
  const s = makeDefaultState();
  // kein setTenantBudget -> effektiver Cap = platformSpendCapCents (8 EUR)
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, 60, PRICES),
    false,
    "0.60 EUR Reserve < 8 EUR (platformSpendCapCents)",
  );
  // Worst-Case ueber dem globalen 8-EUR-Cap -> true (Owner faellt auf platformSpendCapCents).
  assert.equal(reserveExceedsBudget(s, TENANT_A, 900, PRICES), true, "9 EUR Reserve > 8 EUR platformSpendCapCents");
});

// PAY-23 (Buchhaltung, kein eigener Test): "Reserve exakt gleich dem verbleibenden Cap ist
// ERLAUBT (strikt >, nicht >=)" ist woertlich die Aussage des Tests darunter - er pinnt
// beide Seiten der Kante (100 -> false, 101 -> true). Ein zweiter Test waere ein Duplikat
// (G5); die Katalog-ID steht deshalb hier und nicht im Testnamen.
test("Grenzfall (T5): Reserve exakt = Rest -> false (strikt >, erlaubt)", () => {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT_A, { budgetCents: 100, hardCapCents: 100 }); // 1.00 EUR Cap
  // 0 Verbrauch + 100 ct (1.00 EUR) == Cap -> NICHT > -> erlaubt.
  assert.equal(reserveExceedsBudget(s, TENANT_A, 100, PRICES), false, "Reserve genau auf dem Cap -> erlaubt");
  assert.equal(reserveExceedsBudget(s, TENANT_A, 101, PRICES), true, "ein Cent drueber -> blockiert");
});

test("Grenzfall (T5): Reconcile mit 0 ct laesst costCents unveraendert", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, TENANT_A, 0);
  assert.equal(usageFor(s, TENANT_A).costCents, 0, "0 ct -> kein Abzug");
});

test("Bestand: trackUsage + budgetExceeded byte-identisch (Reconcile addiert nur dazu)", () => {
  const s = makeDefaultState();
  const TOKENS_PER_EUR = 1_000_000 / 0.93;
  trackUsage(s, TENANT_A, tokensOf(Math.floor(TOKENS_PER_EUR * 7), 0), PRICES); // 7 EUR Token-Kosten
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), false, "7 EUR < 8 EUR -> frei (Bestand)");
  addVoiceUsageCostCents(s, TENANT_A, 150); // +1.50 EUR Carrier -> 8.50 EUR ueber dem Cap
  assert.equal(budgetExceeded(s, TENANT_A, PRICES), true, "Token + Carrier zusammen reissen den Cap");
});
