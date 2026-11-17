import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const MANDANT = "t_h7a_ohne_zeile";

async function instanzMitAnruf() {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [MANDANT]);
  const call = store.createCall({
    direction: "outbound",
    from: "+4930555000388",
    to: "+4915112349988",
    goal: "Test",
    tenantId: MANDANT,
    provider: "telnyx",
  });
  await store.persistCall(call.id);
  await db.query("DELETE FROM call WHERE id = $1", [call.id]);
  return { store, call };
}

test("H7a-13: fehlt die Zeile in der Datenbank, zaehlt der Stille-Zaehler im Spiegel weiter statt zu werfen", async () => {
  const { store, call } = await instanzMitAnruf();
  assert.equal(await store.countNoSpeechTurn(call.id), 1);
  assert.equal(await store.countNoSpeechTurn(call.id), 2);
  assert.equal(store.getCall(call.id).noSpeechStreak, 2);
});

test("H7a-14: fehlt die Zeile in der Datenbank, zaehlt der Recherche-Zaehler im Spiegel weiter statt zu werfen", async () => {
  const { store, call } = await instanzMitAnruf();
  assert.equal(await store.countCallLookup(call.id), 1);
  assert.equal(store.getCall(call.id).lookups, 1);
});
