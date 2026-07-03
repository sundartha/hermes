// OUT-05: Reserve-Ledger ueber die Store-FASSADE (json-Backend, Temp-DATA_DIR). Muster:
// store-purge.test.js (before() seedet ein Temp-DATA_DIR, dann EIN store.js-Import fuers
// ganze File). Der Referenz-Test fuer die Phase: beweist Atomaritaet unter
// store.withStoreLock (kein Doppel-Grant bei N parallelen Reservierungen) UND die globale
// Achse (Schnittmenge Tenant + Plattform, Regel 1). Jeder Test nutzt eigene Tenant-IDs UND
// gibt seine Reserve am Ende frei (F.I.R.S.T./Independence): der globale Ledger endet bei 0,
// kein Test-Kopplungs-Leak ueber reservationsTotal. Server (F2) ruft tryReserve noch nicht -
// dieser Test treibt NUR die Store-Fassade.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";

const CFG = { maxBudgetEur: 1 }; // 1 EUR Cap (Owner-Fallback ohne tenant_budget-Zeile)
const RESERVE_CENTS = 60; // 0.60 EUR pro Reservierung

let store;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  store = await import("../src/store.js");
});

test("Atomaritaet/Kumulativitaet: 5 parallele Reservierungen -> genau 1x true, 4x false", async () => {
  const T1 = "tenant_concurrency_1";
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () =>
      store.withStoreLock(() => store.tryReserveOutboundBudget(T1, RESERVE_CENTS, CFG)),
    ),
  );
  const granted = attempts.filter(Boolean).length;
  assert.equal(granted, 1, "genau eine der 5 gleichzeitigen Reservierungen wird angenommen");
  assert.equal(store.reservationOf(T1), RESERVE_CENTS, "EINE Reserve gebucht, nicht 5x60");

  // Cleanup: Reserve wieder freigeben (Independence, kein Leak in andere Tests)
  store.releaseOutboundReserve({ tenantId: T1, reserveCents: RESERVE_CENTS, reserveReleased: false });
});

test("Freigabe + Wiederreservierung: freigegebene Reserve laesst neuen Grant zu", async () => {
  const T2 = "tenant_concurrency_2";
  await store.withStoreLock(() => store.tryReserveOutboundBudget(T2, RESERVE_CENTS, CFG));

  const call = { tenantId: T2, reserveCents: RESERVE_CENTS, reserveReleased: false };
  assert.equal(store.releaseOutboundReserve(call), true, "Freigabe wirkt");
  assert.equal(store.reservationOf(T2), 0, "Ledger nach Freigabe leer");
  assert.equal(call.reserveReleased, true, "Idempotenz-Schloss gesetzt");

  const grantedAgain = await store.withStoreLock(() =>
    store.tryReserveOutboundBudget(T2, RESERVE_CENTS, CFG),
  );
  assert.equal(grantedAgain, true, "nach Freigabe ist eine neue Reservierung wieder moeglich");

  // Cleanup
  store.releaseOutboundReserve({ tenantId: T2, reserveCents: RESERVE_CENTS, reserveReleased: false });
});

test("Idempotenz: eine zweite Freigabe desselben Calls ist ein No-Op (kein negativer Ledger)", async () => {
  const T3 = "tenant_concurrency_3";
  await store.withStoreLock(() => store.tryReserveOutboundBudget(T3, RESERVE_CENTS, CFG));

  const call = { tenantId: T3, reserveCents: RESERVE_CENTS, reserveReleased: false };
  assert.equal(store.releaseOutboundReserve(call), true, "erste Freigabe wirkt");
  assert.equal(store.releaseOutboundReserve(call), false, "zweite Freigabe ist No-Op");
  assert.equal(store.reservationOf(T3), 0, "kein doppelter Abzug, kein negativer Ledger");
});

test("Globale Achse: pro-Tenant frei, Summe reisst den globalen Notaus", async () => {
  const G1 = "tenant_concurrency_global_1";
  const G2 = "tenant_concurrency_global_2";

  const grantG1 = await store.withStoreLock(() =>
    store.tryReserveOutboundBudget(G1, RESERVE_CENTS, CFG),
  );
  assert.equal(grantG1, true, "G1 allein unter dem 1-EUR-Cap");

  const grantG2 = await store.withStoreLock(() =>
    store.tryReserveOutboundBudget(G2, RESERVE_CENTS, CFG),
  );
  assert.equal(
    grantG2,
    false,
    "G2 waere pro-Tenant frei (0.60 EUR < 1 EUR), aber Summe mit G1 (1.20 EUR) reisst den globalen Cap",
  );
  assert.equal(store.reservationOf(G2), 0, "abgelehnte Reserve bucht nichts");

  // Cleanup
  store.releaseOutboundReserve({ tenantId: G1, reserveCents: RESERVE_CENTS, reserveReleased: false });
});
