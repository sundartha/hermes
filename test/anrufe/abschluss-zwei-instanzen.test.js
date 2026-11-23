import assert from "node:assert/strict";
import { test } from "node:test";

import { elevenlabsOutbound } from "../../src/elevenlabs/registry.ts";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { waitUntil, withFetch } from "../helpers.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const MANDANT = "t_abschluss_kunde";
const ZIEL = "+4915112346139";
const ABSENDER = "+4930555006139";
const EMPFAENGER = "kunde@example.test";
const KONVERSATION = "conv_abschluss_6139";
const HTTP_OK = 200;
const LAUFZEIT_S = 60;
const GESPRAECH = {
  conversation_id: KONVERSATION,
  status: "done",
  transcript: [{ role: "agent", message: "Alles klar, bis dann." }],
  analysis: { call_successful: "success", transcript_summary: "Termin vereinbart." },
  metadata: { call_duration_secs: LAUFZEIT_S, termination_reason: "Client disconnected: 1000", error: null },
};

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const terminateAndBillCall = async ({ persistEnd, bill }) => {
  await persistEnd();
  await bill();
};
const billThunk = (finishCall, store, callId) => () => finishCall(store.getCall(callId));

async function neueInstanz(db) {
  const pgStore = makePgStoreMitSperre(runnerFuer(db));
  await pgStore.init();
  const freigegeben = [];
  const gesendet = [];
  const abgerechnet = [];
  const mails = [];
  const store = {
    ...pgStore,
    setzeAbfrageFrist: async () => {},
    leitungsplaetze: { freigeben: (id) => freigegeben.push(id) },
    releaseOutboundReserve: async () => {},
    recordUsageEvent: () => {},
    confirmedNewsletterRecipients: () => [{ email: EMPFAENGER, unsubToken: null }],
  };
  const { finishCall } = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: async (call) => abgerechnet.push(call.id) },
    messaging: () => ({ sendSms: async ({ body }) => gesendet.push(body) }),
    summarizeCall: async () => ({ summary: "Termin vereinbart.", actionItems: [] }),
    planSummarySms: () => ({ send: true, to: ZIEL, smsFrom: { e164: ABSENDER } }),
    mailer: { sendMail: async ({ to }) => mails.push(to) },
    audit: () => {},
  });
  const el = elevenlabsOutbound().makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test", resultPollMs: 5 } }),
    terminateAndBillCall,
    billThunk,
    finishCall,
  });
  return { store, el, freigegeben, gesendet, abgerechnet, mails };
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [MANDANT]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  call.elevenlabsConversationId = KONVERSATION;
  await a.store.persistCall(call.id);
  await a.store.markAnswered(call.id);
  await b.store.attachActiveCall(call.id);
  return { db, a, b, callId: call.id };
}

async function schliesseAb(instanz, callId) {
  await withFetch(
    async () => ({ ok: true, status: HTTP_OK, json: async () => GESPRAECH }),
    async () => {
      await instanz.el.abfrageDurchLauf(callId);
      await waitUntil(() => instanz.freigegeben.includes(callId));
    },
  );
}

const grundDerZeile = async (db, callId) => {
  const { rows } = await db.query(`SELECT failure_reason FROM call WHERE id = $1`, [callId]);
  return rows[0].failure_reason;
};

const zeile = async (db, callId) => {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  return (await db.query(`SELECT status, ended_at FROM call WHERE id = $1`, [callId])).rows[0];
};

test("Abschluss in der Datenbank: zwei Instanzen schliessen denselben Anruf ab, Abrechnung und Zusammenfassung laufen genau einmal", async () => {
  const { a, b, callId } = await aufbau();
  await schliesseAb(a, callId);
  await schliesseAb(b, callId);
  assert.equal(a.gesendet.length + b.gesendet.length, 1);
  assert.deepEqual([...a.abgerechnet, ...b.abgerechnet], [callId]);
  assert.deepEqual([...a.mails, ...b.mails], [EMPFAENGER]);
});

test("Abschluss in der Datenbank: die Instanz, die das Ende gewinnt, schliesst wie bisher ab", async () => {
  const { db, a, callId } = await aufbau();
  await schliesseAb(a, callId);
  assert.equal(a.gesendet.length, 1);
  assert.deepEqual(a.mails, [EMPFAENGER]);
  assert.deepEqual(a.abgerechnet, [callId]);
  const gespeichert = await zeile(db, callId);
  assert.equal(gespeichert.status, "completed");
  assert.equal(gespeichert.ended_at, a.store.getCall(callId).endedAt);
});

test("Abschluss in der Datenbank: die verlierende Instanz ruft keinen Abschluss auf und schreibt nichts", async () => {
  const { db, a, b, callId } = await aufbau();
  await a.store.setCallEndedAt(callId, "failed", "2031-01-02T03:04:05.000Z");
  await schliesseAb(b, callId);
  assert.equal(b.gesendet.length, 0);
  assert.deepEqual(b.mails, []);
  assert.deepEqual(b.abgerechnet, []);
  const gespeichert = await zeile(db, callId);
  assert.equal(gespeichert.status, "failed");
  assert.equal(gespeichert.ended_at, "2031-01-02T03:04:05.000Z");
});

test("Abschluss in der Datenbank: der Spiegel der verlierenden Instanz zeigt Status und Ende des Gewinners", async () => {
  const { a, b, callId } = await aufbau();
  await a.store.setCallEndedAt(callId, "failed", "2031-01-02T03:04:05.000Z");
  await schliesseAb(b, callId);
  const gespiegelt = b.store.getCall(callId);
  assert.equal(gespiegelt.status, "failed");
  assert.equal(gespiegelt.endedAt, "2031-01-02T03:04:05.000Z");
});

test("Abschluss in der Datenbank: ein Speichern der eigenen Instanz vor dem Ende macht sie nicht zur Verliererin", async () => {
  const { db, a, callId } = await aufbau();
  const speichern = a.store.save();
  await a.store.setCallEndedAt(callId, "completed", "2031-02-03T04:05:06.000Z");
  await speichern;
  await a.store.drainFlushes();
  const gespeichert = await zeile(db, callId);
  assert.equal(gespeichert.status, "completed");
  assert.equal(gespeichert.ended_at, "2031-02-03T04:05:06.000Z");
  assert.equal(a.store.getCall(callId).status, "completed");
});

test("Abschluss in der Datenbank: ein Speichern waehrend des ausstehenden Endes zeigt Grund und Status nie gemischt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [MANDANT]);
  const beobachtet = [];
  const beobachter = {
    query: async (text, params) => {
      const ergebnis = await db.query(text, params);
      if (/INSERT INTO call[\s(]/.test(text))
        beobachtet.push((await db.query(`SELECT status, failure_reason FROM call WHERE id = $1`, [params[0]])).rows[0]);
      return ergebnis;
    },
    exec: (sql) => db.exec(sql),
  };
  const a = await neueInstanz(beobachter);
  const call = a.store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  await a.store.persistCall(call.id);
  call.failureReason = "el_uebergabe_gescheitert";
  const speichern = a.store.save();
  await a.store.setCallEndedAt(call.id, "failed", "2031-03-04T05:06:07.000Z");
  await speichern;
  await a.store.drainFlushes();
  assert.ok(beobachtet.length > 0);
  assert.deepEqual(
    beobachtet.filter((stand) => stand.failure_reason !== null && stand.status === "active"),
    [],
  );
  assert.deepEqual(await zeile(db, call.id), { status: "failed", ended_at: "2031-03-04T05:06:07.000Z" });
  assert.equal(await grundDerZeile(db, call.id), "el_uebergabe_gescheitert");
});

test("Abschluss in der Datenbank: ein Speichern ohne ausstehendes Ende schreibt den Grund des Spiegels", async () => {
  const { db, a, callId } = await aufbau();
  a.store.getCall(callId).failureReason = "el_uebergabe_gescheitert";
  await a.store.save();
  await a.store.drainFlushes();
  assert.equal(await grundDerZeile(db, callId), "el_uebergabe_gescheitert");
});

test("Abschluss in der Datenbank: ein Speichern nach geschriebenem Ende schreibt den Grund und laesst das Ende stehen", async () => {
  const { db, a, callId } = await aufbau();
  await a.store.setCallEndedAt(callId, "failed", "2031-04-05T06:07:08.000Z");
  a.store.getCall(callId).failureReason = "el_uebergabe_gescheitert";
  await a.store.save();
  await a.store.drainFlushes();
  assert.equal(await grundDerZeile(db, callId), "el_uebergabe_gescheitert");
  assert.deepEqual(await zeile(db, callId), { status: "failed", ended_at: "2031-04-05T06:07:08.000Z" });
});

test("Abschluss in der Datenbank: ein Ende mit eigener Zeit auf der verlierenden Instanz zeigt Status und Ende des Gewinners", async () => {
  const { db, a, b, callId } = await aufbau();
  await a.store.setCallEndedAt(callId, "failed", "2031-01-02T03:04:05.000Z");
  await b.store.setCallEndedAt(callId, "completed", "2032-06-07T08:09:10.000Z");
  const gespiegelt = b.store.getCall(callId);
  assert.equal(gespiegelt.status, "failed");
  assert.equal(gespiegelt.endedAt, "2031-01-02T03:04:05.000Z");
  const gespeichert = await zeile(db, callId);
  assert.equal(gespeichert.status, "failed");
});
