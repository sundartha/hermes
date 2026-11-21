import assert from "node:assert/strict";
import { test } from "node:test";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

function runnerFuer(db, protokoll, fehlerBei) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          protokoll.push(text);
          if (fehlerBei() && text.includes("INSERT INTO action_item") && text.includes("RETURNING")) throw new Error("Schreibfehler");
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function aufbau() {
  const { store: a, db } = await makePgTestStore();
  const call = a.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(call.id);
  const protokoll = [];
  const zustand = { scheitert: false };
  const b = makePgStore(runnerFuer(db, protokoll, () => zustand.scheitert));
  await b.init();
  return { b, db, callId: call.id, protokoll, zustand };
}

const einfuegungen = (protokoll) =>
  protokoll.filter((text) => text.includes("INSERT INTO action_item") && text.includes("RETURNING")).length;

test("Zwei gleichzeitige gleiche Aktionspunkte: der zweite meldet duplicate und schreibt nicht selbst", async () => {
  const { b, db, callId, protokoll } = await aufbau();
  const [erster, zweiter] = await Promise.all([
    b.addActionItem(callId, "Rueckruf bei Meier", "todo"),
    b.addActionItem(callId, "Rueckruf bei Meier", "todo"),
  ]);
  assert.equal(erster.duplicate, false);
  assert.equal(zweiter.duplicate, true);
  assert.equal(zweiter.item.id, erster.item.id);
  assert.equal(einfuegungen(protokoll), 1);
  const { rows } = await db.query(`SELECT id FROM action_item WHERE call_id = $1`, [callId]);
  assert.equal(rows.length, 1);
});

test("Scheitert das Schreiben des ersten, bleibt ein fremder Eintrag in Spiegel und actionItemIds erhalten", async () => {
  const { b, callId, zustand } = await aufbau();
  const fremd = await b.addActionItem(callId, "Fremder Punkt", "todo");
  zustand.scheitert = true;
  const ergebnisse = await Promise.allSettled([
    b.addActionItem(callId, "Geht nicht", "todo"),
    b.addActionItem(callId, "Geht nicht", "todo"),
  ]);
  assert.equal(ergebnisse[0].status, "rejected");
  assert.deepEqual(b.load().actionItems.map((punkt) => punkt.id), [fremd.item.id]);
  assert.deepEqual((await b.leseCall(callId)).actionItemIds, [fremd.item.id]);
});

test("Scheitert das Schreiben des einzigen Punkts, ist er aus Spiegel und actionItemIds entfernt", async () => {
  const { b, callId, zustand } = await aufbau();
  zustand.scheitert = true;
  await assert.rejects(() => b.addActionItem(callId, "Allein", "todo"), /Schreibfehler/);
  assert.deepEqual(b.load().actionItems, []);
  assert.deepEqual((await b.leseCall(callId)).actionItemIds, []);
});
