import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_auf_kunde";
const FREMD = "t_auf_fremd";
const TAG_MS = 24 * 3600 * 1000;
const vorTagen = (tage) => new Date(Date.now() - tage * TAG_MS).toISOString();

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

function runnerFuer(db, vorQuery = () => {}) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          vorQuery(text);
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function aufbau(vorQuery) {
  const db = await pgliteAlsRolleOhneSuperuser();
  const roh = makePgStore(runnerFuer(db));
  await roh.init();
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  const store = makePgStore(runnerFuer(db, vorQuery));
  await store.init();
  return { store, db };
}

async function anrufEinfuegen(db, { tenantId, id, status = "ended", endedAt = null, diagnostic = false, result = null, texte = [] }) {
  await setzeKontext(db, tenantId);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, ended_at, diagnostic, result)
     VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8)`,
    [id, tenantId, `tok_${id}`, status, vorTagen(60), endedAt, diagnostic, result && JSON.stringify(result)],
  );
  for (const text of texte) {
    await db.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,'caller',$3,now()::text)`,
      [id, tenantId, text],
    );
  }
}

async function zeilen(db, tenantId, sql) {
  await setzeKontext(db, tenantId);
  return (await db.query(sql)).rows;
}

const idsDerAnrufe = async (db, tenantId) =>
  (await zeilen(db, tenantId, `SELECT id FROM call ORDER BY id`)).map((zeile) => zeile.id);

test("Fristen: abgelaufene beendete Anrufe aller Mandanten verschwinden aus der Datenbank, auch ohne Spiegel, aktive und frische bleiben", async () => {
  const { store, db } = await aufbau();
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "alt_kunde", endedAt: vorTagen(40), texte: ["a", "b"] });
  await anrufEinfuegen(db, { tenantId: FREMD, id: "alt_fremd", endedAt: vorTagen(40) });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "frisch", endedAt: vorTagen(5) });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "aktiv_alt", status: "active", endedAt: vorTagen(40) });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "ohne_ende" });

  const removed = await store.pruneOldData(30, 7, 7);

  assert.equal(removed.calls, 2);
  assert.deepEqual(await idsDerAnrufe(db, KUNDE), ["aktiv_alt", "frisch", "ohne_ende"]);
  assert.deepEqual(await idsDerAnrufe(db, FREMD), []);
  assert.equal((await zeilen(db, KUNDE, `SELECT 1 FROM transcript_segment`)).length, 0);
});

test("Fristen: Frist 0 loescht keine Anrufe", async () => {
  const { store, db } = await aufbau();
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "alt", endedAt: vorTagen(400) });
  const removed = await store.pruneOldData(0, 7, 7);
  assert.equal(removed.calls, 0);
  assert.deepEqual(await idsDerAnrufe(db, KUNDE), ["alt"]);
});

test("Fristen: Diagnose-Transkripte abgelaufener Diagnose-Anrufe werden geloescht, der Anruf und andere Transkripte bleiben", async () => {
  const { store, db } = await aufbau();
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "diag_alt", diagnostic: true, endedAt: vorTagen(10), texte: ["x", "y"] });
  await anrufEinfuegen(db, { tenantId: FREMD, id: "diag_fremd", diagnostic: true, endedAt: vorTagen(10), texte: ["z"] });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "diag_frisch", diagnostic: true, endedAt: vorTagen(2), texte: ["f"] });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "normal", endedAt: vorTagen(10), texte: ["n"] });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "diag_leer", diagnostic: true, endedAt: vorTagen(10) });

  const removed = await store.pruneOldData(30, 7, 0);

  assert.equal(removed.diagnosticTranscripts, 2);
  assert.equal(removed.calls, 0);
  assert.deepEqual(await idsDerAnrufe(db, KUNDE), ["diag_alt", "diag_frisch", "diag_leer", "normal"]);
  const rest = await zeilen(db, KUNDE, `SELECT call_id FROM transcript_segment ORDER BY call_id`);
  assert.deepEqual(rest.map((zeile) => zeile.call_id), ["diag_frisch", "normal"]);
  assert.equal((await zeilen(db, FREMD, `SELECT 1 FROM transcript_segment`)).length, 0);
});

test("Fristen: Ergebnis-Belege abgelaufener Anrufe fallen weg, die uebrige Karte bleibt", async () => {
  const { store, db } = await aufbau();
  const karte = { outcome: "ok", evidence: [{ quote: "Zitat" }] };
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "alt", endedAt: vorTagen(10), result: karte });
  await anrufEinfuegen(db, { tenantId: FREMD, id: "alt_fremd", endedAt: vorTagen(10), result: karte });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "frisch", endedAt: vorTagen(2), result: karte });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "ohne_beleg", endedAt: vorTagen(10), result: { outcome: "nein" } });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "ohne_karte", endedAt: vorTagen(10) });

  const removed = await store.pruneOldData(0, 0, 7);

  assert.equal(removed.resultEvidence, 2);
  const ergebnisse = await zeilen(db, KUNDE, `SELECT id, result FROM call ORDER BY id`);
  assert.deepEqual(ergebnisse, [
    { id: "alt", result: { outcome: "ok" } },
    { id: "frisch", result: karte },
    { id: "ohne_beleg", result: { outcome: "nein" } },
    { id: "ohne_karte", result: null },
  ]);
  assert.deepEqual((await zeilen(db, FREMD, `SELECT result FROM call`))[0].result, { outcome: "ok" });
});

test("Fristen: ein Datenbankfehler wirft und gilt nicht als nichts zu loeschen", async () => {
  let kaputt = false;
  const { store, db } = await aufbau((text) => {
    if (kaputt && text.includes("DELETE FROM call")) throw new Error("Datenbank weg");
  });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "alt", endedAt: vorTagen(40) });
  kaputt = true;
  await assert.rejects(() => store.pruneOldData(30, 7, 7), /Datenbank weg/);
  kaputt = false;
  assert.deepEqual(await idsDerAnrufe(db, KUNDE), ["alt"]);
});

test("Fristen: Anrufe im eigenen Spiegel verschwinden mit, Benachrichtigungen werden weiter gezaehlt", async () => {
  const { store, db } = await aufbau();
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: "+4915112349921", tenantId: KUNDE });
  await store.persistCall(call.id);
  await store.endCallRecord(call.id, "completed");
  store.getCall(call.id).endedAt = vorTagen(40);
  await setzeKontext(db, KUNDE);
  await db.query(`UPDATE call SET ended_at = $1 WHERE id = $2`, [vorTagen(40), call.id]);

  const removed = await store.pruneOldData(30, 7, 7);

  assert.equal(removed.calls, 1);
  assert.equal(store.load().calls.some((eintrag) => eintrag.id === call.id), false);
});

test("Fristen: Frist 0 oder negativ gilt ab jetzt, auch fuer Diagnose-Transkripte von vor einer Stunde", async () => {
  const { store, db } = await aufbau();
  const vorEinerStunde = new Date(Date.now() - 3600 * 1000).toISOString();
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "diag", diagnostic: true, endedAt: vorEinerStunde, texte: ["x"] });
  await anrufEinfuegen(db, { tenantId: KUNDE, id: "beleg", endedAt: vorEinerStunde, result: { evidence: [] } });

  const removed = await store.pruneOldData(0, -3, -3);

  assert.equal(removed.diagnosticTranscripts, 1);
  assert.equal(removed.resultEvidence, 1);
});
