import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_lsql_kunde";
const FREMD = "t_lsql_fremd";
const ZIEL = "+4915112349922";
const SPAETER = "2030-01-02T03:04:05.000Z";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function mitKunden(db) {
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  return neueInstanz(db);
}

async function legeAn(store) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await store.persistCall(call.id);
  return call;
}

async function zeile(db, tenantId, callId) {
  await setzeKontext(db, tenantId);
  const { rows } = await db.query(
    `SELECT status, answered_at, ended_at, answered_unclear_reason, consults FROM call WHERE id = $1`,
    [callId],
  );
  return rows[0];
}

test("LEBENSLAUF-1: markAnswered steht nach dem Warten in der Datenbank, nur einmal, und eine zweite Instanz sieht es", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  const ergebnis = await a.markAnswered(call.id);
  const erster = (await zeile(db, KUNDE, call.id)).answered_at;
  assert.equal(erster, ergebnis.answeredAt);
  assert.match(erster, /^\d{4}-\d\d-\d\dT/);
  await a.markAnswered(call.id);
  assert.equal((await zeile(db, KUNDE, call.id)).answered_at, erster);
  assert.equal((await b.attachActiveCall(call.id)).answeredAt, erster);
});

test("LEBENSLAUF-2: trueUpAnsweredAt ueberschreibt den Zeitpunkt in der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.markAnswered(call.id);
  const ergebnis = await a.trueUpAnsweredAt(call.id, SPAETER);
  assert.equal(ergebnis.answeredAt, SPAETER);
  assert.equal((await zeile(db, KUNDE, call.id)).answered_at, SPAETER);
});

test("LEBENSLAUF-3: recordAnsweredUnclearReason steht in der Datenbank und bleibt beim zweiten Aufruf beim ersten Wert", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.recordAnsweredUnclearReason(call.id, "stille");
  await a.recordAnsweredUnclearReason(call.id, "anderes");
  assert.equal((await zeile(db, KUNDE, call.id)).answered_unclear_reason, "stille");
});

test("LEBENSLAUF-4: endCallRecord schliesst einmal ab und laesst offene Rueckfragen verfallen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  a.getCall(call.id).consults = [{ id: "k1", status: "open" }];
  const ergebnis = await a.endCallRecord(call.id, "failed");
  assert.equal(ergebnis.status, "failed");
  const erste = await zeile(db, KUNDE, call.id);
  assert.equal(erste.status, "failed");
  assert.equal(erste.ended_at, ergebnis.endedAt);
  assert.equal(erste.consults[0].status, "expired");
  await a.endCallRecord(call.id, "completed");
  const zweite = await zeile(db, KUNDE, call.id);
  assert.equal(zweite.status, "failed");
  assert.equal(zweite.ended_at, erste.ended_at);
});

test("LEBENSLAUF-5: setCallEndedAt schreibt den genannten Endzeitpunkt, und ein Standardaufruf endet mit completed", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const eins = await legeAn(a);
  await a.setCallEndedAt(eins.id, "completed", SPAETER);
  assert.deepEqual(
    [(await zeile(db, KUNDE, eins.id)).status, (await zeile(db, KUNDE, eins.id)).ended_at],
    ["completed", SPAETER],
  );
  const zwei = await legeAn(a);
  await a.endCallRecord(zwei.id);
  assert.equal((await zeile(db, KUNDE, zwei.id)).status, "completed");
});

test("LEBENSLAUF-6: Mandant Fremd sieht die Zeile nicht, auch wenn die Verbindung mit fremdem Kontext schreibt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await setzeKontext(db, FREMD);
  await a.markAnswered(call.id);
  assert.equal(await zeile(db, FREMD, call.id), undefined);
  assert.notEqual((await zeile(db, KUNDE, call.id)).answered_at, null);
});

test("LEBENSLAUF-7: ein Schreibfehler wirft und laesst den Anruf unveraendert", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.markAnswered(call.id);
  const vorher = a.getCall(call.id).answeredAt;
  await db.exec("ALTER TABLE call RENAME TO call_versteckt");
  await assert.rejects(a.trueUpAnsweredAt(call.id, SPAETER));
  await assert.rejects(a.endCallRecord(call.id, "failed"));
  assert.equal(a.getCall(call.id).answeredAt, vorher);
  assert.equal(a.getCall(call.id).status, "active");
  assert.equal(a.getCall(call.id).endedAt ?? null, null);
});

test("LEBENSLAUF-8: ein unbekannter Anruf liefert wie bisher nichts und schreibt nichts", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  assert.equal(await a.markAnswered("call_unbekannt"), null);
  assert.equal(await a.trueUpAnsweredAt("call_unbekannt", SPAETER), null);
  assert.equal(await a.endCallRecord("call_unbekannt"), null);
});

test("LEBENSLAUF-9: eine Instanz mit altem Stand ueberschreibt weder Abheben, Grund noch Ende einer anderen Instanz", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await b.attachActiveCall(call.id);
  await a.markAnswered(call.id);
  await a.recordAnsweredUnclearReason(call.id, "erster");
  await a.endCallRecord(call.id, "completed");
  const erste = await zeile(db, KUNDE, call.id);
  await b.markAnswered(call.id);
  await b.recordAnsweredUnclearReason(call.id, "zweiter");
  await b.endCallRecord(call.id, "failed");
  const danach = await zeile(db, KUNDE, call.id);
  assert.deepEqual(
    [danach.answered_at, danach.answered_unclear_reason, danach.status, danach.ended_at],
    [erste.answered_at, "erster", "completed", erste.ended_at],
  );
});
