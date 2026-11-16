import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

const MAX_JE_MANDANT = 50;
const FREMDER_MANDANT = "tenant_fremd";

function runnerFuer(db, protokoll = [], fehlerBei = null) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          protokoll.push(text);
          if (fehlerBei && fehlerBei(text)) throw new Error("Schreibfehler");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function zweiInstanzen() {
  const { store: a, db } = await makePgTestStore();
  const call = a.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(call.id);
  const b = makePgStore(runnerFuer(db));
  await b.init();
  return { a, b, db, callId: call.id };
}

const titel = async (db, mandant = BOOTSTRAP_TENANT_ID) =>
  (await db.query(`SELECT title FROM notification WHERE tenant_id = $1 ORDER BY seq`, [mandant])).rows.map((z) => z.title);

test("Zwei Instanzen legen gleichzeitig Benachrichtigungen an: beide stehen in notification", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await Promise.all([a.addNotification("Von A", "x", callId), b.addNotification("Von B", "y", callId)]);
  assert.deepEqual((await titel(db)).sort(), ["Von A", "Von B"]);
});

test("Die Benachrichtigung gehoert dem Mandanten der Anrufzeile und traegt Text und Anruf", async () => {
  const { a, db, callId } = await zweiInstanzen();
  await a.addNotification("Titel", "Inhalt +4915112345678", callId);
  const rows = (await db.query(`SELECT tenant_id, title, body, call_id FROM notification`)).rows;
  assert.deepEqual(rows, [{ tenant_id: BOOTSTRAP_TENANT_ID, title: "Titel", body: "Inhalt +4915112345678", call_id: callId }]);
  assert.equal(a.load().notifications[0].title, "Titel");
});

test("Der 51. Eintrag verdraengt den aeltesten desselben Mandanten, nie den eines anderen", async () => {
  const { a, db, callId } = await zweiInstanzen();
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [FREMDER_MANDANT]);
  await db.query(
    `INSERT INTO notification (id, tenant_id, title, body, call_id, at) VALUES ('nt_fremd', $1, 'Fremd', '', NULL, '2026-01-01T00:00:00Z')`,
    [FREMDER_MANDANT],
  );
  for (let i = 0; i <= MAX_JE_MANDANT; i++) await a.addNotification(`t${i}`, "b", callId);
  const eigene = await titel(db);
  assert.equal(eigene.length, MAX_JE_MANDANT);
  assert.equal(eigene[0], "t1");
  assert.equal(eigene[MAX_JE_MANDANT - 1], `t${MAX_JE_MANDANT}`);
  assert.deepEqual(await titel(db, FREMDER_MANDANT), ["Fremd"]);
});

test("Die Kuerzung zaehlt Eintraege, die nur eine andere Instanz kennt", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  for (let i = 0; i < MAX_JE_MANDANT; i++) await a.addNotification(`a${i}`, "b", callId);
  await b.addNotification("neu", "b", callId);
  const stehen = await titel(db);
  assert.equal(stehen.length, MAX_JE_MANDANT);
  assert.equal(stehen[0], "a1");
  assert.equal(stehen.at(-1), "neu");
});

test("Nach der Mandanten-Loeschung durch eine andere Instanz entsteht aus dem endenden Anruf keine Zeile", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await b.eraseTenantData(BOOTSTRAP_TENANT_ID);
  await a.addNotification("Zusammenfassung", "+4915112345678: Geheim", callId);
  await a.drainFlushes();
  assert.deepEqual((await db.query(`SELECT id FROM notification`)).rows, []);
});

test("Ein Schreibfehler wirft, laesst den Spiegel unveraendert und rollt zurueck", async () => {
  const { db, callId } = await zweiInstanzen();
  const protokoll = [];
  const kaputt = makePgStore(runnerFuer(db, protokoll, (text) => text.includes("INSERT INTO notification")));
  await kaputt.init();
  await assert.rejects(() => kaputt.addNotification("Geht nicht", "b", callId), /Schreibfehler/);
  assert.deepEqual(kaputt.load().notifications, []);
  assert.equal(protokoll.includes("ROLLBACK"), true);
  assert.equal(protokoll.includes("COMMIT"), false);
  assert.deepEqual(await titel(db), []);
});

test("Ein erfolgreicher Vorgang schliesst mit COMMIT ab", async () => {
  const { db, callId } = await zweiInstanzen();
  const protokoll = [];
  const store = makePgStore(runnerFuer(db, protokoll));
  await store.init();
  await store.addNotification("Gut", "b", callId);
  assert.equal(protokoll.includes("COMMIT"), true);
  assert.equal(protokoll.includes("ROLLBACK"), false);
});

test("Ohne Anrufkennung oder bei unbekanntem Anruf bleibt es beim Spiegel wie bisher", async () => {
  const { store, db } = await makePgTestStore();
  await store.addNotification("Ohne Anruf", "b", null);
  await store.addNotification("Unbekannt", "b", "call_unbekannt");
  assert.deepEqual(store.load().notifications.map((n) => n.title), ["Unbekannt", "Ohne Anruf"]);
  await store.drainFlushes();
  assert.deepEqual(await titel(db), ["Ohne Anruf"]);
});

test("Anruf nicht in der Datenbank: die Benachrichtigung steht im Spiegel und loest kein eigenes Speichern aus", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.drainFlushes();
  await db.query(`DELETE FROM call WHERE id = $1`, [call.id]);
  await store.addNotification("Spaeter", "b", call.id);
  assert.equal(store.load().notifications[0].title, "Spaeter");
  await store.drainFlushes();
  assert.deepEqual(await titel(db), []);
  assert.deepEqual((await db.query(`SELECT id FROM call WHERE id = $1`, [call.id])).rows, []);
});
