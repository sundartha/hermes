import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser, BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const KUNDE = "t_tsql_kunde";
const FREMD = "t_tsql_fremd";
const ZIEL = "+4915112349921";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) =>
  db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

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

const texteImSpeicher = (store, callId) => store.getCall(callId).transcript.map((zeile) => zeile.text);

async function zeilenInDatenbank(db, tenantId, callId) {
  await setzeKontext(db, tenantId);
  const { rows } = await db.query(`SELECT role, text FROM transcript_segment WHERE call_id = $1 ORDER BY id`, [callId]);
  return rows;
}

test("TRANSKRIPT-1: eine Zeile von Instanz A steht nach dem Warten in der Datenbank und ist bei Instanz B sichtbar", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Guten Tag");
  await a.addTranscript(call.id, "caller", "Hallo");
  assert.deepEqual(await zeilenInDatenbank(db, KUNDE, call.id), [
    { role: "agent", text: "Guten Tag" },
    { role: "caller", text: "Hallo" },
  ]);
  const angehaengt = await b.attachActiveCall(call.id);
  assert.deepEqual(
    angehaengt.transcript.map(({ role, text }) => ({ role, text })),
    [
      { role: "agent", text: "Guten Tag" },
      { role: "caller", text: "Hallo" },
    ],
  );
});

test("TRANSKRIPT-2: Mandant Fremd sieht die Zeilen nicht, auch wenn die Verbindung mit fremdem Kontext schreibt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await setzeKontext(db, FREMD);
  await a.addTranscript(call.id, "agent", "Vertraulich");
  assert.deepEqual(await zeilenInDatenbank(db, FREMD, call.id), []);
  assert.deepEqual(await zeilenInDatenbank(db, BOOTSTRAP_TENANT_ID, call.id), []);
  assert.deepEqual(await zeilenInDatenbank(db, KUNDE, call.id), [{ role: "agent", text: "Vertraulich" }]);
});

test("TRANSKRIPT-3: der Text wird wie bisher von Klammern bereinigt, und eine spaetere Sicherung schreibt keine Zeile doppelt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Hallo [laughs] Welt");
  await a.save();
  await a.drainFlushes();
  const zeilen = await zeilenInDatenbank(db, KUNDE, call.id);
  assert.equal(zeilen.length, 1);
  assert.deepEqual(texteImSpeicher(a, call.id), [zeilen[0].text]);
  assert.equal(zeilen[0].text, "Hallo Welt");
});

test("TRANSKRIPT-4: Loeschen leert die Datenbank auch fuer Zeilen, die eine andere Instanz geschrieben hat", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Eins");
  await b.attachActiveCall(call.id);
  await a.addTranscript(call.id, "caller", "Zwei");
  await b.purgeTranscript(call.id);
  assert.deepEqual(await zeilenInDatenbank(db, KUNDE, call.id), []);
  assert.deepEqual(b.getCall(call.id).transcript, []);
});

test("TRANSKRIPT-5: ein Schreibfehler wirft und laesst die Zeile weder im Speicher noch als unbekannten Anruf zurueck", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Bleibt");
  await db.exec("ALTER TABLE transcript_segment RENAME TO transcript_segment_versteckt");
  await assert.rejects(a.addTranscript(call.id, "caller", "Geht nicht"));
  assert.deepEqual(texteImSpeicher(a, call.id), ["Bleibt"]);
  await assert.rejects(a.purgeTranscript(call.id));
  assert.deepEqual(texteImSpeicher(a, call.id), ["Bleibt"]);
});

test("TRANSKRIPT-6: ein unbekannter Anruf wird still uebergangen wie bisher", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  await a.addTranscript("call_gibt_es_nicht", "agent", "x");
  await a.purgeTranscript("call_gibt_es_nicht");
});

test("TRANSKRIPT-7: die Zeile des Anrufers steht sofort im Anruf, auch wenn die Datenbank noch nicht bestaetigt hat", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  const schreiben = a.addTranscript(call.id, "caller", "Ich moechte Montag");
  assert.deepEqual(texteImSpeicher(a, call.id), ["Ich moechte Montag"]);
  await schreiben;
  assert.equal((await zeilenInDatenbank(db, KUNDE, call.id)).length, 1);
});

test("TRANSKRIPT-8: scheitert das Schreiben, verschwindet genau diese Zeile und der Fehler kommt an", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Vorher");
  const kaputt = a.addTranscript(call.id, "caller", `Kaputt${String.fromCharCode(0)}`);
  const gut = a.addTranscript(call.id, "caller", "Danach");
  await assert.rejects(kaputt);
  await gut;
  assert.deepEqual(texteImSpeicher(a, call.id), ["Vorher", "Danach"]);
  assert.deepEqual(
    (await zeilenInDatenbank(db, KUNDE, call.id)).map((zeile) => zeile.text),
    ["Vorher", "Danach"],
  );
});

async function zeileHinterWartenderSicherung(a, callId, text) {
  const sicherung = a.markAnswered(callId);
  const schreiben = a.addTranscript(callId, "caller", text);
  return { sicherung, schreiben };
}

test("TRANSKRIPT-9: eine schon wartende Sicherung schreibt die noch unbestaetigte Zeile nicht zusaetzlich", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  const { sicherung, schreiben } = await zeileHinterWartenderSicherung(a, call.id, "Guten Tag");
  await schreiben;
  await sicherung;
  await a.persistCall(call.id);
  assert.deepEqual(
    (await zeilenInDatenbank(db, KUNDE, call.id)).map((zeile) => zeile.text),
    ["Guten Tag"],
  );
});

test("TRANSKRIPT-10: scheitert das Schreiben hinter einer wartenden Sicherung, steht die Zeile weder im Anruf noch in der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  const { sicherung, schreiben } = await zeileHinterWartenderSicherung(a, call.id, `Kaputt${String.fromCharCode(0)}`);
  await assert.rejects(schreiben);
  await sicherung;
  await a.persistCall(call.id);
  assert.deepEqual(texteImSpeicher(a, call.id), []);
  assert.deepEqual(await zeilenInDatenbank(db, KUNDE, call.id), []);
});

test("TRANSKRIPT-11: eine Sicherung, die weniger Zeilen kennt als die Datenbank, kuerzt die Datenbank auf ihren Stand", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Eins");
  await b.attachActiveCall(call.id);
  await a.addTranscript(call.id, "caller", "Zwei");
  await b.save();
  await b.drainFlushes();
  assert.deepEqual(
    (await zeilenInDatenbank(db, KUNDE, call.id)).map((zeile) => zeile.text),
    ["Eins"],
  );
});

test("TRANSKRIPT-12: eine Sicherung ersetzt eine Zeile mit gleicher Rolle und anderem Text", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Eins");
  await b.attachActiveCall(call.id);
  await a.purgeTranscript(call.id);
  await a.addTranscript(call.id, "agent", "Neu");
  await b.save();
  await b.drainFlushes();
  assert.deepEqual(
    (await zeilenInDatenbank(db, KUNDE, call.id)).map((zeile) => zeile.text),
    ["Eins"],
  );
});

test("TRANSKRIPT-13: ein Anruf ohne Zeilen loescht in der Datenbank, ohne die Zeilen erst zu lesen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const abfragen = [];
  const aufzeichnung = {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          abfragen.push(text);
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
  await mitKunden(db);
  const a = makePgStore(aufzeichnung);
  await a.init();
  await legeAn(a);
  abfragen.length = 0;
  await a.save();
  await a.drainFlushes();
  assert.equal(abfragen.filter((text) => /^DELETE FROM transcript_segment WHERE tenant_id=\$1 AND call_id=\$2$/.test(text)).length, 1);
  assert.equal(abfragen.filter((text) => /^SELECT id, role, text FROM transcript_segment/.test(text)).length, 0);
});

test("TRANSKRIPT-14: eine Sicherung laesst die gemeinsamen Zeilen in der Datenbank unberuehrt und kuerzt nur den Rest", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Eins");
  await b.attachActiveCall(call.id);
  await a.addTranscript(call.id, "caller", "Zwei");
  await setzeKontext(db, KUNDE);
  const vorher = (await db.query(`SELECT id FROM transcript_segment WHERE call_id = $1 AND text = 'Eins'`, [call.id])).rows;
  await b.save();
  await b.drainFlushes();
  const nachher = (await db.query(`SELECT id FROM transcript_segment WHERE call_id = $1 ORDER BY id`, [call.id])).rows;
  assert.equal(vorher.length, 1);
  assert.deepEqual(nachher, vorher);
});

test("TRANSKRIPT-15: eine Sicherung ersetzt eine Zeile mit gleichem Text und anderer Rolle", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.addTranscript(call.id, "agent", "Eins");
  await b.attachActiveCall(call.id);
  await a.purgeTranscript(call.id);
  await a.addTranscript(call.id, "caller", "Eins");
  await b.save();
  await b.drainFlushes();
  assert.deepEqual(await zeilenInDatenbank(db, KUNDE, call.id), [{ role: "agent", text: "Eins" }]);
});
