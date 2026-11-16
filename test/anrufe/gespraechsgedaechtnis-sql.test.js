import assert from "node:assert/strict";
import { test } from "node:test";

import { MEMORY_MAX_CALLS } from "../../src/call-memory.ts";
import { makePgStore, makePgTestStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_gedaechtnis_kunde";
const FREMD = "t_gedaechtnis_fremd";
const ZIEL = "+4915112349955";
const ABSENDER = "+4930555000301";
const SELBST_GELESEN = "Termin am Montag";
const NUR_IM_SPIEGEL = "Nur im Spiegel";
const GEHEIMNIS = "Geheimnis des Fremden";
const START_BASIS = Date.parse("2026-01-01T10:00:00.000Z");
const MINUTE_MS = 60_000;

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

async function mitKunden(db, runner) {
  await neueInstanz(runner);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  const a = await neueInstanz(runner);
  a.updateSettings(KUNDE, { allowCallMemory: true });
  await a.save();
  return a;
}

async function legeBeendetenAnrufAn(store, tenantId, { outcome, minute = 0, facts = [], direction = "outbound", ziel = ZIEL }) {
  const call = store.createCall({ direction, from: ABSENDER, to: ziel, goal: "Test", tenantId });
  call.startedAt = new Date(START_BASIS + minute * MINUTE_MS).toISOString();
  await store.persistCall(call.id);
  call.result = { outcome, commitments: [], counterpartyCommitments: [], openPoints: [], nextStep: null, facts };
  await store.save();
  return call;
}

test("Gespraechsgedaechtnis: Instanz B zeigt die drei neuesten Ergebnisse von Anrufen, die Instanz A beendet hat", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitKunden(db, runner);
  const b = await neueInstanz(runner);
  for (let minute = 0; minute <= MEMORY_MAX_CALLS; minute += 1) {
    await legeBeendetenAnrufAn(a, KUNDE, { outcome: `Ergebnis ${minute}`, minute, facts: [`Fakt ${minute}`] });
  }
  assert.deepEqual(await b.counterpartyMemory(KUNDE, ZIEL), [
    { outcome: "Ergebnis 3", facts: ["Fakt 3"] },
    { outcome: "Ergebnis 2", facts: ["Fakt 2"] },
    { outcome: "Ergebnis 1", facts: ["Fakt 1"] },
  ]);
});

test("Gespraechsgedaechtnis: zeigt nichts von einem anderen Mandanten, auch wenn die Verbindung dessen Kontext traegt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitKunden(db, runner);
  const b = await neueInstanz(runner);
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN, minute: 1 });
  await legeBeendetenAnrufAn(a, FREMD, { outcome: GEHEIMNIS, minute: 2 });
  await setzeKontext(db, FREMD);
  assert.deepEqual(await b.counterpartyMemory(KUNDE, ZIEL), [{ outcome: SELBST_GELESEN, facts: [] }]);
});

test("Gespraechsgedaechtnis: filtert ausdruecklich nach dem Mandanten, auch wenn die Datenbankrolle die Mandantentrennung umgeht", async () => {
  const { db, runner, store: boot } = await makePgTestStore();
  await boot.save();
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  const a = await neueInstanz(runner);
  a.updateSettings(KUNDE, { allowCallMemory: true });
  await a.save();
  const b = await neueInstanz(runner);
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN, minute: 1 });
  await legeBeendetenAnrufAn(a, FREMD, { outcome: GEHEIMNIS, minute: 2 });
  assert.deepEqual(await b.counterpartyMemory(KUNDE, ZIEL), [{ outcome: SELBST_GELESEN, facts: [] }]);
});

test("Gespraechsgedaechtnis: ohne Freigabe des Mandanten bleibt es leer, auch wenn die Datenbank Ergebnisse hat", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitKunden(db, runner);
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN });
  a.updateSettings(KUNDE, { allowCallMemory: false });
  await a.save();
  const b = await neueInstanz(runner);
  assert.deepEqual(await b.counterpartyMemory(KUNDE, ZIEL), []);
  assert.deepEqual(await a.counterpartyMemory(KUNDE, null), []);
});

test("Gespraechsgedaechtnis: ein auf dieser Instanz noch nicht geschriebenes Ergebnis zaehlt einmal und ersetzt die Datenbankzeile", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitKunden(db, runner);
  const call = await legeBeendetenAnrufAn(a, KUNDE, { outcome: "Alt in der Datenbank", minute: 1 });
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN, minute: 0 });
  call.result = { outcome: NUR_IM_SPIEGEL, facts: [] };
  assert.deepEqual(await a.counterpartyMemory(KUNDE, ZIEL), [
    { outcome: NUR_IM_SPIEGEL, facts: [] },
    { outcome: SELBST_GELESEN, facts: [] },
  ]);
});

test("Gespraechsgedaechtnis: ein Lesefehler der Datenbank wird gemeldet und das Gedaechtnis kommt aus dem eigenen Stand", async (t) => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitKunden(db, runner);
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN });
  const meldung = t.mock.method(console, "error", () => {});
  await db.exec("ALTER TABLE call RENAME TO call_versteckt");
  const gedaechtnis = await a.counterpartyMemory(KUNDE, ZIEL);
  await db.exec("ALTER TABLE call_versteckt RENAME TO call");
  assert.deepEqual(gedaechtnis, [{ outcome: SELBST_GELESEN, facts: [] }]);
  const [aufruf] = meldung.mock.calls;
  assert.match(String(aufruf.arguments[0]), /^\[pg\] gedaechtnis lesen fehlgeschlagen:/);
});

test("Gespraechsgedaechtnis: Instanz B zeigt nur ausgehende Anrufe an dieselbe Nummer", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitKunden(db, runner);
  const b = await neueInstanz(runner);
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN, minute: 1 });
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: "Eingehend", minute: 2, direction: "inbound" });
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: "Andere Nummer", minute: 3, ziel: "+4915112349966" });
  assert.deepEqual(await b.counterpartyMemory(KUNDE, ZIEL), [{ outcome: SELBST_GELESEN, facts: [] }]);
});

test("Gespraechsgedaechtnis: der eigene Stand zeigt nur ausgehende Anrufe an dieselbe Nummer", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db, runnerFuer(db));
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: SELBST_GELESEN, minute: 1 });
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: "Eingehend", minute: 2, direction: "inbound" });
  await legeBeendetenAnrufAn(a, KUNDE, { outcome: "Andere Nummer", minute: 3, ziel: "+4915112349966" });
  assert.deepEqual(await a.counterpartyMemory(KUNDE, ZIEL), [{ outcome: SELBST_GELESEN, facts: [] }]);
});

test("Gespraechsgedaechtnis: ungeordnet angelegte Anrufe erscheinen mit den neuesten zuerst", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db, runnerFuer(db));
  for (const minute of [2, 0, 4, 1, 3]) {
    await legeBeendetenAnrufAn(a, KUNDE, { outcome: `Minute ${minute}`, minute });
  }
  assert.deepEqual(await a.counterpartyMemory(KUNDE, ZIEL), [
    { outcome: "Minute 4", facts: [] },
    { outcome: "Minute 3", facts: [] },
    { outcome: "Minute 2", facts: [] },
  ]);
  for (const minute of [0, 1, 2, 3]) {
    await legeBeendetenAnrufAn(a, KUNDE, { outcome: `Spaet ${minute}`, minute: 10 - minute });
  }
  assert.deepEqual(await a.counterpartyMemory(KUNDE, ZIEL), [
    { outcome: "Spaet 0", facts: [] },
    { outcome: "Spaet 1", facts: [] },
    { outcome: "Spaet 2", facts: [] },
  ]);
});

test("Gespraechsgedaechtnis: Anrufe mit gleicher Startzeit behalten ihre Reihenfolge", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db, runnerFuer(db));
  const anzahl = 80;
  for (let nr = 0; nr < anzahl; nr += 1) {
    await legeBeendetenAnrufAn(a, KUNDE, { outcome: `Gleich ${nr}`, minute: 0 });
  }
  assert.deepEqual(await a.counterpartyMemory(KUNDE, ZIEL), [
    { outcome: "Gleich 79", facts: [] },
    { outcome: "Gleich 78", facts: [] },
    { outcome: "Gleich 77", facts: [] },
  ]);
});
