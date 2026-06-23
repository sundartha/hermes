// F2 P10 - DSGVO Export/Erase fuer die private Summary-Nummer (privateNumber). Die
// Nummer ist ein personenbezogenes Kontaktdatum und muss daher (a) in der Auskunft
// (Art. 15/20, exportTenantData) erscheinen und (b) bei der Loeschung (Art. 17,
// eraseTenantData) MIT entfernt werden - spiegelbildlich, kein Export/Erase-Drift.
//
// Achsen, alle offline (reine state-ops-Funktionen + pglite, kein Netz) -> F.I.R.S.T.:
//   A) Export enthaelt die Nummer; nach Erase ist sie weg (Set -> Export -> Erase -> Export).
//   B) Audit/Zaehler ist PII-frei: removed.privateNumber ist 0/1, NIE der Nummern-Wert.
//   C) Persistenz (pglite): die Loeschung ueberlebt den Restart - AUCH fuer einen Tenant
//      GANZ OHNE Calls (der frueher den save()-Gate verfehlt haette -> Regressions-Anker).
//
// ISOLATION: pglite NIE mit einem Server-Spawn in einer Datei (P3/P6a-Lehre) - hier nur pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, OWNER_TENANT_ID } from "../src/store/pg.js";
import {
  makeDefaultState,
  createCall,
  setPrivateNumber,
  exportTenantData,
  eraseTenantData,
  findTenant,
} from "../src/store/state-ops.js";

const NUM = "+491701234567";

async function reopen(db) {
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// A) Set -> Export enthaelt die Nummer -> Erase -> Export hat sie nicht mehr; tenant-Record ohne Feld.
test("Export enthaelt privateNumber; Erase entfernt sie (state-ops, Art. 15 <-> Art. 17)", () => {
  const s = makeDefaultState();
  setPrivateNumber(s, OWNER_TENANT_ID, NUM);

  assert.equal(exportTenantData(s, OWNER_TENANT_ID).privateNumber, NUM, "Export enthaelt die Nummer");

  const removed = eraseTenantData(s, OWNER_TENANT_ID);

  assert.equal(removed.privateNumber, 1, "Loesch-Zaehler meldet die entfernte Nummer (0/1)");
  assert.equal(exportTenantData(s, OWNER_TENANT_ID).privateNumber, null, "Export nach Erase: keine Nummer");
  assert.equal("privateNumber" in findTenant(s, OWNER_TENANT_ID), false, "tenant-Record ohne das Feld (entfernt, nicht null)");
});

// Kein gesetzter Wert -> Export null, Erase ist ein No-op fuer das Feld (Zaehler 0).
test("ohne gesetzte privateNumber: Export null, Erase-Zaehler 0 (kein Phantom-Loeschen)", () => {
  const s = makeDefaultState();
  assert.equal(exportTenantData(s, OWNER_TENANT_ID).privateNumber, null, "kein Feld -> Export null");
  assert.equal(eraseTenantData(s, OWNER_TENANT_ID).privateNumber, 0, "nichts zu loeschen -> Zaehler 0");
});

// B) AK4: der Audit-/Loesch-Zaehler traegt NIE den PII-Wert, nur die Anzahl (0/1).
test("AK4: Loesch-Zaehler ist PII-frei (Zahl, nicht der Nummern-Wert)", () => {
  const s = makeDefaultState();
  setPrivateNumber(s, OWNER_TENANT_ID, NUM);
  const removed = eraseTenantData(s, OWNER_TENANT_ID);
  assert.equal(typeof removed.privateNumber, "number", "Zaehler ist eine Zahl");
  assert.notEqual(removed.privateNumber, NUM, "Zaehler ist NICHT der Nummern-Wert");
  assert.equal(JSON.stringify(removed).includes(NUM), false, "der Nummern-Wert taucht nirgends im Zaehler auf");
});

// C) Persistenz-Regressions-Anker (pglite): Tenant GANZ OHNE Calls. Die Erase muss trotzdem
// persistieren (save-Gate beruecksichtigt removed.privateNumber) - sonst kaeme die Nummer
// nach dem Restart zurueck. Owner hat hier keine Calls -> removed.calls===0.
test("Erase persistiert ueber Restart, auch ohne Calls (pglite, save-Gate)", async () => {
  const db = new PGlite();
  const store = await reopen(db);
  store.setPrivateNumber(OWNER_TENANT_ID, NUM);
  await store.save();

  // Re-Hydrierung belegt: die Nummer ist real persistiert (nicht nur in-memory).
  assert.equal((await reopen(db)).tenantPrivateNumber(OWNER_TENANT_ID), NUM, "Nummer vor Erase persistiert");

  const removed = store.eraseTenantData(OWNER_TENANT_ID);
  assert.equal(removed.calls, 0, "Owner ohne Calls -> der alte save-Gate haette NICHT gespeichert");
  assert.equal(removed.privateNumber, 1, "privateNumber entfernt");
  await store.save();

  const reopened = await reopen(db);
  assert.equal(reopened.tenantPrivateNumber(OWNER_TENANT_ID), null, "Nummer nach Erase weg (ueberlebt den Restart)");
  assert.equal(reopened.exportTenantData(OWNER_TENANT_ID).privateNumber, null, "Export nach Restart: keine Nummer");
});

// Cross-Tenant-Dichtheit: Erase(owner) laesst die privateNumber eines FREMDEN Tenants intakt.
test("Erase ist tenant-scoped: fremde privateNumber bleibt unberuehrt", () => {
  const s = makeDefaultState();
  s.tenants.push({ id: "other", status: "active" });
  setPrivateNumber(s, OWNER_TENANT_ID, NUM);
  setPrivateNumber(s, "other", "+491729998877");

  eraseTenantData(s, OWNER_TENANT_ID);

  assert.equal(exportTenantData(s, OWNER_TENANT_ID).privateNumber, null, "Owner-Nummer weg");
  assert.equal(exportTenantData(s, "other").privateNumber, "+491729998877", "fremde Nummer bleibt");
});
