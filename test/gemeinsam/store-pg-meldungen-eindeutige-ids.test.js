import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../../src/store/pg.js";
import { makePgTestStore } from "../pg-helpers.js";

const FESTER_ZUFALL = 0.123456789;
const FESTE_UHRZEIT_MS = 1_700_000_000_000;
const ANDERE_UHRZEIT_MS = 1_800_000_000_000;
const ANZAHL_MELDUNGEN = 55;
const ERWARTET_BEHALTEN = 50;

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

function meldungenInGleicherMillisekunde(t, store, uhrzeit) {
  t.mock.method(Math, "random", () => FESTER_ZUFALL);
  t.mock.method(Date, "now", () => uhrzeit);
  for (let i = 0; i < ANZAHL_MELDUNGEN; i++) store.addNotification(`t${i}`, `b${i}`, null);
  t.mock.restoreAll();
}

test("55 Meldungen in derselben Millisekunde mit gleichem Zufall bleiben nach dem Neuöffnen 50, neueste zuerst", async (t) => {
  const { store, db } = await makePgTestStore();
  meldungenInGleicherMillisekunde(t, store, FESTE_UHRZEIT_MS);
  await store.save();
  const reopened = await reopen(db);
  const meldungen = reopened.load().notifications;
  assert.equal(meldungen.length, ERWARTET_BEHALTEN);
  assert.equal(meldungen[0].title, "t54");
  assert.equal(new Set(meldungen.map((m) => m.id)).size, ERWARTET_BEHALTEN);
});

test("nach einer Millisekunde ist die ID wieder die ohne Zähler", async (t) => {
  const { store } = await makePgTestStore();
  const ZUFALLSSTELLEN = FESTER_ZUFALL.toString(36).slice(2, 6);
  const ZEITSTELLEN = (ANDERE_UHRZEIT_MS + 1).toString(36);
  let uhrzeit = ANDERE_UHRZEIT_MS;
  t.mock.method(Math, "random", () => FESTER_ZUFALL);
  t.mock.method(Date, "now", () => uhrzeit);
  store.addNotification("a", "a", null);
  store.addNotification("b", "b", null);
  uhrzeit += 1;
  store.addNotification("c", "c", null);
  uhrzeit = ANDERE_UHRZEIT_MS;
  store.addNotification("d", "d", null);
  const [d, c, b, a] = store.load().notifications;
  assert.ok(c.id.endsWith(`${ZEITSTELLEN}${ZUFALLSSTELLEN}`));
  assert.notEqual(a.id, b.id);
  assert.ok(b.id.startsWith(a.id));
  assert.equal(b.id, `${a.id}0`);
  assert.equal(d.id, a.id);
});
