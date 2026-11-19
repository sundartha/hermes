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

async function markeVon(db, callId) {
  const { rows } = await db.query(`SELECT inbox_seen_at FROM call WHERE id = $1`, [callId]);
  return rows[0].inbox_seen_at;
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
  const marke = await markeVon(db, callId);
  assert.match(marke, /^\d{4}-\d\d-\d\dT/);
  const zweiter = await a.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(zweiter.entries, []);
  assert.equal(zweiter.marked, 0);
  await a.drainFlushes();
  assert.equal(await markeVon(db, callId), marke);
});

test("Mit includeSeen kommt der gesehene Anruf wieder und die Marke bleibt unveraendert", async () => {
  const { a, b, db, callId } = await markierterAnruf();
  await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  await a.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  const davor = await markeVon(db, callId);
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [callId]);
  assert.equal(seite.marked, 0);
  assert.equal(await markeVon(db, callId), davor);
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
  assert.equal(await markeVon(db, callId), "FRUEHER");
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

test("Zwei gleichzeitige Abrufe liefern einen nur im Spiegel markierten Anruf nur einmal", async () => {
  const { store } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.markInboxEntry(call.id, true);
  const seiten = await Promise.all([
    store.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false }),
    store.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false }),
  ]);
  assert.deepEqual(seiten.flatMap((seite) => seite.entries.map((e) => e.call_id)), [call.id]);
  assert.equal(seiten.reduce((summe, seite) => summe + seite.marked, 0), 1);
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

test("Mit includeSeen kommt ein ungesehener Anruf ohne Marke, danach liefert der Abruf ohne includeSeen ihn genau einmal", async () => {
  const { b, db, callId } = await markierterAnruf();
  await b.init();
  const mitSeen = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(mitSeen.entries.map((e) => e.call_id), [callId]);
  assert.equal(mitSeen.marked, 0);
  assert.equal(await markeVon(db, callId), null);
  const ohneSeen = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(ohneSeen.entries.map((e) => e.call_id), [callId]);
  assert.equal(ohneSeen.marked, 1);
  const dritter = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(dritter.entries, []);
});

test("Mit includeSeen bleibt ein nur im Spiegel markierter Anruf ungesehen und kommt danach genau einmal", async () => {
  const { store } = await makePgTestStore();
  const call = store.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.markInboxEntry(call.id, true);
  const mitSeen = await store.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(mitSeen.entries.map((e) => e.call_id), [call.id]);
  assert.equal(mitSeen.marked, 0);
  assert.equal(store.getCall(call.id).inboxSeenAt ?? null, null);
  const ohneSeen = await store.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(ohneSeen.entries.map((e) => e.call_id), [call.id]);
  assert.equal(ohneSeen.marked, 1);
});

test("Gleicher Anrufbeginn: die Anrufe kommen in der Reihenfolge ihrer Anlage", async () => {
  const { a, b, db, callId } = await markierterAnruf();
  const zweiter = a.createCall({ direction: "inbound", from: "+4915199999999", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(zweiter.id);
  a.markInboxEntry(zweiter.id, true);
  await a.drainFlushes();
  await db.query(`UPDATE call SET started_at = '2021-05-05T10:00:00.000Z'`);
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [callId, zweiter.id]);
});

function spiegelAnruf(store, startedAt, { marke = true } = {}) {
  const call = store.createCall({ direction: "inbound", from: "+4915177777777", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  call.startedAt = startedAt;
  if (marke) store.markInboxEntry(call.id, true);
  return call;
}

test("Ein nur im Spiegel markierter Anruf mit frueherem Beginn kommt vor dem Datenbank-Anruf, der spaetere zaehlt in remaining", async () => {
  const { b, callId } = await markierterAnruf();
  const frueh = spiegelAnruf(b, "2001-01-01T00:00:00.000Z");
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 1, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [frueh.id]);
  assert.equal(seite.remaining, 1);
  assert.notEqual(frueh.id, callId);
});

test("Ein nur im Spiegel markierter Anruf mit spaeterem Beginn kommt nach zwei Datenbank-Anrufen und zaehlt in remaining", async () => {
  const { a, b, db, callId } = await markierterAnruf();
  const zweiter = a.createCall({ direction: "inbound", from: "+4915199999999", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await a.persistCall(zweiter.id);
  a.markInboxEntry(zweiter.id, true);
  await a.drainFlushes();
  await db.query(`UPDATE call SET started_at = '2001-01-01T00:00:00.000Z' WHERE id = $1`, [zweiter.id]);
  await db.query(`UPDATE call SET started_at = '2002-01-01T00:00:00.000Z' WHERE id = $1`, [callId]);
  await b.init();
  const spaet = spiegelAnruf(b, "2099-01-01T00:00:00.000Z");
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 2, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [zweiter.id, callId]);
  assert.equal(seite.remaining, 1);
  assert.notEqual(spaet.id, callId);
});

test("Ein Spiegel-Anruf ohne Posteingangs-Marke taucht in keinem Abruf auf", async () => {
  const { b, callId } = await markierterAnruf();
  const ohne = spiegelAnruf(b, "2001-01-01T00:00:00.000Z", { marke: false });
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [callId]);
  assert.equal(seite.marked, 1);
  assert.equal(seite.remaining, 0);
  const mitSeen = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: true });
  assert.deepEqual(mitSeen.entries.map((e) => e.call_id), [callId]);
  assert.notEqual(ohne.id, callId);
});

test("Ein nur im Spiegel markierter und dort gesehener Anruf wird ohne includeSeen weder geliefert noch gezaehlt", async () => {
  const { b, callId } = await markierterAnruf();
  const gesehen = spiegelAnruf(b, "2001-01-01T00:00:00.000Z");
  gesehen.inboxSeenAt = "2001-01-02T00:00:00.000Z";
  const seite = await b.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 1, includeSeen: false });
  assert.deepEqual(seite.entries.map((e) => e.call_id), [callId]);
  assert.equal(seite.remaining, 0);
  assert.equal(seite.marked, 1);
});

test("Setzt der Spiegel die Marke waehrend des Markierens selbst, bleibt sein Zeitstempel erhalten", async () => {
  let eingriff = null;
  const { db } = await makePgTestStore();
  const eigener = makePgStore(runnerFuer(db, (text) => {
    if (/UPDATE call SET inbox_seen_at/.test(text)) eingriff?.();
  }));
  await eigener.init();
  const call = eigener.createCall({ direction: "inbound", from: "+4915112345678", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await eigener.persistCall(call.id);
  eigener.markInboxEntry(call.id, true);
  await eigener.drainFlushes();
  eingriff = () => {
    eingriff = null;
    eigener.getCall(call.id).inboxSeenAt = "2001-01-02T00:00:00.000Z";
  };
  const seite = await eigener.takeInboxEntries(BOOTSTRAP_TENANT_ID, { limit: 5, includeSeen: false });
  assert.equal(seite.marked, 1);
  assert.equal(eigener.getCall(call.id).inboxSeenAt, "2001-01-02T00:00:00.000Z");
});
