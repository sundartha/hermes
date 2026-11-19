import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_h7c1_kunde";
const ZIEL = "+4915112349966";
const ABSENDER = "+4930555000366";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

const anruf = (store) =>
  store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });

async function mitGeladenemAnruf() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await setzeKontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const anleger = await neueInstanz(db);
  const call = anruf(anleger);
  await anleger.persistCall(call.id);
  await anleger.addTranscript(call.id, "agent", "Guten Tag");
  await anleger.drainFlushes();
  const a = await neueInstanz(db);
  return { db, a, callId: call.id };
}

const zeileVon = async (db, callId) => {
  await setzeKontext(db, KUNDE);
  const { rows } = await db.query("SELECT failure_reason, summary FROM call WHERE id = $1", [callId]);
  return rows[0];
};

const transkriptVon = async (db, callId) => {
  await setzeKontext(db, KUNDE);
  const { rows } = await db.query("SELECT text FROM transcript_segment WHERE call_id = $1 ORDER BY id", [callId]);
  return rows.map((zeile) => zeile.text);
};

test("H7c1-1: ein Anruf, den nur eine andere Instanz aendert, wird vom Flush dieser Instanz nicht zurueckgeschrieben", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  await setzeKontext(db, KUNDE);
  await db.query("UPDATE call SET failure_reason = 'von B' WHERE id = $1", [callId]);
  await db.query("INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,'callee','Hallo von B',$3)", [
    callId,
    KUNDE,
    new Date().toISOString(),
  ]);
  const anderer = anruf(a);
  await a.persistCall(anderer.id);
  await a.save();
  await a.drainFlushes();
  assert.equal((await zeileVon(db, callId)).failure_reason, "von B");
  assert.deepEqual(await transkriptVon(db, callId), ["Guten Tag", "Hallo von B"]);
});

test("H7c1-2: ein Anruf, den diese Instanz aendert, wird beim Flush geschrieben", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  await a.leseCall(callId);
  a.recordFailureReason(callId, "von A");
  await a.drainFlushes();
  assert.equal((await zeileVon(db, callId)).failure_reason, "von A");
});

test("H7c1-3: eine direkte Aenderung am Spiegel wird beim naechsten Flush geschrieben", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  (await a.leseCall(callId)).summary = "direkt im Spiegel";
  await a.save();
  await a.drainFlushes();
  assert.equal((await zeileVon(db, callId)).summary, "direkt im Spiegel");
});

test("H7c1-4: nach dem Schreiben ist der Anruf nicht mehr geaendert, ein zweiter Flush ueberschreibt eine fremde Aenderung nicht", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  a.recordFailureReason(callId, "von A");
  await a.drainFlushes();
  await setzeKontext(db, KUNDE);
  await db.query("UPDATE call SET failure_reason = 'danach von B' WHERE id = $1", [callId]);
  await a.save();
  await a.drainFlushes();
  assert.equal((await zeileVon(db, callId)).failure_reason, "danach von B");
});

test("H7c1-5: eine neue Transkriptzeile im Spiegel wird beim Flush geschrieben", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  (await a.leseCall(callId)).transcript.push({ role: "callee", text: "direkt", at: new Date().toISOString() });
  await a.save();
  await a.drainFlushes();
  assert.deepEqual(await transkriptVon(db, callId), ["Guten Tag", "direkt"]);
});

test("H7c1-6: ein Anruf einer anderen Instanz, den diese Instanz erst per leseCall holt, wird vom Flush nicht zurueckgeschrieben", async () => {
  const { db, a } = await mitGeladenemAnruf();
  const anleger = await neueInstanz(db);
  const spaeter = anruf(anleger);
  await anleger.persistCall(spaeter.id);
  assert.equal((await a.leseCall(spaeter.id)).id, spaeter.id);
  await setzeKontext(db, KUNDE);
  await db.query("UPDATE call SET failure_reason = 'von B' WHERE id = $1", [spaeter.id]);
  await a.save();
  await a.drainFlushes();
  assert.equal((await zeileVon(db, spaeter.id)).failure_reason, "von B");
});

test("H7c1-7: eine noch unbestaetigte Transkriptzeile macht den Anruf fuer den Flush nicht zum geaenderten Anruf", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  await setzeKontext(db, KUNDE);
  await db.query("UPDATE call SET failure_reason = 'von B' WHERE id = $1", [callId]);
  const flush = a.save();
  const anhaengen = a.addTranscript(callId, "callee", "gerade eben");
  await Promise.all([flush, anhaengen]);
  await a.drainFlushes();
  assert.equal((await zeileVon(db, callId)).failure_reason, "von B");
  assert.deepEqual(await transkriptVon(db, callId), ["Guten Tag", "gerade eben"]);
});

test("H7c1-8: ein auf dieser Instanz gebundener Anruf wird beim Flush geschrieben, auch wenn er sich hier nicht geändert hat", async () => {
  const { db, a, callId } = await mitGeladenemAnruf();
  assert.equal((await a.attachActiveCall(callId)).id, callId);
  await a.drainFlushes();
  await setzeKontext(db, KUNDE);
  await db.query("UPDATE call SET failure_reason = 'von B' WHERE id = $1", [callId]);
  await a.save();
  await a.drainFlushes();
  assert.equal((await zeileVon(db, callId)).failure_reason, null);
});
