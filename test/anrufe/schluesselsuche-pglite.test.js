import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_schl_kunde";
const FREMD = "t_schl_fremd";
const ZIEL = "+4915112349933";
const SID = "CA_schluessel_0001";
const NEUE_SID = "CA_schluessel_0002";
const NACH_TOKEN = { schluessel: "streamToken" };
const NACH_SID = { schluessel: "twilioSid" };

const sha256 = (wert) => createHash("sha256").update(wert).digest("hex");

const runnerFuer = (db, mitschnitt = []) => ({
  withClient: (fn) =>
    fn({
      query: (text, params) => {
        mitschnitt.push({ text, params });
        return db.query(text, params);
      },
      exec: (sql) => db.exec(sql),
    }),
});

const setzeKontext = (db, tenantId) =>
  db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db, mitschnitt) {
  const store = makePgStore(runnerFuer(db, mitschnitt));
  await store.init();
  return store;
}

async function mitMandanten(db) {
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
}

async function legeAn(store, tenantId, extra = {}) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000301", to: ZIEL, goal: "Test", tenantId, ...extra });
  await store.persistCall(call.id);
  return call;
}

async function schluesselZeilen(db, tenantId) {
  await setzeKontext(db, tenantId);
  const { rows } = await db.query(`SELECT art, wert_hash, call_id, tenant_id FROM anruf_schluessel ORDER BY art`);
  return rows;
}

test("SCHLUESSEL-1: ein Anruf von Instanz A wird bei Instanz B ueber Stream-Token und Anbieter-Kennung gefunden", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [a, b, c] = [await neueInstanz(db), await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(a, KUNDE, { twilioSid: SID });
  const nachToken = await b.attachActiveCall(call.streamToken, NACH_TOKEN);
  assert.equal(nachToken.id, call.id);
  assert.equal(nachToken.tenantId, KUNDE);
  const nachSid = await c.attachActiveCall(SID, NACH_SID);
  assert.equal(nachSid.id, call.id);
  assert.equal(nachSid.streamToken, call.streamToken);
  assert.equal(c.getCall(call.id).id, call.id);
});

test("SCHLUESSEL-2: die Suche setzt den Mandanten-Kontext genau einmal und geht nicht alle Mandanten durch", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const mitschnitt = [];
  const [a, b] = [await neueInstanz(db), await neueInstanz(db, mitschnitt)];
  const call = await legeAn(a, FREMD);
  mitschnitt.length = 0;
  await b.attachActiveCall(call.streamToken, NACH_TOKEN);
  const kontexte = mitschnitt.filter((eintrag) => eintrag.text.includes("set_config")).map((eintrag) => eintrag.params);
  assert.deepEqual(kontexte, [[FREMD]]);
});

test("SCHLUESSEL-3: die Schluesseltabelle haelt nur Pruefsummen und nennt Token und Kennung nie im Klartext", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const a = await neueInstanz(db);
  const call = await legeAn(a, KUNDE, { twilioSid: SID });
  const zeilen = await schluesselZeilen(db, KUNDE);
  assert.deepEqual(zeilen, [
    { art: "stream_token", wert_hash: sha256(call.streamToken), call_id: call.id, tenant_id: KUNDE },
    { art: "twilio_sid", wert_hash: sha256(SID), call_id: call.id, tenant_id: KUNDE },
  ]);
  const text = JSON.stringify(zeilen);
  assert.equal(text.includes(call.streamToken), false);
  assert.equal(text.includes(SID), false);
});

test("SCHLUESSEL-4: ein Schluesseleintrag, der auf einen fremden Mandanten zeigt, findet den Anruf nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [a, b] = [await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(a, FREMD);
  await db.query(`UPDATE anruf_schluessel SET tenant_id = $1 WHERE call_id = $2`, [KUNDE, call.id]);
  assert.equal(await b.attachActiveCall(call.streamToken, NACH_TOKEN), null);
  assert.equal(b.getCall(call.id), null);
});

test("SCHLUESSEL-5: ein beendeter Anruf und ein unbekannter Schluessel liefern null", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [a, b] = [await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(a, KUNDE, { twilioSid: SID });
  a.endCallRecord(call.id, "completed");
  await a.save();
  await a.drainFlushes();
  assert.equal(await b.attachActiveCall(call.streamToken, NACH_TOKEN), null);
  assert.equal(await b.attachActiveCall(SID, NACH_SID), null);
  assert.equal(await b.attachActiveCall("gibt-es-nicht", NACH_TOKEN), null);
});

test("SCHLUESSEL-6: ein Lesefehler der Datenbank wirft und gilt nie als nicht gefunden", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [a, b] = [await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(a, KUNDE);
  await db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");
  const fehlerlog = mock.method(console, "error", () => {});
  await assert.rejects(b.attachActiveCall(call.streamToken, NACH_TOKEN), /anruf_schluessel/);
  fehlerlog.mock.restore();
  const { calls } = fehlerlog.mock;
  const [meldung] = calls[0].arguments;
  assert.match(meldung, /^\[pg\] attachActiveCall nach Schluessel fehlgeschlagen:$/);
  assert.equal(b.getCall(call.id), null);
});

test("SCHLUESSEL-7: eine spaeter gesetzte Anbieter-Kennung wird gefunden, die alte nicht mehr", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [a, ohne, neu, alt, aktuell] = [0, 1, 2, 3, 4].map(() => neueInstanz(db));
  const [anlegen, vorher, danach, spaeter, jetzt] = await Promise.all([a, ohne, neu, alt, aktuell]);
  const call = await legeAn(anlegen, KUNDE);
  assert.equal(await vorher.attachActiveCall(SID, NACH_SID), null);
  assert.equal((await schluesselZeilen(db, KUNDE)).length, 1);
  call.twilioSid = SID;
  anlegen.save();
  await anlegen.drainFlushes();
  assert.equal((await danach.attachActiveCall(SID, NACH_SID)).id, call.id);
  call.twilioSid = NEUE_SID;
  anlegen.save();
  await anlegen.drainFlushes();
  assert.equal(await spaeter.attachActiveCall(SID, NACH_SID), null);
  assert.equal((await jetzt.attachActiveCall(NEUE_SID, NACH_SID)).id, call.id);
  assert.equal((await schluesselZeilen(db, KUNDE)).length, 2);
});

test("SCHLUESSEL-8: mit dem Anruf verschwinden seine Schluessel", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const a = await neueInstanz(db);
  const call = await legeAn(a, KUNDE, { twilioSid: SID });
  assert.equal((await schluesselZeilen(db, KUNDE)).length, 2);
  await db.query(`DELETE FROM call WHERE id = $1`, [call.id]);
  assert.deepEqual(await schluesselZeilen(db, KUNDE), []);
});

test("SCHLUESSEL-9: ohne Schluesselart sucht attachActiveCall weiter nach der Anruf-ID", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const a = await neueInstanz(db);
  const call = await legeAn(a, KUNDE);
  const b = await neueInstanz(db);
  assert.equal((await b.attachActiveCall(call.id)).id, call.id);
  assert.equal(await b.attachActiveCall("call_gibt_es_nicht"), null);
});

test("SCHLUESSEL-10: der JSON-Speicher findet einen laufenden Anruf nach Stream-Token und Anbieter-Kennung, einen beendeten nicht", async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-schluessel-"));
  await import("../../src/config.ts");
  const store = await import("../../src/store.js");
  const call = store.createCall({ direction: "outbound", from: "+4930123456", to: ZIEL, tenantId: KUNDE, twilioSid: SID });
  assert.equal((await store.attachActiveCall(call.streamToken, NACH_TOKEN)).id, call.id);
  assert.equal((await store.attachActiveCall(SID, NACH_SID)).id, call.id);
  assert.equal(await store.attachActiveCall("gibt-es-nicht", NACH_TOKEN), null);
  store.endCallRecord(call.id, "completed");
  assert.equal(await store.attachActiveCall(call.streamToken, NACH_TOKEN), null);
  assert.equal((await store.attachActiveCall(call.id)).id, call.id);
});

test("SCHLUESSEL-11: zwei gleichzeitige Suchen nach demselben Anruf liefern denselben Eintrag", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const a = await neueInstanz(db);
  const call = await legeAn(a, KUNDE, { twilioSid: SID });
  const b = await neueInstanz(db);
  const [ersteSuche, zweiteSuche] = await Promise.all([
    b.attachActiveCall(call.streamToken, NACH_TOKEN),
    b.attachActiveCall(SID, NACH_SID),
  ]);
  assert.equal(ersteSuche, zweiteSuche);
});
