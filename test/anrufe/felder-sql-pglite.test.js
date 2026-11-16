import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_fsql_kunde";
const FREMD = "t_fsql_fremd";
const ZIEL = "+4915112349933";
const ISO = /^\d{4}-\d\d-\d\dT/;

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

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

async function legeAn(store) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await store.persistCall(call.id);
  return call;
}

async function zeile(db, tenantId, callId) {
  await setzeKontext(db, tenantId);
  const { rows } = await db.query(
    `SELECT summary_sms_sent_at, summary_mail_sent_at, not_placed_mail_sent_at, billed_at, inbox_entry_at,
            webhook_anchors, estimated_cost_cents, estimated_cost_spend_month_key, estimated_cost_period_key,
            cost_truing_attempts, actual_cost_micro_cents, cost_trued_source, cost_trued_at, el_detector_counts
       FROM call WHERE id = $1`,
    [callId],
  );
  return rows[0];
}

const ZEITMARKEN = [
  ["markSummarySmsSent", "summarySmsSentAt", "summary_sms_sent_at"],
  ["markSummaryMailSent", "summaryMailSentAt", "summary_mail_sent_at"],
  ["markNotPlacedMailSent", "notPlacedMailSentAt", "not_placed_mail_sent_at"],
  ["markBilled", "billedAt", "billed_at"],
];

test("FELDER-1: Versandmarken und Abrechnungsmarke stehen nach dem Warten in der Datenbank und bleiben beim zweiten Aufruf beim ersten Wert", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  for (const [name, feld, spalte] of ZEITMARKEN) {
    const ergebnis = await a[name](call.id);
    const erster = (await zeile(db, KUNDE, call.id))[spalte];
    assert.equal(erster, ergebnis[feld], name);
    assert.match(erster, ISO, name);
    a.getCall(call.id)[feld] = null;
    await a[name](call.id);
    assert.equal((await zeile(db, KUNDE, call.id))[spalte], erster, name);
  }
});

test("FELDER-2: markInboxEntry schreibt nur fuer einen Anruf, der in den Posteingang gehoert, einmal", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  assert.equal(await a.markInboxEntry(call.id, false), null);
  assert.equal((await zeile(db, KUNDE, call.id)).inbox_entry_at, null);
  const ergebnis = await a.markInboxEntry(call.id, true);
  assert.equal((await zeile(db, KUNDE, call.id)).inbox_entry_at, ergebnis.inboxEntryAt);
  assert.match(ergebnis.inboxEntryAt, ISO);
});

test("FELDER-3: recordWebhookAnchors haengt neue Anker an, ohne Doppelte, und die Datenbank hat sie", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.recordWebhookAnchors(call.id, ["anker-1"]);
  await a.recordWebhookAnchors(call.id, ["anker-1", "anker-2"]);
  assert.deepEqual((await zeile(db, KUNDE, call.id)).webhook_anchors, ["anker-1", "anker-2"]);
  assert.deepEqual(a.getCall(call.id).webhookAnchors, ["anker-1", "anker-2"]);
});

test("FELDER-4: recordCallEstimatedCostCents schreibt Betrag und Buchungsanker einmal", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  const anker = { spendMonthKey: "2030-01", periodKey: "2030-01-01" };
  await a.recordCallEstimatedCostCents(call.id, { costCents: 42, chargeAnchors: anker });
  await a.recordCallEstimatedCostCents(call.id, { costCents: 99, chargeAnchors: { spendMonthKey: "x", periodKey: "y" } });
  const spalten = await zeile(db, KUNDE, call.id);
  assert.deepEqual(
    [spalten.estimated_cost_cents, spalten.estimated_cost_spend_month_key, spalten.estimated_cost_period_key],
    [42, "2030-01", "2030-01-01"],
  );
});

test("FELDER-5: recordCallCostTruingResult schreibt Versuch, Ist-Kosten, Quelle und Abschluss, und ein abgeschlossener Abgleich bleibt stehen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  const offen = await a.recordCallCostTruingResult(call.id, { source: "incomplete", actualCostMicroCents: 1234, closedAt: null });
  assert.equal(offen.costTruingAttempts, 1);
  let spalten = await zeile(db, KUNDE, call.id);
  assert.deepEqual(
    [spalten.cost_truing_attempts, Number(spalten.actual_cost_micro_cents), spalten.cost_trued_source, spalten.cost_trued_at],
    [1, 1234, "incomplete", null],
  );
  await a.recordCallCostTruingResult(call.id, { source: "telnyx_detail_records", actualCostMicroCents: 5678, closedAt: "2030-01-02T03:04:05.000Z" });
  await a.recordCallCostTruingResult(call.id, { source: "unavailable", actualCostMicroCents: 1, closedAt: "2031-01-02T03:04:05.000Z" });
  spalten = await zeile(db, KUNDE, call.id);
  assert.deepEqual(
    [spalten.cost_truing_attempts, Number(spalten.actual_cost_micro_cents), spalten.cost_trued_source, spalten.cost_trued_at],
    [2, 5678, "telnyx_detail_records", "2030-01-02T03:04:05.000Z"],
  );
});

test("FELDER-6: recordElDetectorCounts steht in der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await a.recordElDetectorCounts(call.id, { elTags: 2, elB1: 1 });
  assert.deepEqual((await zeile(db, KUNDE, call.id)).el_detector_counts, { elTags: 2, elB1: 1 });
});

test("FELDER-7: eine zweite Instanz sieht die Felder sofort, und Mandant Fremd sieht die Zeile nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await setzeKontext(db, FREMD);
  const ergebnis = await a.markBilled(call.id);
  assert.equal(await zeile(db, FREMD, call.id), undefined);
  assert.equal((await b.attachActiveCall(call.id)).billedAt, ergebnis.billedAt);
});

test("FELDER-8: ein Schreibfehler wirft und stellt jedes Feld im Spiegel wieder her", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  await db.exec("ALTER TABLE call RENAME TO call_versteckt");
  await assert.rejects(a.markSummarySmsSent(call.id));
  await assert.rejects(a.markSummaryMailSent(call.id));
  await assert.rejects(a.markNotPlacedMailSent(call.id));
  await assert.rejects(a.markBilled(call.id));
  await assert.rejects(a.markInboxEntry(call.id, true));
  await assert.rejects(a.recordWebhookAnchors(call.id, ["anker-1"]));
  await assert.rejects(a.recordCallEstimatedCostCents(call.id, { costCents: 5, chargeAnchors: { spendMonthKey: "m", periodKey: "p" } }));
  await assert.rejects(a.recordCallCostTruingResult(call.id, { source: "incomplete", actualCostMicroCents: 7, closedAt: "2030-01-02T03:04:05.000Z" }));
  await assert.rejects(a.recordElDetectorCounts(call.id, { elTags: 1, elB1: 1 }));
  const danach = a.getCall(call.id);
  assert.deepEqual(
    [
      danach.summarySmsSentAt, danach.summaryMailSentAt, danach.notPlacedMailSentAt, danach.billedAt, danach.inboxEntryAt,
      danach.webhookAnchors, danach.estimatedCostCents, danach.estimatedCostSpendMonthKey, danach.estimatedCostPeriodKey,
      danach.costTruingAttempts, danach.actualCostMicroCents, danach.costTruedSource, danach.costTruedAt, danach.elDetectorCounts,
    ].map((wert) => wert ?? null),
    [null, null, null, null, null, [], null, null, null, 0, null, null, null, null],
  );
});

test("FELDER-9: ein unbekannter Anruf liefert wie bisher nichts und schreibt nichts", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  assert.equal(await a.markSummarySmsSent("call_unbekannt"), null);
  assert.equal(await a.markBilled("call_unbekannt"), null);
  assert.equal(await a.recordWebhookAnchors("call_unbekannt", ["x"]), null);
  assert.equal(await a.recordCallEstimatedCostCents("call_unbekannt", { costCents: 1, chargeAnchors: {} }), null);
  assert.equal(await a.recordCallCostTruingResult("call_unbekannt", { source: "incomplete", actualCostMicroCents: 1, closedAt: null }), null);
  assert.equal(await a.recordElDetectorCounts("call_unbekannt", { elTags: 1, elB1: 1 }), null);
});

test("FELDER-10: eine Instanz mit altem Stand ueberschreibt eine Marke einer anderen Instanz nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await b.attachActiveCall(call.id);
  await a.markBilled(call.id);
  await a.markInboxEntry(call.id, true);
  await a.recordCallEstimatedCostCents(call.id, { costCents: 3, chargeAnchors: { spendMonthKey: "m1", periodKey: "p1" } });
  const erste = await zeile(db, KUNDE, call.id);
  await b.markBilled(call.id);
  await b.markInboxEntry(call.id, true);
  await b.recordCallEstimatedCostCents(call.id, { costCents: 9, chargeAnchors: { spendMonthKey: "m2", periodKey: "p2" } });
  assert.deepEqual(await zeile(db, KUNDE, call.id), erste);
});
