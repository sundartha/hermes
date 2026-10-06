import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCostTruing, SWEEP_TRIGGER, PROVIDER_COST_RECORD_WINDOW_MS } from "../src/billing/cost-truing.js";
import { kostenBuchBericht, KOSTEN_BEFUND } from "../src/billing/kosten-deckung.js";
import { KOSTENART, KOSTENPROFIL } from "../src/billing/kostenarten.js";
import {
  makeDefaultState, createCall, recordCallCostEvidence, usageFor, openOutageAlert, bindPlatformNumber,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PLATFORM_NUMBER_PURPOSE, REIFE, COST_TRUING_SOURCE } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, fakeVoiceControl } from "./cost-truing-harness.js";

const MINUTE_MS = 60_000;
const STANDARD_DELAY_MIN = 5;
const STANDARD_SWEEP_INTERVAL_MS = MINUTE_MS;
const HEARTBEAT_FENSTER_H = 6;
const MIN_COVERAGE_PERCENT = 80;
const LANGE_KARENZ_DELAY_MIN = 25;
const LANGE_KARENZ_SWEEP_INTERVAL_MIN = 5;
const LANGE_KARENZ_SWEEP_INTERVAL_MS = LANGE_KARENZ_SWEEP_INTERVAL_MIN * MINUTE_MS;

const DREI_STUNDEN_MIN = 180;
const ZEHN_MINUTEN = 10;
const SIEBEN_TAGE_MIN = 10_080;

const FUENF = 5;
const SIEBEN = 7;
const VIER = 4;
const DREI = 3;

const STANDARD_ESTIMATE_CENTS = 30;
const ERWARTETER_USAGE_CENTS = 500;

const SMS_ZIEL = "+491234567890";
const MAIL_ZIEL = "ops@example.test";
const BOOTSTRAP_SENDER_E164 = "+15005550006";
const GEHEIME_TENANT_ID = "t_geheimer_tenant_123";
const GEHEIME_RUFNUMMER = "+4915155512345";

const COST_TRUING_AUDIT_EVENT = "cost_truing_befund";

const kostenMarkerCode = (code) => `kosten:${code}`;

function testConfig(overrides = {}) {
  return fakeConfig({
    costTruingDelayMinutes: STANDARD_DELAY_MIN,
    costTruingSweepIntervalMs: STANDARD_SWEEP_INTERVAL_MS,
    kostenHeartbeatFensterH: HEARTBEAT_FENSTER_H,
    costTruingMinCoveragePercent: MIN_COVERAGE_PERCENT,
    platformAlertSmsTo: SMS_ZIEL,
    platformAlertMailTo: MAIL_ZIEL,
    ...overrides,
  });
}

function beendeterAnruf(state, { nowMs, profil, endedMinutenHer, tenantId = BOOTSTRAP_TENANT_ID }) {
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId, provider: "telnyx" });
  call.status = "completed";
  call.costProfile = profil;
  call.answeredAt = new Date(nowMs - (endedMinutenHer + 1) * MINUTE_MS).toISOString();
  call.endedAt = new Date(nowMs - endedMinutenHer * MINUTE_MS).toISOString();
  call.estimatedCostCents = STANDARD_ESTIMATE_CENTS;
  call.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  call.costTruedAt = call.endedAt;
  return call;
}

function beleg(state, { callId, traeger, reife }) {
  return recordCallCostEvidence(state, { callId, traeger, reife });
}

function mitBootstrapNummer(state) {
  bindPlatformNumber(state, {
    e164: BOOTSTRAP_SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx", tenantId: BOOTSTRAP_TENANT_ID,
  });
  return state;
}

function spione() {
  const mailCalls = [];
  const auditCalls = [];
  const smsCalls = [];
  const mailer = { sendMail: async (eintrag) => { mailCalls.push(eintrag); } };
  const messaging = () => ({ async sendSms(eintrag) { smsCalls.push(eintrag); return { sid: "SM_fake" }; } });
  const audit = (event, req, detail) => auditCalls.push({ event, req, detail });
  return { mailCalls, smsCalls, auditCalls, mailer, messaging, audit };
}

function neuerSweep(state, nowMs) {
  const { mailCalls, smsCalls, auditCalls, mailer, messaging, audit } = spione();
  const store = makeStubStore(state);
  const { runCostTruingSweep } = makeCostTruing({
    store, config: testConfig(), voiceControl: fakeVoiceControl({}), audit, messaging, mailer, now: () => nowMs,
  });
  return { store, runCostTruingSweep, mailCalls, smsCalls, auditCalls };
}

function befundeAus(auditCalls) {
  return auditCalls.filter((eintrag) => eintrag.event === COST_TRUING_AUDIT_EVENT);
}

function hatBefundCode(befunde, code) {
  return befunde.some((eintrag) => eintrag.detail.startsWith(`grund=${code} `));
}

function zaehleBefundCode(befunde, code) {
  return befunde.filter((eintrag) => eintrag.detail.startsWith(`grund=${code} `)).length;
}

function berichtFuer(state, nowMs, billing = testConfig().billing) {
  return kostenBuchBericht({ state, billing, nowMs, deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS });
}

test("(a) Deckung je Traeger unter der Schwelle: genau ein Befund, eine Mail, eine SMS", async () => {
  const nowMs = Date.now();
  const state = mitBootstrapNummer(makeDefaultState());
  const anrufe = Array.from({ length: 10 }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });
  anrufe.slice(0, SIEBEN).forEach((anruf) => beleg(state, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.BELEGT }));

  const { runCostTruingSweep, mailCalls, smsCalls, auditCalls } = neuerSweep(state, nowMs);
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  const befunde = befundeAus(auditCalls);
  assert.equal(befunde.length, 1, "genau ein Befund insgesamt");
  assert.ok(
    hatBefundCode(befunde, `${KOSTEN_BEFUND.DECKUNG_UNTER_SCHWELLE}:${KOSTENART.ELEVENLABS_CONVAI}`),
    "der eine Befund ist die Deckungsschwelle von elevenlabs_convai",
  );
  assert.equal(mailCalls.length, 1, "genau eine Mail");
  assert.equal(smsCalls.length, 1, "genau eine SMS");
});

test("(b) Herzschlag ohne jede Faelligkeit: ein Alarm bei 0 Kandidaten, zweiter Sweep entprellt", async () => {
  const nowMs = Date.now();
  const state = mitBootstrapNummer(makeDefaultState());
  const anrufe = Array.from({ length: FUENF }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });

  const { runCostTruingSweep, mailCalls, smsCalls, auditCalls } = neuerSweep(state, nowMs);
  const ergebnis = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(ergebnis.candidates, 0, "kein Kandidat - der Sweep meldet kandidaten=0");

  const befunde = befundeAus(auditCalls);
  assert.equal(befunde.length, 1);
  assert.ok(hatBefundCode(befunde, `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.ELEVENLABS_CONVAI}`));
  assert.equal(mailCalls.length, 1);
  assert.equal(smsCalls.length, 1);

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(mailCalls.length, 1, "keine zweite Mail");
  assert.equal(smsCalls.length, 1, "keine zweite SMS");
  const entprellt = auditCalls.filter((eintrag) => eintrag.event === `${COST_TRUING_AUDIT_EVENT}_entprellt`);
  assert.equal(entprellt.length, 1, "die Notiz-Stufe feuert trotzdem");
});

test("(c) unbeschaffbar faellt aus Zaehler UND Nenner - die Quote laeuft ueber dem verkleinerten Nenner", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const anrufe = Array.from({ length: 10 }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });
  anrufe.slice(0, VIER).forEach((anruf) =>
    beleg(state, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.STRUKTURELL_UNBESCHAFFBAR }));
  anrufe.slice(VIER, VIER + DREI).forEach((anruf) =>
    beleg(state, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.BELEGT }));
  anrufe.slice(VIER + DREI).forEach((anruf) =>
    beleg(state, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG }));

  const bericht = berichtFuer(state, nowMs);
  const eintrag = bericht.deckung.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.deepEqual(eintrag, {
    traeger: KOSTENART.ELEVENLABS_CONVAI, kandidaten: 6, belegt: 3, offen: 3, unbeschaffbar: 4, prozent: 50,
  });
});

test("(d) 'nie beendet' zaehlt nur die absolute Obergrenze, nicht jeden laufenden Anruf", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const zombie = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  zombie.startedAt = new Date(nowMs - DREI_STUNDEN_MIN * MINUTE_MS).toISOString();
  const laufend = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  laufend.startedAt = new Date(nowMs - MINUTE_MS).toISOString();

  const bericht = berichtFuer(state, nowMs);
  assert.equal(bericht.nieBeendet, 1);
  assert.match(bericht.zeile, /nie_beendet=1/);
  assert.deepEqual(bericht.deckung, [], "kein endedAt -> kein Deckungs-Zaehler betroffen");
  assert.deepEqual(bericht.herzschlag, [], "kein endedAt -> kein Herzschlag-Zaehler betroffen");
});

test("(e) usage.costCents bleibt unveraendert, keine Korrektur wird gebucht", async () => {
  const nowMs = Date.now();
  const state = mitBootstrapNummer(makeDefaultState());
  const anruf = beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN });
  beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });
  usageFor(state, anruf.tenantId).costCents = ERWARTETER_USAGE_CENTS;

  const { store, runCostTruingSweep } = neuerSweep(state, nowMs);
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(usageFor(state, anruf.tenantId).costCents, ERWARTETER_USAGE_CENTS);
  assert.deepEqual(store.writes, [], "keine Korrektur, kein zweiter Kandidaten-Durchlauf");
});

test("(f) telnyx_call_records: der Herzschlag schweigt, solange die Belegzeile steht (+ Gegenprobe)", async () => {
  const nowMs = Date.now();
  const state = mitBootstrapNummer(makeDefaultState());
  const anrufe = Array.from({ length: FUENF }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.BELEGT });

  const { store, runCostTruingSweep, mailCalls, smsCalls, auditCalls } = neuerSweep(state, nowMs);
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  const code = `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.TELNYX_CALL_RECORDS}`;
  assert.equal(zaehleBefundCode(befundeAus(auditCalls), code), 0, "kein Befund");
  assert.deepEqual(mailCalls, []);
  assert.deepEqual(smsCalls, []);
  const entprellt = auditCalls.filter((eintrag) => eintrag.event === `${COST_TRUING_AUDIT_EVENT}_entprellt`);
  assert.deepEqual(entprellt, [], "keine Notiz-Zeile - der Befund wurde nie erzeugt");
  assert.equal(openOutageAlert(store.load(), kostenMarkerCode(code)), undefined, "kein offener Marker");

  const nowMs2 = Date.now();
  const state2 = mitBootstrapNummer(makeDefaultState());
  Array.from({ length: FUENF }, () =>
    beendeterAnruf(state2, { nowMs: nowMs2, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: DREI_STUNDEN_MIN }));

  const zweiterSweep = neuerSweep(state2, nowMs2);
  await zweiterSweep.runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(
    zaehleBefundCode(befundeAus(zweiterSweep.auditCalls), code), 1,
    "der Herzschlag ist scharf und nur still, weil eingesammelt wird",
  );
});

test("(g) telnyx_sip: die Weiche legt 'erwartet' an, das zaehlt NICHT als angelegt (+ Gegenprobe)", async () => {
  const nowMs = Date.now();
  const state = mitBootstrapNummer(makeDefaultState());
  const anrufe = Array.from({ length: FUENF }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) {
    beleg(state, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG });
    beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.ERWARTET });
  }

  const { runCostTruingSweep, auditCalls } = neuerSweep(state, nowMs);
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const befunde = befundeAus(auditCalls);
  assert.equal(zaehleBefundCode(befunde, `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.TELNYX_SIP}`), 1);
  assert.equal(zaehleBefundCode(befunde, `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.ELEVENLABS_CONVAI}`), 0);

  const nowMs2 = Date.now();
  const state2 = mitBootstrapNummer(makeDefaultState());
  const anrufe2 = Array.from({ length: FUENF }, () =>
    beendeterAnruf(state2, { nowMs: nowMs2, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe2) {
    beleg(state2, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG });
    beleg(state2, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });
  }
  const zweiterSweep = neuerSweep(state2, nowMs2);
  await zweiterSweep.runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const code = `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.TELNYX_SIP}`;
  assert.equal(zaehleBefundCode(befundeAus(zweiterSweep.auditCalls), code), 0);
  assert.equal(openOutageAlert(state2, kostenMarkerCode(code)), undefined);
});

test("Zaehlweise: 'vorlaeufig' ist fuer den Herzschlag angelegt, fuer die Deckung nicht belegt", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const anrufe = Array.from({ length: FUENF }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) {
    beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });
    beleg(state, { callId: anruf.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG });
  }
  const bericht = berichtFuer(state, nowMs);
  const herzEintrag = bericht.herzschlag.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  const deckEintrag = bericht.deckung.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.deepEqual(herzEintrag, { traeger: KOSTENART.ELEVENLABS_CONVAI, beendet: FUENF, angelegt: FUENF });
  assert.deepEqual(deckEintrag, {
    traeger: KOSTENART.ELEVENLABS_CONVAI, kandidaten: FUENF, belegt: 0, offen: FUENF, unbeschaffbar: 0, prozent: 0,
  });
});

test("A2: feuert der Herzschlag fuer einen Traeger, feuert die Deckungsschwelle desselben Traegers nicht zusaetzlich", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const anrufe = Array.from({ length: FUENF }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN }));
  for (const anruf of anrufe) beleg(state, { callId: anruf.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT });

  const bericht = berichtFuer(state, nowMs);
  const codes = bericht.befunde.map((befund) => befund.code);
  assert.ok(codes.includes(`${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.ELEVENLABS_CONVAI}`));
  assert.ok(!codes.includes(`${KOSTEN_BEFUND.DECKUNG_UNTER_SCHWELLE}:${KOSTENART.ELEVENLABS_CONVAI}`));
});

test("Karenz: ein frisch beendeter Anruf loest keinen Herzschlag aus, derselbe Anruf spaeter schon", () => {
  const nowMs = Date.now();
  const billingMitLangerKarenz = testConfig({
    costTruingDelayMinutes: LANGE_KARENZ_DELAY_MIN,
    costTruingSweepIntervalMs: LANGE_KARENZ_SWEEP_INTERVAL_MS,
  }).billing;
  const code = `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.TELNYX_CALL_RECORDS}`;

  const frischerState = makeDefaultState();
  Array.from({ length: FUENF }, () =>
    beendeterAnruf(frischerState, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: ZEHN_MINUTEN }));
  const frischerBericht = berichtFuer(frischerState, nowMs, billingMitLangerKarenz);
  assert.equal(frischerBericht.befunde.some((befund) => befund.code === code), false, "innerhalb der Karenz: kein Alarm");

  const alterState = makeDefaultState();
  Array.from({ length: FUENF }, () =>
    beendeterAnruf(alterState, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: DREI_STUNDEN_MIN }));
  const alterBericht = berichtFuer(alterState, nowMs, billingMitLangerKarenz);
  assert.equal(alterBericht.befunde.some((befund) => befund.code === code), true, "ausserhalb der Karenz: Alarm");
});

test("Fenster aus: kostenHeartbeatFensterH=0 schaltet nur den Herzschlag ab, die Deckung bleibt scharf", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  Array.from({ length: FUENF }, () =>
    beendeterAnruf(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: DREI_STUNDEN_MIN }));
  const billing = testConfig({ kostenHeartbeatFensterH: 0 }).billing;

  const bericht = berichtFuer(state, nowMs, billing);
  assert.equal(bericht.herzschlagAktiv, false);
  assert.match(bericht.zeile, /herzschlag=aus/);
  assert.equal(
    bericht.befunde.some((befund) => befund.code.startsWith(KOSTEN_BEFUND.ERFASSUNG_TOT)), false,
    "der Herzschlag meldet nichts mehr",
  );
  const deckEintrag = bericht.deckung.find((zeile) => zeile.traeger === KOSTENART.TELNYX_CALL_RECORDS);
  assert.equal(deckEintrag.kandidaten, FUENF, "die Deckung wird unabhaengig weiter gemessen");
});

test("profil-fehlt: ein beendeter Anruf ohne Kostenprofil meldet genau einmal, faellt spaeter aus dem Fenster", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const anruf = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  anruf.status = "completed";
  anruf.answeredAt = new Date(nowMs - (DREI_STUNDEN_MIN + 1) * MINUTE_MS).toISOString();
  anruf.endedAt = new Date(nowMs - DREI_STUNDEN_MIN * MINUTE_MS).toISOString();

  const billing = testConfig().billing;
  const bericht = berichtFuer(state, nowMs, billing);
  const profillosBefunde = bericht.befunde.filter((befund) => befund.code === KOSTEN_BEFUND.PROFIL_FEHLT);
  assert.equal(profillosBefunde.length, 1);
  assert.equal(profillosBefunde[0].detail, `fenster_h=${HEARTBEAT_FENSTER_H} anrufe=1`);

  const altState = makeDefaultState();
  const altAnruf = createCall(altState, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  altAnruf.status = "completed";
  altAnruf.answeredAt = new Date(nowMs - (SIEBEN_TAGE_MIN + 1) * MINUTE_MS).toISOString();
  altAnruf.endedAt = new Date(nowMs - SIEBEN_TAGE_MIN * MINUTE_MS).toISOString();
  const altBericht = berichtFuer(altState, nowMs, billing);
  assert.equal(altBericht.befunde.some((befund) => befund.code === KOSTEN_BEFUND.PROFIL_FEHLT), false, "faellt aus dem Fenster");
});

test("PII: der Bericht enthaelt weder Call-ID noch Tenant-ID noch Rufnummer", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const anruf = beendeterAnruf(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: DREI_STUNDEN_MIN, tenantId: GEHEIME_TENANT_ID,
  });
  anruf.from = GEHEIME_RUFNUMMER;
  anruf.to = GEHEIME_RUFNUMMER;

  const bericht = berichtFuer(state, nowMs);
  const roh = JSON.stringify(bericht);
  assert.ok(!roh.includes(anruf.id), "keine Call-ID");
  assert.ok(!roh.includes(GEHEIME_TENANT_ID), "keine Tenant-ID");
  assert.ok(!roh.includes(GEHEIME_RUFNUMMER), "keine Rufnummer");
});
