import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const MANDANTEN = ["t_ende_a", "t_ende_b", "t_ende_c"];
const ZIEL = "+4915112349944";
const ENDE_ZEIT = "2026-01-01T00:10:00.000Z";

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

async function neueInstanz(db, mitschnitt) {
  const store = makePgStore(runnerFuer(db, mitschnitt));
  await store.init();
  return store;
}

async function mitMandanten(db) {
  await neueInstanz(db);
  for (const id of MANDANTEN) {
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [id]);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
}

async function legeAn(store, tenantId) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000302", to: ZIEL, goal: "Test", tenantId });
  await store.persistCall(call.id);
  return call;
}

test("BEENDEN-1: die Pruefung im Mandanten des Anrufs setzt den Kontext einmal und liest die Anrufzeile mit einer Abfrage", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const mitschnitt = [];
  const [besitzer, pruefer] = [await neueInstanz(db), await neueInstanz(db, mitschnitt)];
  const call = await legeAn(besitzer, "t_ende_c");
  mitschnitt.length = 0;
  const gefunden = await pruefer.attachActiveCall(call.id, { mandant: "t_ende_c" });
  assert.equal(gefunden.id, call.id);
  const kontexte = mitschnitt.filter((eintrag) => eintrag.text.includes("set_config")).map((eintrag) => eintrag.params);
  assert.deepEqual(kontexte, [["t_ende_c"]]);
  const anrufAbfragen = mitschnitt.filter((eintrag) => /FROM call WHERE/.test(eintrag.text));
  assert.equal(anrufAbfragen.length, 1);
});

test("BEENDEN-2: ein beendeter Anruf liefert null, und ein Anruf im falschen Mandanten wird nicht gefunden", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [besitzer, pruefer] = [await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(besitzer, "t_ende_b");
  assert.equal(await pruefer.attachActiveCall(call.id, { mandant: "t_ende_a" }), null);
  assert.equal(pruefer.getCall(call.id), null);
  await pruefer.attachActiveCall(call.id, { mandant: "t_ende_b" });
  await pruefer.setCallEndedAt(call.id, "completed", ENDE_ZEIT);
  assert.equal(await pruefer.attachActiveCall(call.id, { mandant: "t_ende_b" }), null);
});

test("BEENDEN-3: hat ein anderer Prozess den Anruf beendet, zeigt der Spiegel des Besitzers Status, Endzeit und Grund der Datenbankzeile", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await mitMandanten(db);
  const [besitzer, pruefer] = [await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(besitzer, "t_ende_b");
  await pruefer.attachActiveCall(call.id, { mandant: "t_ende_b" });
  pruefer.recordFailureReason(call.id, "budget-exhausted");
  await pruefer.setCallEndedAt(call.id, "completed", ENDE_ZEIT);
  assert.equal(besitzer.getCall(call.id).status, "active");
  assert.equal(await besitzer.attachActiveCall(call.id, { mandant: "t_ende_b" }), null);
  const spiegel = besitzer.getCall(call.id);
  assert.equal(spiegel.status, "completed");
  assert.equal(spiegel.endedAt, ENDE_ZEIT);
  assert.equal(spiegel.failureReason, "budget-exhausted");
  assert.equal(besitzer.anrufHierBewacht(call.id), false);
});
