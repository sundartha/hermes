// Owner-Bestandsnummer-Seed in BEIDEN Backends. Seit "Owner = Tenant Null" kommt die
// Owner-Nummer NICHT mehr aus der config/migrate, sondern ueber seedOwnerNumber (CLI-
// Pfad, state-ops + Fassade). Verhindert "Nummer gesetzt, routet aber nicht": die
// Telnyx-Owner-Nummer landet idempotent + normalisiert in der number-Tabelle
// (provider=telnyx), routbar via findTenantByNumber. Offline (state-ops + pglite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, seedOwnerNumber, findTenantByNumber } from "../src/store/state-ops.js";
import { findActiveNumber } from "../src/store/views.js";
import { OWNER_TENANT_ID, PROVIDER } from "../src/store/defaults.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import { PGlite } from "@electric-sql/pglite";

const TELNYX_NR = "+13125550100";

// ---- json-Pfad (state-ops, der json-load() identisch nutzt) ----
test("json: gesetzte Telnyx-Nummer -> routbar, provider=telnyx", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(findTenantByNumber(s, TELNYX_NR), OWNER_TENANT_ID);
  assert.equal(s.numbers.find((n) => n.e164 === TELNYX_NR).provider, PROVIDER.TELNYX);
});

test("json: leere Telnyx-Nummer -> kein Seed (fail-closed)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, "", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.length, 0);
});

test("json: bestehende e164 gewinnt (idempotent, kein Duplikat)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  seedOwnerNumber(s, TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.filter((n) => n.e164 === TELNYX_NR).length, 1);
});

// TD-2: config-Nummer mit Trennzeichen (Whitespace/Bindestrich) wird normalisiert
// gespeichert, damit der normalisierte Inbound-To-Lookup (findTenantByNumber) sie
// trifft - sonst routet sie nicht (defense-in-depth, fail-closed).
test("json: Nummer mit Trennzeichen wird normalisiert -> routbar (TD-2)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, "+49 151-1234 567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers[0].e164, "+491511234567", "gespeicherte Form ist normalisiert");
  assert.equal(findTenantByNumber(s, "+491511234567"), OWNER_TENANT_ID);
});

test("json: Trennzeichen- und Klar-Form derselben Nummer -> 1 Zeile (Idempotenz, TD-2)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, "+49 151-1234 567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  seedOwnerNumber(s, "+491511234567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.length, 1, "Idempotenz-Check laeuft gegen die normalisierte Form");
});

// ---- pg-Pfad: Owner-Nummer ueber die Fassade -> persistiert + re-hydrierbar ----
// Eine frische Store-Instanz auf DERSELBEN DB beweist, dass save()->flushNumbers die
// Nummer durablt und die Re-Hydrierung sie mit provider=telnyx zurueckliefert.
function pgStoreOn(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  return makePgStore(runner);
}

test("pg: ueber die Fassade geseedete Telnyx-Nummer ueberlebt Re-Hydrierung, provider=telnyx", async () => {
  const db = new PGlite();
  const store1 = pgStoreOn(db);
  await store1.init();
  store1.seedOwnerNumber(TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  await store1.save();
  // Frische Instanz auf derselben DB -> hydriert aus der number-Tabelle.
  const store2 = pgStoreOn(db);
  await store2.init();
  const num = findActiveNumber(store2.load(), OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.ok(num, "Telnyx-Nummer nach Re-Hydrierung vorhanden");
  assert.equal(num.e164, TELNYX_NR);
  assert.equal(num.provider, PROVIDER.TELNYX);
});

test("pg: frischer Store ohne Seed -> keine Telnyx-Nummer (fail-closed)", async () => {
  const { db } = await makePgTestStore();
  const rows = (await db.query(`SELECT e164 FROM number WHERE provider = $1`, [PROVIDER.TELNYX]))
    .rows;
  assert.equal(rows.length, 0, "ohne Seed kein Telnyx-Eintrag");
});

// TD-2 (pg-Seite): identisch zur json-Seite - eine Nummer mit Trennzeichen landet
// normalisiert in der number-Tabelle (eine Norm-Quelle, beide Backends).
test("pg: Nummer mit Trennzeichen wird normalisiert geseedet (TD-2)", async () => {
  const db = new PGlite();
  const store = pgStoreOn(db);
  await store.init();
  store.seedOwnerNumber("+49 151-1234 567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  await store.save();
  const rows = (await db.query(`SELECT e164 FROM number WHERE e164 = $1`, ["+491511234567"])).rows;
  assert.equal(rows.length, 1, "normalisierte Form gespeichert (routbar)");
});
