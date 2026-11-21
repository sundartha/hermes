import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

test("Scheitert das Schreiben eines Punkts, der schon aus dem Spiegel entfernt ist, bleibt der andere Punkt erhalten", async () => {
  const { store: anderer, db } = await makePgTestStore();
  const call = anderer.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await anderer.persistCall(call.id);
  const zustand = { store: null, kaputt: false };
  const runner = {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          if (zustand.kaputt && /INSERT INTO action_item/.test(text)) {
            const liste = zustand.store.load().actionItems;
            liste.splice(liste.findIndex((punkt) => punkt.text === "Verschwindet"), 1);
            throw new Error("Schreibfehler");
          }
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
  const store = makePgStore(runner);
  zustand.store = store;
  await store.init();
  const fremd = await store.addActionItem(call.id, "Fremder Punkt", "todo");
  zustand.kaputt = true;
  await assert.rejects(store.addActionItem(call.id, "Verschwindet", "todo"), /Schreibfehler/);
  assert.deepEqual(store.load().actionItems.map((punkt) => punkt.id), [fremd.item.id]);
});
