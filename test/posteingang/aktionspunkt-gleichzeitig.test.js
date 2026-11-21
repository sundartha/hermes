import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

async function speicherMit(protokoll, fehlerBei, anrufExtern = false) {
  const { store: anderer, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          protokoll.push(text);
          if (fehlerBei() && /INSERT INTO action_item/.test(text)) throw new Error("Schreibfehler");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
  const store = makePgStore(runner);
  await store.init();
  const erzeuger = anrufExtern ? anderer : store;
  const call = erzeuger.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await erzeuger.persistCall(call.id);
  return { store, callId: call.id };
}

const ohneFehler = () => false;

test("Zwei gleichzeitige Aktionspunkte mit gleichem Text: einer wird angelegt, der zweite meldet duplicate und oeffnet keinen eigenen Schreibvorgang", async () => {
  const protokoll = [];
  const { store, callId } = await speicherMit(protokoll, ohneFehler);
  protokoll.length = 0;
  const [erster, zweiter] = await Promise.all([
    store.addActionItem(callId, "Rueckruf bei Meier", "todo"),
    store.addActionItem(callId, "Rueckruf bei Meier", "todo"),
  ]);
  assert.equal(erster.duplicate, false);
  assert.equal(zweiter.duplicate, true);
  assert.equal(zweiter.item.id, erster.item.id);
  assert.equal(protokoll.filter((text) => text === "BEGIN").length, 1);
  assert.equal(protokoll.filter((text) => /INSERT INTO action_item/.test(text)).length, 1);
});

test("Scheitert das Schreiben des gleichzeitig doppelt angelegten Punkts, bleibt der andere Punkt im Spiegel und in actionItemIds des Anrufs", async () => {
  let kaputt = false;
  const { store, callId } = await speicherMit([], () => kaputt);
  await store.addActionItem(callId, "Fremder Punkt", "todo");
  kaputt = true;
  const ergebnis = await Promise.allSettled([
    store.addActionItem(callId, "Rueckruf bei Meier", "todo"),
    store.addActionItem(callId, "Rueckruf bei Meier", "todo"),
  ]);
  assert.equal(ergebnis[0].status, "rejected");
  assert.deepEqual(store.load().actionItems.map((punkt) => punkt.text), ["Fremder Punkt"]);
  assert.equal(store.getCall(callId).actionItemIds.length, 1);
});

test("Scheitert das Schreiben des einzigen Punkts, ist der Spiegel danach leer", async () => {
  let kaputt = true;
  const { store, callId } = await speicherMit([], () => kaputt);
  await assert.rejects(store.addActionItem(callId, "Einziger", "todo"), /Schreibfehler/);
  assert.deepEqual(store.load().actionItems, []);
  assert.deepEqual(store.getCall(callId).actionItemIds, []);
  kaputt = false;
});

test("Scheitert das Schreiben fuer einen Anruf, den die Instanz nicht gespiegelt hat, bleibt der Schreibfehler die gemeldete Ursache", async () => {
  const { store, callId } = await speicherMit([], () => true, true);
  await assert.rejects(store.addActionItem(callId, "Einziger", "todo"), /Schreibfehler/);
  assert.deepEqual(store.load().actionItems, []);
});
