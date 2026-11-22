import assert from "node:assert/strict";
import { test } from "node:test";

import { bindPlatformNumber, unbindPlatformNumber } from "../../src/store/state-ops.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const E164 = "+15005550006";
const ZWEITE = "+15005550007";
const ABFRAGE = "SELECT e164, purpose, released_at IS NULL AS offen FROM platform_number_use ORDER BY e164";

const runnerFuer = (db) => ({
  withClient: (arbeit) => arbeit({ query: (text, werte) => db.query(text, werte), exec: (sql) => db.exec(sql) }),
});

async function neueInstanz(db) {
  const store = makePgStoreMitSperre(runnerFuer(db));
  await store.init();
  return store;
}

const binden = (store, e164) => bindPlatformNumber(store.load(), { e164, purpose: "outbound_ani", provider: "telnyx" });

async function flushen(store) {
  store.save();
  await store.drainFlushes();
}

test("Eine Instanz mit veralteter Kopie loescht beim Flush die Bindung der anderen nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  assert.deepEqual(b.load().platformNumberUse, []);
  binden(a, E164);
  await flushen(a);
  assert.deepEqual((await db.query(ABFRAGE)).rows, [{ e164: E164, purpose: "outbound_ani", offen: true }]);
  await flushen(b);
  assert.deepEqual((await db.query(ABFRAGE)).rows, [{ e164: E164, purpose: "outbound_ani", offen: true }]);
});

test("Eine neue Bindung und das Schliessen einer Bindung schreibt der Flush weiter", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  binden(a, E164);
  binden(a, ZWEITE);
  await flushen(a);
  assert.deepEqual((await db.query(ABFRAGE)).rows.map((zeile) => zeile.offen), [true, true]);
  unbindPlatformNumber(a.load(), { e164: E164, purpose: "outbound_ani" });
  await flushen(a);
  assert.deepEqual((await db.query(ABFRAGE)).rows.map((zeile) => [zeile.e164, zeile.offen]), [[E164, false], [ZWEITE, true]]);
});
