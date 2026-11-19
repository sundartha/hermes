import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

function runnerFuer(db, fehlerBei = null) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          if (fehlerBei?.(text)) throw new Error("Lesefehler");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function spaeterAngelegterAnruf(fehlerBei = null) {
  const { store: a, db } = await makePgTestStore();
  const b = makePgStore(runnerFuer(db, (text) => fehlerBei?.(text)));
  await b.init();
  const call = a.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(call.id);
  return { a, b, db, callId: call.id };
}

test("Instanz B schreibt einen Aktionspunkt zu einem Anruf, den nur A geladen hat, mit dem Mandanten der Anrufzeile", async () => {
  const { b, db, callId } = await spaeterAngelegterAnruf();
  const ergebnis = await b.addActionItem(callId, "Rueckruf bei Meier", "todo");
  assert.equal(ergebnis.duplicate, false);
  const rows = (await db.query(`SELECT tenant_id, text, type FROM action_item WHERE call_id = $1`, [callId])).rows;
  assert.deepEqual(rows, [{ tenant_id: BOOTSTRAP_TENANT_ID, text: "Rueckruf bei Meier", type: "todo" }]);
});

test("Instanz B schreibt eine Benachrichtigung zu einem Anruf, den nur A geladen hat", async () => {
  const { b, db, callId } = await spaeterAngelegterAnruf();
  await b.addNotification("Titel", "Inhalt", callId);
  const rows = (await db.query(`SELECT tenant_id, title, call_id FROM notification`)).rows;
  assert.deepEqual(rows, [{ tenant_id: BOOTSTRAP_TENANT_ID, title: "Titel", call_id: callId }]);
  assert.deepEqual(b.load().notifications.map((meldung) => meldung.title), ["Titel"]);
});

test("Instanz B liest die Aktionspunkte von A zu einem Anruf, den B nicht geladen hat", async () => {
  const { a, b, callId } = await spaeterAngelegterAnruf();
  await a.addActionItem(callId, "Von A", "todo");
  const gelesen = await b.callActionItems(callId);
  assert.deepEqual(gelesen.map((punkt) => punkt.text), ["Von A"]);
});

test("Instanz B schaltet einen Aktionspunkt zu einem Anruf um, den nur A geladen hat, und die Zeile folgt", async () => {
  const { b, db, callId } = await spaeterAngelegterAnruf();
  const { item } = await b.addActionItem(callId, "Erledigen", "todo");
  b.toggleActionItem(item.id);
  await b.drainFlushes();
  const rows = (await db.query(`SELECT done FROM action_item WHERE call_id = $1`, [callId])).rows;
  assert.deepEqual(rows, [{ done: true }]);
});

test("Schlaegt das Lesen des Anrufs fehl, lehnt addActionItem ab und im Spiegel steht kein Punkt", async () => {
  let kaputt = false;
  const { b, callId } = await spaeterAngelegterAnruf((text) => kaputt && /FROM anruf_schluessel/.test(text));
  kaputt = true;
  await assert.rejects(() => b.addActionItem(callId, "Verloren", "todo"), /Lesefehler/);
  assert.deepEqual(b.load().actionItems, []);
});

test("Schlaegt das Schreiben fehl, bleibt der Spiegel von B ohne den Punkt und ohne fremde Eintraege", async () => {
  let kaputt = false;
  const { b, callId } = await spaeterAngelegterAnruf((text) => kaputt && /INSERT INTO action_item/.test(text));
  const vorher = await b.addActionItem(callId, "Bleibt", "todo");
  kaputt = true;
  await assert.rejects(() => b.addActionItem(callId, "Faellt weg", "todo"), /Lesefehler/);
  assert.deepEqual(b.load().actionItems.map((punkt) => punkt.id), [vorher.item.id]);
});

test("Ein Duplikat im Spiegel braucht keinen Datenbankzugriff", async () => {
  let zugriffe = 0;
  const { b, callId } = await spaeterAngelegterAnruf(() => {
    zugriffe += 1;
    return false;
  });
  await b.addActionItem(callId, "Doppelt", "todo");
  const davor = zugriffe;
  const zweiter = await b.addActionItem(callId, " doppelt. ", "todo");
  assert.equal(zweiter.duplicate, true);
  assert.equal(zugriffe, davor);
});
