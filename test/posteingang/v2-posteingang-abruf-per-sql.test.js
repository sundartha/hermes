import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makePgStore,
  BOOTSTRAP_TENANT_ID,
  makePgTestStore,
  legeMandantAn,
  pgliteAlsRolleOhneSuperuser,
} from "../pg-helpers.js";

function runnerFuer(db, vorQuery = () => {}) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          vorQuery(text);
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function markierterAnruf({ tenantId = BOOTSTRAP_TENANT_ID, vorQuery } = {}) {
  const { store: a, db } = await makePgTestStore();
  const b = makePgStore(runnerFuer(db, vorQuery));
  await b.init();
  const call = a.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId });
  await a.persistCall(call.id);
  a.markInboxEntry(call.id, true);
  await a.drainFlushes();
  return { a, b, db, callId: call.id };
}

test("Der Posteingang von B liefert den markierten Anruf von A samt offenem Punkt", async () => {
  const { a, b, callId } = await markierterAnruf();
  await a.addActionItem(callId, "Rueckruf bei Meier", "todo");
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => [e.call_id, e.caller, e.action_items]), [
    [callId, "+4915112345678", ["Rueckruf bei Meier"]],
  ]);
  assert.equal(seite.remaining, 0);
  assert.equal(seite.marked, 1);
});

test("Ein zweiter Abruf liefert den Anruf nicht mehr, die Marke steht in der Datenbank", async () => {
  const { a, b, db, callId } = await markierterAnruf();
  await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  const [{ inbox_seen_at: marke }] = (await db.query(`SELECT inbox_seen_at FROM call WHERE id = $1`, [callId])).rows;
  assert.match(marke, /^\d{4}-\d\d-\d\dT/);
  const zweiter = await a.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(zweiter.entries, []);
  assert.equal(zweiter.marked, 0);
  await a.drainFlushes();
  assert.equal((await db.query(`SELECT inbox_seen_at FROM call WHERE id = $1`, [callId])).rows[0].inbox_seen_at, marke);
});

test("Mit includeSeen kommt der gesehene Anruf wieder und die Marke bleibt unveraendert", async () => {
  const { a, b, db, callId } = await markierterAnruf();
  await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  await a.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  const davor = (await db.query(`SELECT inbox_seen_at FROM call WHERE id = $1`, [callId])).rows[0].inbox_seen_at;
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [callId]);
  assert.equal(seite.marked, 0);
  assert.equal((await db.query(`SELECT inbox_seen_at FROM call WHERE id = $1`, [callId])).rows[0].inbox_seen_at, davor);
  const eigener = await a.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(eigener.entries.map((e) => e.call_id), [callId]);
});

test("Das Limit schneidet nach Anrufbeginn, remaining zaehlt den Rest", async () => {
  const { a, b, db } = await markierterAnruf();
  const zweiter = a.createCall({ direction: "inbound", from: "+4915199999999", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(zweiter.id);
  a.markInboxEntry(zweiter.id, true);
  await a.drainFlushes();
  await db.query(`UPDATE call SET started_at = '2020-01-01T00:00:00.000Z' WHERE id = $1`, [zweiter.id]);
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 1, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [zweiter.id]);
  assert.equal(seite.remaining, 1);
});

test("Hat eine andere Instanz den Anruf zwischen Lesen und Markieren geliefert, liefert B ihn nicht und ueberschreibt die Marke nicht", async () => {
  let eingriff = null;
  const { b, db, callId } = await markierterAnruf({
    vorQuery: (text) => {
      if (/UPDATE call SET inbox_seen_at/.test(text)) eingriff?.();
    },
  });
  eingriff = () => {
    eingriff = null;
    db.query(`UPDATE call SET inbox_seen_at = 'FRUEHER' WHERE id = $1`, [callId]);
  };
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(seite.entries, []);
  assert.equal(seite.marked, 0);
  assert.equal((await db.query(`SELECT inbox_seen_at FROM call WHERE id = $1`, [callId])).rows[0].inbox_seen_at, "FRUEHER");
});

test("Ein Anruf, den nur der eigene Spiegel markiert hat, kommt einmal und ist danach gesehen", async () => {
  const { store } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.markInboxEntry(call.id, true);
  const erster = await store.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(erster.entries.map((e) => e.call_id), [call.id]);
  assert.equal(erster.marked, 1);
  const zweiter = await store.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(zweiter.entries, []);
  assert.equal(zweiter.remaining, 0);
  assert.equal(zweiter.marked, 0);
});

test("Schlaegt das Lesen fehl, wirft der Abruf und liefert keine leere Seite", async () => {
  let kaputt = false;
  const { b } = await markierterAnruf({
    vorQuery: (text) => {
      if (kaputt && /FROM call WHERE tenant_id = \$1 AND inbox_entry_at/.test(text)) throw new Error("Lesefehler");
    },
  });
  kaputt = true;
  await assert.rejects(() => b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false }), /Lesefehler/);
});

test("Mandant X sieht keinen Eintrag von Mandant Y", async () => {
  const { store: a, db } = await makePgTestStore();
  await legeMandantAn(a, "mandant-y");
  const b = makePgStore(runnerFuer(db));
  await b.init();
  const call = a.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: "mandant-y" });
  await a.persistCall(call.id);
  a.markInboxEntry(call.id, true);
  await a.drainFlushes();
  const fuerX = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(fuerX.entries, []);
  const fuerY = await b.takeInboxEntries("mandant-y", { limit: 5, includeSeen: true });
  assert.deepEqual(fuerY.entries.map((e) => e.call_id), [call.id]);
});

test("Ohne Superuser-Rechte bleibt die Trennung der Mandanten bestehen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = makePgStore(runnerFuer(db));
  await a.init();
  await db.query(`SELECT set_config('app.current_tenant', 'mandant-y', false)`);
  await db.query(`INSERT INTO tenant (id, status) VALUES ('mandant-y', 'active')`);
  const b = makePgStore(runnerFuer(db));
  await b.init();
  const call = a.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: "mandant-y" });
  await a.persistCall(call.id);
  a.markInboxEntry(call.id, true);
  await a.drainFlushes();
  const fuerX = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(fuerX.entries, []);
  const fuerY = await b.takeInboxEntries("mandant-y", { limit: 5, includeSeen: true });
  assert.deepEqual(fuerY.entries.map((e) => e.call_id), [call.id]);
});
