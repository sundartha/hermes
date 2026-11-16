import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { seedState } from "../helpers.js";
import { baueElMitStore, baueStore, makeAnbieter, mitAnbieter, okAntwort } from "../_iel-inbound-harness.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_luecke_kunde";
const FREMD = "t_luecke_fremd";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function mitKunden(db) {
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [id]);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  return neueInstanz(db);
}

test("lesen-sql-luecken: zeigt die Schluesselzeile auf einen fremden Mandanten, liefert leseCall null statt zu werfen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000300", to: "+4915112349944", goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  await db.query(`UPDATE anruf_schluessel SET tenant_id = $1 WHERE call_id = $2`, [FREMD, call.id]);
  assert.equal(await b.leseCall(call.id), null);
});

test("lesen-sql-luecken: ein Lesefehler wird mit dem Meldungstext des Lesewegs geloggt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000300", to: "+4915112349944", goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  await db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");
  const fehlerlog = mock.method(console, "error", () => {});
  await assert.rejects(b.leseCall(call.id), /anruf_schluessel/);
  fehlerlog.mock.restore();
  const { calls } = fehlerlog.mock;
  const [meldung] = calls[0].arguments;
  assert.match(meldung, /^\[pg\] leseCall fehlgeschlagen:$/);
});

test("lesen-sql-luecken: das Ergebnis eines unbekannten eingehenden Anrufs abzuholen endet still ohne Anbieter-Abruf", async () => {
  const state = seedState({ calls: [] });
  const anbieter = makeAnbieter(async () => okAntwort({}));
  const store = { ...baueStore(state, { detektorZaehlungen: [] }), leseCall: async (id) => state.calls.find((c) => c.id === id) ?? null };
  const el = baueElMitStore(store);
  await mitAnbieter({ state, anbieter }, async () => {
    assert.equal(await el.awaitAndPersistInboundElResult("call_gibt_es_nicht"), undefined);
  });
  assert.equal(anbieter.gets, 0);
});
