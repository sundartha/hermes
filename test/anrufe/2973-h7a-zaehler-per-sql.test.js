import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_h7a_kunde";
const FREMD = "t_h7a_fremd";
const ZIEL = "+4915112349977";
const ABSENDER = "+4930555000377";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function zweiInstanzen() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  return { db, a, b };
}

const anruf = (store, tenantId = KUNDE) =>
  store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId, provider: "telnyx" });

async function angelegt(store, tenantId = KUNDE) {
  const call = anruf(store, tenantId);
  await store.persistCall(call.id);
  return call;
}

async function zeile(db, tenantId, id) {
  await setzeKontext(db, tenantId);
  const { rows } = await db.query(
    "SELECT no_speech_streak, lookups, consult_polled_at_ms FROM call WHERE id = $1",
    [id],
  );
  return {
    stille: Number(rows[0].no_speech_streak),
    recherchen: Number(rows[0].lookups),
    abfrage: Number(rows[0].consult_polled_at_ms),
  };
}

const meldungen = [];

async function ohneLog(fn) {
  const original = console.error;
  meldungen.length = 0;
  console.error = (...teile) => meldungen.push(teile[0]);
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

test("H7a-1: Instanz B sieht den Stille-Zaehler von A und zaehlt dort weiter", async () => {
  const { db, a, b } = await zweiInstanzen();
  const call = await angelegt(a);
  assert.equal(await a.countNoSpeechTurn(call.id), 1);
  assert.equal(await a.countNoSpeechTurn(call.id), 2);
  assert.equal((await b.leseCallUngebunden(call.id)).noSpeechStreak, 2);
  assert.equal(await b.countNoSpeechTurn(call.id), 3);
  assert.equal((await zeile(db, KUNDE, call.id)).stille, 3);
  assert.equal(await a.countNoSpeechTurn(call.id), 4);
});

test("H7a-2: clearNoSpeechStreak auf B setzt den Zaehler von A in der Datenbank zurueck", async () => {
  const { db, a, b } = await zweiInstanzen();
  const call = await angelegt(a);
  await a.countNoSpeechTurn(call.id);
  await b.clearNoSpeechStreak(call.id);
  assert.equal((await zeile(db, KUNDE, call.id)).stille, 0);
  assert.equal(await a.countNoSpeechTurn(call.id), 1);
  await a.clearNoSpeechStreak(call.id);
  assert.equal(a.getCall(call.id).noSpeechStreak, 0);
  assert.equal((await zeile(db, KUNDE, call.id)).stille, 0);
});

test("H7a-3: Recherche-Zaehler zaehlt ueber beide Instanzen in einer Reihe", async () => {
  const { db, a, b } = await zweiInstanzen();
  const call = await angelegt(a);
  assert.equal(await a.countCallLookup(call.id), 1);
  assert.equal(await b.countCallLookup(call.id), 2);
  assert.equal(await a.countCallLookup(call.id), 3);
  assert.equal(a.getCall(call.id).lookups, 3);
  assert.equal((await zeile(db, KUNDE, call.id)).recherchen, 3);
});

test("H7a-4: die Rueckfrage-Abfrage von A steht fuer B in consultPolledAtMs", async () => {
  const { db, a, b } = await zweiInstanzen();
  const call = await angelegt(a);
  const vorher = Date.now();
  await a.noteConsultPoll(call.id);
  const nachher = Date.now();
  const gelesen = (await b.leseCallUngebunden(call.id)).consultPolledAtMs;
  assert.ok(gelesen >= vorher && gelesen <= nachher, String(gelesen));
  assert.equal((await zeile(db, KUNDE, call.id)).abfrage, a.getCall(call.id).consultPolledAtMs);
});

test("H7a-5: ein Lesefehler beim Zaehlen wirft und zaehlt nichts, nie 0 oder 'nicht gefunden'", async () => {
  const { db, a, b } = await zweiInstanzen();
  const call = await angelegt(a);
  await a.countNoSpeechTurn(call.id);
  await db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");
  await ohneLog(async () => {
    await assert.rejects(b.countNoSpeechTurn(call.id));
    await assert.rejects(b.countCallLookup(call.id));
    await assert.rejects(b.clearNoSpeechStreak(call.id));
  });
  await db.exec("ALTER TABLE anruf_schluessel_versteckt RENAME TO anruf_schluessel");
  assert.deepEqual(await zeile(db, KUNDE, call.id), { stille: 1, recherchen: 0, abfrage: 0 });
});

test("H7a-6: scheitert der Schreibvorgang auf der Zeile, bleibt der Spiegel unveraendert und der Aufruf wirft", async () => {
  const { db, a } = await zweiInstanzen();
  const call = await angelegt(a);
  await a.countNoSpeechTurn(call.id);
  await db.exec("ALTER TABLE call RENAME COLUMN no_speech_streak TO no_speech_streak_weg");
  await ohneLog(() => assert.rejects(a.countNoSpeechTurn(call.id)));
  assert.equal(a.getCall(call.id).noSpeechStreak, 1);
});

test("H7a-7: ein Fehler beim Notieren der Abfrage wirft nicht und der Spiegel bleibt gesetzt", async () => {
  const { db, a } = await zweiInstanzen();
  const call = await angelegt(a);
  await db.exec("ALTER TABLE call RENAME COLUMN consult_polled_at_ms TO consult_polled_at_ms_weg");
  await ohneLog(() => a.noteConsultPoll(call.id));
  assert.ok(a.getCall(call.id).consultPolledAtMs > 0);
  assert.deepEqual(meldungen, ["[pg] Rueckfrage-Abfrage notieren fehlgeschlagen:"]);
});

test("H7a-8: ein unbekannter Anruf zaehlt 0 und schreibt nichts", async () => {
  const { a } = await zweiInstanzen();
  await ohneLog(async () => {
    assert.equal(await a.countNoSpeechTurn("call_unbekannt_h7a"), 0);
    assert.equal(await a.countCallLookup("call_unbekannt_h7a"), 0);
    await a.noteConsultPoll("call_unbekannt_h7a");
    await a.clearNoSpeechStreak("call_unbekannt_h7a");
  });
  assert.deepEqual(meldungen, []);
});

test("H7a-9: Anruf noch nicht in der Datenbank: der Spiegel zaehlt und das Speichern nimmt den Stand in die Zeile mit", async () => {
  const { db, a } = await zweiInstanzen();
  const call = anruf(a);
  assert.equal(await a.countNoSpeechTurn(call.id), 1);
  assert.equal(await a.countCallLookup(call.id), 1);
  await a.noteConsultPoll(call.id);
  await a.save();
  assert.deepEqual(await zeile(db, KUNDE, call.id), {
    stille: 1,
    recherchen: 1,
    abfrage: a.getCall(call.id).consultPolledAtMs,
  });
});

test("H7a-10: das Speichern von A ueberschreibt die Zaehler, die B inzwischen gesetzt hat, nicht", async () => {
  const { db, a, b } = await zweiInstanzen();
  const call = await angelegt(a);
  await b.countNoSpeechTurn(call.id);
  await b.countCallLookup(call.id);
  await a.save();
  const stand = await zeile(db, KUNDE, call.id);
  assert.equal(stand.stille, 1);
  assert.equal(stand.recherchen, 1);
});

test("H7a-11: ein Zaehler eines Mandanten beruehrt den Anruf eines anderen nicht", async () => {
  const { db, a } = await zweiInstanzen();
  const eigener = await angelegt(a, KUNDE);
  const fremder = await angelegt(a, FREMD);
  await a.countNoSpeechTurn(eigener.id);
  await a.countCallLookup(eigener.id);
  assert.deepEqual(await zeile(db, FREMD, fremder.id), { stille: 0, recherchen: 0, abfrage: 0 });
  assert.equal(a.getCall(fremder.id).noSpeechStreak, 0);
});

test("H7a-12: eine neue Zeile steht mit allen drei Zaehlern auf 0", async () => {
  const { db, a } = await zweiInstanzen();
  const call = await angelegt(a);
  assert.deepEqual(await zeile(db, KUNDE, call.id), { stille: 0, recherchen: 0, abfrage: 0 });
});
