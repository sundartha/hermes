import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

const FRIST_TAGE = 30;
const MS_JE_TAG = 86_400_000;

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
  const call = a.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(call.id);
  const b = makePgStore(runnerFuer(db));
  await b.init();
  return { a, b, db, callId: call.id };
}

const zeilen = async (db, callId) =>
  (await db.query(`SELECT tenant_id, text, type, done FROM action_item WHERE call_id = $1 ORDER BY seq`, [callId])).rows;

test("Zwei Instanzen legen gleichzeitig Aktionspunkte fuer denselben Anruf an: beide stehen in action_item", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  const [ra, rb] = await Promise.all([
    a.addActionItem(callId, "Rueckruf bei Meier", "todo"),
    b.addActionItem(callId, "Termin am Montag", "appointment"),
  ]);
  assert.equal(ra.duplicate, false);
  assert.equal(rb.duplicate, false);
  assert.deepEqual(await zeilen(db, callId), [
    { tenant_id: BOOTSTRAP_TENANT_ID, text: "Rueckruf bei Meier", type: "todo", done: false },
    { tenant_id: BOOTSTRAP_TENANT_ID, text: "Termin am Montag", type: "appointment", done: false },
  ]);
});

test("Derselbe Text nach Normalisierung gilt auf der anderen Instanz als Duplikat und legt keine zweite Zeile an", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  const erster = await a.addActionItem(callId, "Rueckruf bei Meier", "todo");
  const zweiter = await b.addActionItem(callId, "  rueckruf   bei MEIER. ", "todo");
  assert.equal(zweiter.duplicate, true);
  assert.equal(zweiter.item.id, erster.item.id);
  assert.equal((await zeilen(db, callId)).length, 1);
});

test("Instanz B liest den Aktionspunkt von Instanz A sofort, in Anlegereihenfolge, ohne Neustart", async () => {
  const { a, b, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Erster", "todo");
  await a.addActionItem(callId, "Zweiter", "todo");
  await b.addActionItem(callId, "Dritter", "todo");
  const gelesen = await b.callActionItems(callId);
  assert.deepEqual(gelesen.map((punkt) => punkt.text), ["Erster", "Zweiter", "Dritter"]);
  assert.deepEqual(Object.keys(gelesen[0]).sort(), ["callId", "createdAt", "done", "id", "text", "type"]);
  assert.equal(gelesen[0].callId, callId);
  assert.equal(gelesen[0].done, false);
});

test("Speichern auf Instanz B loescht keinen Aktionspunkt, den Instanz A geschrieben hat", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Von A", "todo");
  await b.addActionItem(callId, "Von B", "todo");
  await b.save();
  await b.drainFlushes();
  assert.deepEqual((await zeilen(db, callId)).map((z) => z.text), ["Von A", "Von B"]);
});

test("Ein Aktionspunkt gehoert dem Mandanten der Anrufzeile", async () => {
  const { a, db, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Eigener", "todo");
  const rows = (await db.query(`SELECT a.tenant_id AS punkt, c.tenant_id AS anruf FROM action_item a JOIN call c ON c.id = a.call_id`)).rows;
  assert.deepEqual(rows, [{ punkt: BOOTSTRAP_TENANT_ID, anruf: BOOTSTRAP_TENANT_ID }]);
});

test("Ein Schreibfehler wirft, laesst den Speicher unveraendert und rollt die Transaktion zurueck", async () => {
  const { a, db, callId } = await zweiInstanzen();
  const protokoll = [];
  const kaputt = makePgStore(runnerFuer(db, protokoll, (text) => text.includes("INSERT INTO action_item") && text.includes("RETURNING")));
  await kaputt.init();
  await assert.rejects(() => kaputt.addActionItem(callId, "Geht nicht", "todo"), /Schreibfehler/);
  assert.deepEqual(kaputt.load().actionItems, []);
  assert.deepEqual(kaputt.getCall(callId).actionItemIds, []);
  assert.equal(protokoll.includes("ROLLBACK"), true);
  assert.equal(protokoll.includes("COMMIT"), false);
  assert.equal(protokoll.includes("BEGIN"), true);
  assert.equal(protokoll.some((text) => text.includes("pg_advisory_xact_lock")), true);
  assert.deepEqual(await zeilen(db, callId), []);
  assert.equal((await a.addActionItem(callId, "Danach", "todo")).duplicate, false);
});

test("Ein erfolgreicher Vorgang schliesst mit COMMIT ab", async () => {
  const { db, callId } = await zweiInstanzen();
  const protokoll = [];
  const store = makePgStore(runnerFuer(db, protokoll));
  await store.init();
  await store.addActionItem(callId, "Gut", "todo");
  assert.equal(protokoll.includes("COMMIT"), true);
  assert.equal(protokoll.includes("ROLLBACK"), false);
});

test("Anruf noch nicht in der Datenbank: der Aktionspunkt wird aus dem Spiegel geliefert und mit dem naechsten Speichern geschrieben", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.drainFlushes();
  await db.query(`DELETE FROM call WHERE id = $1`, [call.id]);
  const { item } = await store.addActionItem(call.id, "Noch im Spiegel", "todo");
  assert.deepEqual((await store.callActionItems(call.id)).map((punkt) => punkt.id), [item.id]);
  await store.drainFlushes();
  assert.deepEqual((await db.query(`SELECT id FROM action_item`)).rows, [{ id: item.id }]);
});

test("Eine unbekannte Anrufkennung legt weiter einen Spiegel-Eintrag an wie bisher", async () => {
  const { store } = await makePgTestStore();
  const { item, duplicate } = await store.addActionItem("call_unbekannt", "Text", "todo");
  assert.equal(duplicate, false);
  assert.deepEqual((await store.callActionItems("call_unbekannt")).map((punkt) => punkt.id), [item.id]);
});

test("Die Mandanten-Loeschung entfernt auch Aktionspunkte, die nur eine andere Instanz kennt", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Nummer +4915112345678 anrufen", "todo");
  const removed = await b.eraseTenantData(BOOTSTRAP_TENANT_ID);
  assert.equal(removed.calls, 1);
  assert.deepEqual((await db.query(`SELECT id FROM action_item`)).rows, []);
});

test("Die Aufbewahrung loescht erledigte abgelaufene Aktionspunkte, auch fremde, und laesst offene und frische stehen", async () => {
  const { a, b, db, callId } = await zweiInstanzen();
  const alt = new Date(Date.now() - 2 * FRIST_TAGE * MS_JE_TAG).toISOString();
  const frisch = new Date().toISOString();
  const einfuegen = (id, done, zeit) =>
    db.query(
      `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at) VALUES ($1,$2,$3,$1,'todo',$4,$5)`,
      [id, BOOTSTRAP_TENANT_ID, callId, done, zeit],
    );
  await einfuegen("ai_alt_erledigt", true, alt);
  await einfuegen("ai_alt_offen", false, alt);
  await einfuegen("ai_frisch_erledigt", true, frisch);
  await a.pruneOldData(FRIST_TAGE, FRIST_TAGE, FRIST_TAGE);
  const ids = (await db.query(`SELECT id FROM action_item ORDER BY id`)).rows.map((z) => z.id);
  assert.deepEqual(ids, ["ai_alt_offen", "ai_frisch_erledigt"]);
  await b.pruneOldData(0, FRIST_TAGE, FRIST_TAGE);
  assert.equal((await db.query(`SELECT id FROM action_item`)).rows.length, 2);
});

test("Zweimal derselbe Text auf derselben Instanz: das Duplikat wird ohne Datenbankzugriff gemeldet und der erste Eintrag bleibt", async () => {
  const { a, db, callId } = await zweiInstanzen();
  let kaputt = false;
  const b = makePgStore(runnerFuer(db, [], () => kaputt));
  await b.init();
  const erster = await b.addActionItem(callId, "Rueckruf bei Meier", "todo");
  kaputt = true;
  const zweiter = await b.addActionItem(callId, "Rueckruf bei Meier", "todo");
  assert.equal(zweiter.duplicate, true);
  assert.equal(zweiter.item.id, erster.item.id);
  assert.deepEqual(b.load().actionItems.map((punkt) => punkt.text), ["Rueckruf bei Meier"]);
  assert.equal((await zeilen(db, callId)).length, 1);
  assert.equal((await a.callActionItems(callId)).length, 1);
});

test("Der Prompt liest die Aktionspunkte des Anrufs synchron aus dem Spiegel des pg-Speichers", async () => {
  const { a, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Fahrzeugschein mitbringen", "todo");
  const gelesen = a.callActionItemsGespiegelt(callId);
  assert.equal(Array.isArray(gelesen), true);
  assert.deepEqual(gelesen.map((punkt) => punkt.text), ["Fahrzeugschein mitbringen"]);
});

test("Anrufende mit pg-Speicher und vorhandener Zusammenfassung meldet die Zusammenfassung ohne Fehler", async () => {
  const { baueHarness } = await import("../_iel-inbound-harness.js");
  const { store: pg } = await makePgTestStore();
  const call = pg.createCall({ direction: "outbound", from: "+49", to: "+4915112345", tenantId: BOOTSTRAP_TENANT_ID });
  await pg.persistCall(call.id);
  await pg.addActionItem(call.id, "Rueckruf bei Meier", "todo");
  const live = pg.getCall(call.id);
  Object.assign(live, { status: "completed", summary: "Alles geklaert", transcript: [{ role: "caller", text: "Hallo", at: "2026-01-01T00:00:00Z" }] });
  const harness = baueHarness(pg.load());
  const meldungen = [];
  harness.store.addNotification = (titel, text) => meldungen.push(text);
  harness.store.callActionItems = (id) => pg.callActionItems(id);
  await harness.callFinish.finishCall(live);
  assert.equal(harness.zusammenfassungen.length, 0);
  assert.equal(meldungen.length, 1);
  assert.ok(meldungen[0].endsWith(": Alles geklaert"));
});

test("Ohne Angabe der Art wird der Aktionspunkt als todo geschrieben", async () => {
  const { a, db, callId } = await zweiInstanzen();
  await a.addActionItem(callId, "Ohne Art");
  assert.deepEqual((await zeilen(db, callId)).map((z) => z.type), ["todo"]);
});

test("Ein per SQL angelegter Aktionspunkt loest kein zusaetzliches Speichern des Anrufs aus", async () => {
  const { db, callId } = await zweiInstanzen();
  const protokoll = [];
  const store = makePgStore(runnerFuer(db, protokoll));
  await store.init();
  await store.drainFlushes();
  const vorher = protokoll.length;
  await store.addActionItem(callId, "Nur die Zeile", "todo");
  await store.drainFlushes();
  const danach = protokoll.slice(vorher);
  assert.equal(danach.some((text) => text.includes("INSERT INTO action_item")), true);
  assert.equal(danach.some((text) => text.includes("INSERT INTO call")), false);
});

test("Fehlt die Anrufzeile in der Datenbank, loest der Aktionspunkt das Speichern des Anrufs aus", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.drainFlushes();
  await db.query(`DELETE FROM call WHERE id = $1`, [call.id]);
  await store.addActionItem(call.id, "Zeile fehlt", "todo");
  await store.drainFlushes();
  assert.equal((await db.query(`SELECT id FROM call WHERE id = $1`, [call.id])).rows.length, 1);
});
