// OUT-05: Reserve-Ledger (state-ops-Unit, REIN - kein IO, kein Netz, kein Store-Singleton).
// Jeder Test baut einen frischen makeDefaultState() (F.I.R.S.T., unabhaengig). Prueft die
// FACHLOGIK der In-Flight-Reservierung: kumulative Kappung (Tenant UND global, Schnittmenge,
// Regel 1), atomarer Check+Increment ohne Schreibeffekt bei Ablehnung, Idempotenz + Clamp
// bei der Freigabe. Der Server (F2) ruft diese Funktionen noch nicht - reiner Store-Test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  reservationFor,
  reservationsTotal,
  reserveExceedsBudget,
  globalReserveExceedsBudget,
  tryReserveOutboundBudget,
  releaseOutboundReserve,
  addVoiceUsageCostCents,
} from "../src/store/state-ops.js";

const CFG = { platformSpendCapCents: 100 }; // 1 EUR Cap (global + Owner-Fallback ohne tenant_budget-Zeile)
const T1 = "tenant_ledger_1";
const T2 = "tenant_ledger_2";

test("reservationFor/reservationsTotal: leerer Ledger -> 0", () => {
  const s = makeDefaultState();
  assert.equal(reservationFor(s, T1), 0);
  assert.equal(reservationsTotal(s), 0);
});

test("reserveExceedsBudget zaehlt bestehende Reserve kumulativ (Grenze exakt auf Cap)", () => {
  const s = makeDefaultState();
  s.reservations[T1] = 40; // 0.40 EUR bereits reserviert
  assert.equal(reserveExceedsBudget(s, T1, 60, CFG), false, "0.40 + 0.60 = 1.00 EUR exakt auf Cap");
  assert.equal(reserveExceedsBudget(s, T1, 61, CFG), true, "0.40 + 0.61 = 1.01 EUR > Cap");
});

test("tryReserveOutboundBudget: Check+Increment synchron, abgelehnte Reserve schreibt NICHT", () => {
  const s = makeDefaultState();
  assert.equal(tryReserveOutboundBudget(s, T1, 60, CFG), true, "0.60 EUR < 1 EUR Cap -> reserviert");
  assert.equal(reservationFor(s, T1), 60);
  assert.equal(tryReserveOutboundBudget(s, T1, 60, CFG), false, "weitere 0.60 EUR wuerden 1.20 > 1 EUR");
  assert.equal(reservationFor(s, T1), 60, "abgelehnte Reserve hinterlaesst keinen Schreibeffekt");
});

test("S1-6: tryReserveOutboundBudget mit negativem/NaN reserveCents -> false, Ledger unveraendert (fail-closed)", () => {
  const s = makeDefaultState();
  s.reservations[T1] = 40;
  assert.equal(tryReserveOutboundBudget(s, T1, -300, CFG), false, "negativ -> fail-closed");
  assert.equal(reservationFor(s, T1), 40, "negativer Wert SENKT den Ledger NICHT");
  assert.equal(tryReserveOutboundBudget(s, T1, NaN, CFG), false, "NaN -> fail-closed");
  assert.equal(reservationFor(s, T1), 40);
  assert.equal(tryReserveOutboundBudget(s, T1, 0, CFG), true, "0 ist valide (kostenlose Reserve)");
});

test("globalReserveExceedsBudget: pro-Tenant frei, Summe reisst den globalen Cap", () => {
  const s = makeDefaultState();
  s.reservations[T1] = 60; // T1 haelt bereits 0.60 EUR Reserve
  // T2 selbst waere unter dem 1-EUR-Cap frei (0.60 EUR), aber die Plattform-Summe
  // (0.60 + 0.60 = 1.20 EUR) reisst den globalen Notaus.
  assert.equal(reserveExceedsBudget(s, T2, 60, CFG), false, "T2 pro-Tenant allein waere frei");
  assert.equal(globalReserveExceedsBudget(s, 60, CFG), true, "Plattform-Summe > globaler Cap");
});

test("settled costCents + In-Flight-Reserve kumulieren (Reconcile hebt die Reserve-Schwelle)", () => {
  const s = makeDefaultState();
  addVoiceUsageCostCents(s, T1, 70); // 0.70 EUR bereits abgerechnet (settled)
  assert.equal(reserveExceedsBudget(s, T1, 30, CFG), false, "0.70 + 0.30 = 1.00 EUR exakt auf Cap");
  assert.equal(reserveExceedsBudget(s, T1, 31, CFG), true, "0.70 + 0.31 EUR > Cap");
});

test("releaseOutboundReserve: Clamp >= 0 bei Ueber-Freigabe, kein negativer Ledger", () => {
  const s = makeDefaultState();
  s.reservations[T1] = 40;
  const call = { tenantId: T1, reserveCents: 100, reserveReleased: false }; // mehr als reserviert
  assert.equal(releaseOutboundReserve(s, call), true);
  assert.equal(reservationFor(s, T1), 0, "Clamp bei Math.max(0, ...) statt negativ");
});

test("releaseOutboundReserve: Idempotenz ueber reserveReleased (zweiter Aufruf No-Op)", () => {
  const s = makeDefaultState();
  s.reservations[T1] = 60;
  const call = { tenantId: T1, reserveCents: 60, reserveReleased: false };
  assert.equal(releaseOutboundReserve(s, call), true, "erste Freigabe wirkt");
  assert.equal(reservationFor(s, T1), 0);
  assert.equal(releaseOutboundReserve(s, call), false, "zweite Freigabe ist No-Op (reserveReleased=true)");
  assert.equal(reservationFor(s, T1), 0, "kein doppelter Abzug");
});

test("releaseOutboundReserve: No-Op ohne reservierte Cents (0/null/fehlender Call)", () => {
  const s = makeDefaultState();
  assert.equal(releaseOutboundReserve(s, null), false, "kein Call -> No-Op");
  assert.equal(releaseOutboundReserve(s, { tenantId: T1, reserveCents: 0 }), false, "0 Cents -> No-Op");
  assert.equal(
    releaseOutboundReserve(s, { tenantId: T1, reserveCents: null }),
    false,
    "null Cents -> No-Op",
  );
});
