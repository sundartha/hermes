import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_zsql_kunde";
const FREMD = "t_zsql_fremd";
const ZIEL = "+4915112349911";
const ANDERES_ZIEL = "+4915112349912";
const SEIT_FRUEH = "2000-01-01T00:00:00.000Z";
const GRENZE = "2026-06-01T10:00:00.000Z";
const VOR_DER_GRENZE = "2026-06-01T09:59:59.999Z";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) =>
  db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function mitKunden(db) {
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  return neueInstanz(db);
}

async function legeAn(store, { tenantId, to, requestedBy = null }) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to, goal: "Test", tenantId, requestedBy });
  await store.persistCall(call.id);
  return call;
}

test("ZAEHLUNG-3R: die Zaehlung filtert nach Mandant, setzt den Kontext selbst und liefert unter fremdem Kontext dasselbe", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = await mitKunden(db);
  await legeAn(store, { tenantId: KUNDE, to: ZIEL });
  await legeAn(store, { tenantId: KUNDE, to: ANDERES_ZIEL });
  await legeAn(store, { tenantId: FREMD, to: ZIEL });
  for (const kontext of [BOOTSTRAP_TENANT_ID, FREMD, KUNDE]) {
    await setzeKontext(db, kontext);
    assert.equal(await store.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE }), 2);
    assert.equal(await store.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE, to: ZIEL }), 1);
    assert.equal(await store.countOutboundCallsSince(SEIT_FRUEH, { tenantId: FREMD }), 1);
  }
});

test("ZAEHLUNG-3S: ohne Mandant wird nicht gezaehlt, sondern abgelehnt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = await mitKunden(db);
  await assert.rejects(store.countOutboundCallsSince(SEIT_FRUEH, {}), /tenantId/);
});

test("ZAEHLUNG-5S: ein bestaetigt angelegter Anruf steht auf einer zweiten Instanz derselben Datenbank sofort in der Zaehlung", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  assert.equal(await b.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE }), 0);
  await legeAn(a, { tenantId: KUNDE, to: ZIEL, requestedBy: "kunde" });
  assert.equal(await b.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE }), 1);
  assert.equal(await b.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE, requestedBy: "kunde" }), 1);
  assert.equal(await b.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE, requestedBy: "andere" }), 0);
});

test("ZAEHLUNG-4S: ein Datenbankfehler beim Anlegen oder Zaehlen wirft, statt 0 oder einen Anruf vorzutaeuschen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = await mitKunden(db);
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await db.exec("ALTER TABLE call RENAME TO call_versteckt");
  await assert.rejects(store.persistCall(call.id));
  assert.equal(store.getCall(call.id), null);
  await assert.rejects(store.countOutboundCallsSince(SEIT_FRUEH, { tenantId: KUNDE }));
});

test("ZAEHLUNG-6: eingehende Anrufe zaehlen nicht, ein Anruf genau zur Fenstergrenze zaehlt, einer davor nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = await mitKunden(db);
  const eingehend = store.createCall({ direction: "inbound", from: ZIEL, to: "+4930555000300", tenantId: KUNDE });
  await store.persistCall(eingehend.id);
  const genau = await legeAn(store, { tenantId: KUNDE, to: ZIEL });
  const davor = await legeAn(store, { tenantId: KUNDE, to: ZIEL });
  await setzeKontext(db, KUNDE);
  await db.query(`UPDATE call SET started_at = $2 WHERE id = $1`, [genau.id, GRENZE]);
  await db.query(`UPDATE call SET started_at = $2 WHERE id = $1`, [davor.id, VOR_DER_GRENZE]);
  assert.equal(await store.countOutboundCallsSince(GRENZE, { tenantId: KUNDE }), 1);
});
