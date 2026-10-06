import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
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
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("Export enthaelt privateNumber; Erase entfernt sie (state-ops, Art. 15 <-> Art. 17)", () => {
  const s = makeDefaultState();
  setPrivateNumber(s, BOOTSTRAP_TENANT_ID, NUM);

  assert.equal(
    exportTenantData(s, BOOTSTRAP_TENANT_ID).privateNumber,
    NUM,
    "Export enthaelt die Nummer",
  );

  const removed = eraseTenantData(s, BOOTSTRAP_TENANT_ID);

  assert.equal(removed.privateNumber, 1, "Loesch-Zaehler meldet die entfernte Nummer (0/1)");
  assert.equal(
    exportTenantData(s, BOOTSTRAP_TENANT_ID).privateNumber,
    null,
    "Export nach Erase: keine Nummer",
  );
  assert.equal(
    "privateNumber" in findTenant(s, BOOTSTRAP_TENANT_ID),
    false,
    "tenant-Record ohne das Feld (entfernt, nicht null)",
  );
});

test("ohne gesetzte privateNumber: Export null, Erase-Zaehler 0 (kein Phantom-Loeschen)", () => {
  const s = makeDefaultState();
  assert.equal(
    exportTenantData(s, BOOTSTRAP_TENANT_ID).privateNumber,
    null,
    "kein Feld -> Export null",
  );
  assert.equal(
    eraseTenantData(s, BOOTSTRAP_TENANT_ID).privateNumber,
    0,
    "nichts zu loeschen -> Zaehler 0",
  );
});

test("AK4: Loesch-Zaehler ist PII-frei (Zahl, nicht der Nummern-Wert)", () => {
  const s = makeDefaultState();
  setPrivateNumber(s, BOOTSTRAP_TENANT_ID, NUM);
  const removed = eraseTenantData(s, BOOTSTRAP_TENANT_ID);
  assert.equal(typeof removed.privateNumber, "number", "Zaehler ist eine Zahl");
  assert.notEqual(removed.privateNumber, NUM, "Zaehler ist NICHT der Nummern-Wert");
  assert.equal(
    JSON.stringify(removed).includes(NUM),
    false,
    "der Nummern-Wert taucht nirgends im Zaehler auf",
  );
});

test("Erase persistiert ueber Restart, auch ohne Calls (pglite, save-Gate)", async () => {
  const db = new PGlite();
  const store = await reopen(db);
  store.setPrivateNumber(BOOTSTRAP_TENANT_ID, NUM);
  await store.save();

  assert.equal(
    (await reopen(db)).tenantPrivateNumber(BOOTSTRAP_TENANT_ID),
    NUM,
    "Nummer vor Erase persistiert",
  );

  const removed = store.eraseTenantData(BOOTSTRAP_TENANT_ID);
  assert.equal(removed.calls, 0, "Owner ohne Calls -> der alte save-Gate haette NICHT gespeichert");
  assert.equal(removed.privateNumber, 1, "privateNumber entfernt");
  await store.save();

  const reopened = await reopen(db);
  assert.equal(
    reopened.tenantPrivateNumber(BOOTSTRAP_TENANT_ID),
    null,
    "Nummer nach Erase weg (ueberlebt den Restart)",
  );
  assert.equal(
    reopened.exportTenantData(BOOTSTRAP_TENANT_ID).privateNumber,
    null,
    "Export nach Restart: keine Nummer",
  );
});

test("Erase ist tenant-scoped: fremde privateNumber bleibt unberuehrt", () => {
  const s = makeDefaultState();
  s.tenants.push({ id: "other", status: "active" });
  setPrivateNumber(s, BOOTSTRAP_TENANT_ID, NUM);
  setPrivateNumber(s, "other", "+491729998877");

  eraseTenantData(s, BOOTSTRAP_TENANT_ID);

  assert.equal(exportTenantData(s, BOOTSTRAP_TENANT_ID).privateNumber, null, "Owner-Nummer weg");
  assert.equal(exportTenantData(s, "other").privateNumber, "+491729998877", "fremde Nummer bleibt");
});
