import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  OUTAGE_VERDICT,
  ZAEHLWEISE_OUTBOUND,
  beurteileAusfall,
  outageWindow,
} from "../src/telephony/outage-detection.js";
import { AUSFALL_KLASSE, INBOUND_EL_OUTAGE_CODE } from "../src/telephony/outage-classes.js";
import { reportSystematicOutage, runOutageRecoverySweep } from "../src/telephony/outage-report.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { INBOUND_EL_GRUND } from "../src/elevenlabs/inbound-uebergabe-gescheitert.js";
import { PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";
import { BASE_ENV, seedCall } from "./helpers.js";
import { gebauteKonfiguration } from "./gemeinsam/gebaute-konfiguration.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW_ISO = "2026-09-17T12:00:00Z";
const NOW_MS = Date.parse(NOW_ISO);
const ANSWERED_ISO = "2026-09-17T11:56:00Z";
const TENANT_ID = "t_user_01ABC";
const CALLER_E164 = "+12025550188";
const DID_E164 = "+12025550177";
const ALERT_SMS_TO = "+12025550143";
const ALERT_SENDER_E164 = "+12025550111";
const ALERT_MAIL_TO = "ops@example.test";
const OUTBOUND_BUCKET = "not-placed:invite-403";

const OUTBOUND_FENSTER_MS = 3600000;
const INBOUND_FENSTER_MS = 21600000;
const MS_PER_MINUTE = 60000;

const CONFIG = Object.freeze({
  billing: Object.freeze({
    paymentEnabled: false,
    smsCostCents: 0,
    outageAlertWindowMs: OUTBOUND_FENSTER_MS,
    outageAlertMinFailures: 3,
    outageAlertMinAttempts: 20,
    outageAlertFailSharePercent: 20,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    inboundOutageAlertWindowMs: INBOUND_FENSTER_MS,
    inboundOutageAlertMinFailures: 2,
    inboundOutageAlertMinAttempts: 20,
    inboundOutageAlertFailSharePercent: 10,
    platformAlertSmsTo: ALERT_SMS_TO,
  }),
  privacy: {},
  server: { publicUrl: "https://hermes.example.test" },
  mail: Object.freeze({ platformAlertMailTo: ALERT_MAIL_TO }),
});

const INBOUND_SCHWELLEN = AUSFALL_KLASSE.INBOUND_EL.schwellen(CONFIG);
const INBOUND_ZAEHLWEISE = AUSFALL_KLASSE.INBOUND_EL.zaehlweise;

function configMitInboundFenster(windowMs) {
  return { ...CONFIG, billing: { ...CONFIG.billing, inboundOutageAlertWindowMs: windowMs } };
}

function elInboundCall({ id, endedAt, elFallbackAt = null, conversationId = null, transcript = [] }) {
  return seedCall({
    id,
    tenantId: TENANT_ID,
    direction: "inbound",
    status: "completed",
    from: CALLER_E164,
    to: DID_E164,
    costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
    answeredAt: ANSWERED_ISO,
    endedAt,
    transcript,
    elFallbackAt,
    elevenlabsConversationId: conversationId,
    failureReason: elFallbackAt ? INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT : null,
  });
}

const ENDE_ISO = ["2026-09-17T11:57:00Z", "2026-09-17T11:58:00Z", "2026-09-17T11:59:00Z"];

function rueckfallCalls() {
  return ENDE_ISO.map((endedAt, i) =>
    elInboundCall({ id: `call_rf${i}`, endedAt, elFallbackAt: endedAt }),
  );
}

function wartetCalls() {
  return ENDE_ISO.map((endedAt, i) => elInboundCall({ id: `call_wt${i}`, endedAt }));
}

function gebundenCalls() {
  return ENDE_ISO.map((endedAt, i) =>
    elInboundCall({ id: `call_gb${i}`, endedAt, conversationId: `conv_${i}` }),
  );
}

function outboundNotPlacedCalls() {
  return ENDE_ISO.map((endedAt, i) =>
    seedCall({
      id: `call_ob${i}`,
      tenantId: TENANT_ID,
      direction: "outbound",
      status: "failed",
      to: "+12025550199",
      endedAt,
      failureReason: `${OUTBOUND_BUCKET}-D51`,
    }),
  );
}

function offenerMarker(code, { reportedAt = null, lastAttemptAt = null } = {}) {
  return {
    id: `otg_${code}`,
    code,
    firstSeenAt: "2026-09-17T09:00:00Z",
    lastSeenAt: "2026-09-17T09:00:00Z",
    lastAttemptAt,
    reportedAt,
    deliveredChannels: null,
    closedAt: null,
  };
}

function boundSender() {
  return [{
    id: "pnu_1",
    e164: ALERT_SENDER_E164,
    purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx",
    tenantId: null,
    providerNumberId: null,
    boundAt: NOW_ISO,
    releasedAt: null,
    note: null,
  }];
}

function makeStore({ calls = [], outageAlerts = [], platformNumberUse = boundSender() } = {}) {
  const state = { calls, outageAlerts, platformNumberUse };
  return {
    state,
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
  };
}

function markerListe(store) {
  return store.load().outageAlerts;
}

function markerMitCode(store, code) {
  return markerListe(store).find((marker) => marker.code === code);
}

function makeSpies() {
  const mailCalls = [];
  const smsCalls = [];
  const auditCalls = [];
  return {
    mailCalls,
    smsCalls,
    auditCalls,
    audit: (action, req, detail) => auditCalls.push({ action, detail }),
    mailer: { sendMail: async (args) => void mailCalls.push(args) },
    messaging: () => ({ sendSms: async (args) => void smsCalls.push(args) }),
  };
}

function captureLog() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const lines = [];
  const sammle = (...args) => lines.push(args.map(String).join(" "));
  console.log = sammle;
  console.warn = sammle;
  console.error = sammle;
  return {
    lines,
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

function makeFinishStore(state, spies) {
  return {
    state,
    load: () => state,
    withStoreLock: (fn) => Promise.resolve().then(fn),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (...args) => spies.notifications.push(args),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    callActionItems: () => [],
    recordUsageEvent: () => {},
    markBilled: () => {},
    markInboxEntry: () => {},
    markSummaryMailSent: () => spies.summaryMarker.push("mail"),
    markSummarySmsSent: () => spies.summaryMarker.push("sms"),
    tenantNewsletterConsent: () => ({ consent: false }),
    confirmedNewsletterRecipients: () => [],
  };
}

function makeFinish({ store, spies }) {
  return makeCallFinish({
    store,
    config: CONFIG,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: spies.messaging,
    summarizeCall: async () => ({ summary: "Kurze Zusammenfassung.", actionItems: [] }),
    planSummarySms: () => {
      spies.summaryPlanCalls.push("gefragt");
      return { send: false, reason: null };
    },
    audit: spies.audit,
    mailer: spies.mailer,
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
  });
}

function finishSpies() {
  return Object.assign(makeSpies(), { notifications: [], summaryMarker: [], summaryPlanCalls: [] });
}

test("IEX-B1-1 (PFLICHT, R1): ein Fenster aus lauter gescheiterten Uebergaben MIT gesetztem answeredAt ergibt ALARM", () => {
  const calls = rueckfallCalls();
  const fenster = outageWindow(calls, {
    nowMs: NOW_MS,
    windowMs: INBOUND_SCHWELLEN.windowMs,
    bucket: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: INBOUND_ZAEHLWEISE,
  });
  assert.deepEqual(fenster, { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 });
  const { urteil } = beurteileAusfall({
    fenster,
    marker: offenerMarker(INBOUND_EL_OUTAGE_CODE),
    schwellen: INBOUND_SCHWELLEN,
    nowMs: NOW_MS,
  });
  assert.equal(urteil, OUTAGE_VERDICT.ALERT, "gescheiterte Uebergaben muessen einen Alarm ergeben");

  const blindeZaehlweise = { ...INBOUND_ZAEHLWEISE, belegtErfolg: (call) => Boolean(call.answeredAt) };
  const blindesFenster = outageWindow(calls, {
    nowMs: NOW_MS,
    windowMs: INBOUND_SCHWELLEN.windowMs,
    bucket: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: blindeZaehlweise,
  });
  assert.deepEqual(blindesFenster, { fehler: 0, versuche: 3, erfolge: 3, tenants: 0 });
  const blindesUrteil = beurteileAusfall({
    fenster: blindesFenster,
    marker: offenerMarker(INBOUND_EL_OUTAGE_CODE),
    schwellen: INBOUND_SCHWELLEN,
    nowMs: NOW_MS,
  });
  assert.notEqual(blindesUrteil.urteil, OUTAGE_VERDICT.ALERT, "Beleg: answeredAt haette den Melder stumm gestellt");
});

test("IEX-B1-2 (PFLICHT, R2): Auflegen in der Wartephase erzeugt KEINEN Alarm - und keine falsche Entwarnung", () => {
  const fenster = outageWindow(wartetCalls(), {
    nowMs: NOW_MS,
    windowMs: INBOUND_SCHWELLEN.windowMs,
    bucket: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: INBOUND_ZAEHLWEISE,
  });
  assert.deepEqual(fenster, { fehler: 0, versuche: 3, erfolge: 0, tenants: 0 });
  const { urteil } = beurteileAusfall({
    fenster,
    marker: offenerMarker(INBOUND_EL_OUTAGE_CODE),
    schwellen: INBOUND_SCHWELLEN,
    nowMs: NOW_MS,
  });
  assert.equal(urteil, OUTAGE_VERDICT.NONE, "normales Auflegen ist weder Alarm noch Erholung");
});

test("IEX-B1-3: gesunde Inbound-Reihe schliesst die offene Klasse als erholt - ueber den echten Sweep", async () => {
  const spies = makeSpies();
  const store = makeStore({
    calls: gebundenCalls(),
    outageAlerts: [offenerMarker(INBOUND_EL_OUTAGE_CODE)],
  });
  const log = captureLog();
  await runOutageRecoverySweep({ store, config: CONFIG, audit: spies.audit, nowMs: NOW_MS });
  log.restore();
  assert.equal(spies.auditCalls.length, 1, "genau eine Audit-Zeile");
  assert.equal(spies.auditCalls[0].action, "outage_recovered");
  assert.ok(markerListe(store)[0].closedAt, "der Inbound-Marker ist geschlossen");
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
});

test("IEX-B1-4 (R4): Outbound- und Inbound-Klasse fuehren getrennte Marker", async () => {
  const spiesInbound = makeSpies();
  const inboundStore = makeStore({
    calls: [...rueckfallCalls(), ...outboundNotPlacedCalls()],
    outageAlerts: [
      offenerMarker(OUTBOUND_BUCKET, { reportedAt: NOW_ISO, lastAttemptAt: NOW_ISO }),
      offenerMarker(INBOUND_EL_OUTAGE_CODE),
    ],
  });
  const logA = captureLog();
  await reportSystematicOutage({
    store: inboundStore,
    config: CONFIG,
    call: rueckfallCalls()[2],
    audit: spiesInbound.audit,
    messaging: spiesInbound.messaging,
    mailer: spiesInbound.mailer,
  });
  logA.restore();
  assert.equal(spiesInbound.mailCalls.length, 1, "der Inbound-Alarm laeuft trotz entprelltem Outbound-Marker");
  assert.equal(spiesInbound.smsCalls.length, 1);
  const outboundMarker = markerMitCode(inboundStore, OUTBOUND_BUCKET);
  assert.equal(outboundMarker.reportedAt, NOW_ISO, "der Outbound-Marker bleibt unberuehrt");

  const spiesOutbound = makeSpies();
  const outboundStore = makeStore({
    calls: [...rueckfallCalls(), ...outboundNotPlacedCalls()],
    outageAlerts: [
      offenerMarker(INBOUND_EL_OUTAGE_CODE, { reportedAt: NOW_ISO, lastAttemptAt: NOW_ISO }),
      offenerMarker(OUTBOUND_BUCKET),
    ],
  });
  const logB = captureLog();
  await reportSystematicOutage({
    store: outboundStore,
    config: CONFIG,
    call: outboundNotPlacedCalls()[2],
    audit: spiesOutbound.audit,
    messaging: spiesOutbound.messaging,
    mailer: spiesOutbound.mailer,
  });
  logB.restore();
  assert.equal(spiesOutbound.mailCalls.length, 1, "der Outbound-Alarm laeuft trotz entprelltem Inbound-Marker");
  const outboundBody = spiesOutbound.mailCalls[0].text;
  assert.ok(outboundBody.includes(`klasse=${OUTBOUND_BUCKET}`), outboundBody);
  const inboundMarker = markerMitCode(outboundStore, INBOUND_EL_OUTAGE_CODE);
  assert.equal(inboundMarker.reportedAt, NOW_ISO, "der Inbound-Marker bleibt unberuehrt");
});

test("IEX-B1-5 (I4): INBOUND_OUTAGE_ALERT_WINDOW_MS=0 schaltet die Regel vollstaendig ab", async () => {
  const aus = makeSpies();
  const ausStore = makeStore({ calls: rueckfallCalls(), outageAlerts: [] });
  const logA = captureLog();
  await reportSystematicOutage({
    store: ausStore,
    config: configMitInboundFenster(0),
    call: rueckfallCalls()[2],
    audit: aus.audit,
    messaging: aus.messaging,
    mailer: aus.mailer,
  });
  logA.restore();
  assert.equal(aus.auditCalls.length, 0, "OFF darf keine Audit-Zeile erzeugen");
  assert.equal(markerListe(ausStore).length, 0, "OFF darf keinen Marker anlegen");
  assert.equal(aus.mailCalls.length, 0);
  assert.equal(aus.smsCalls.length, 0);

  const an = makeSpies();
  const anStore = makeStore({ calls: rueckfallCalls(), outageAlerts: [] });
  const logB = captureLog();
  await reportSystematicOutage({
    store: anStore,
    config: CONFIG,
    call: rueckfallCalls()[2],
    audit: an.audit,
    messaging: an.messaging,
    mailer: an.mailer,
  });
  logB.restore();
  assert.equal(markerListe(anStore).length, 1);
  assert.equal(markerListe(anStore)[0].code, INBOUND_EL_OUTAGE_CODE);

  const ohneBlatt = makeSpies();
  const ohneBlattStore = makeStore({ calls: rueckfallCalls(), outageAlerts: [] });
  const logC = captureLog();
  await reportSystematicOutage({
    store: ohneBlattStore,
    config: configMitInboundFenster(undefined),
    call: rueckfallCalls()[2],
    audit: ohneBlatt.audit,
    messaging: ohneBlatt.messaging,
    mailer: ohneBlatt.mailer,
  });
  logC.restore();
  assert.equal(ohneBlatt.auditCalls.length, 0, "fehlendes Fenster ist fail-closed (aus)");
  assert.equal(markerListe(ohneBlattStore).length, 0);
});

test("IEX-B1-6 (Verdrahtung): ein gescheiterter EL-Inbound-Anruf loest den Melder ueber den ECHTEN finishCall-Pfad aus", async () => {
  const spies = finishSpies();
  const call = elInboundCall({ id: "call_finish_rf", endedAt: ENDE_ISO[2], elFallbackAt: ENDE_ISO[2] });
  const state = { calls: [call], outageAlerts: [], platformNumberUse: boundSender() };
  const store = makeFinishStore(state, spies);
  const log = captureLog();
  await makeFinish({ store, spies }).finishCall(call);
  log.restore();
  const outageAudits = spies.auditCalls.filter((eintrag) => eintrag.action === "outage_detected");
  assert.equal(outageAudits.length, 1, "der Melder muss ueber finishCall genau einmal urteilen (K0/Erstbefund)");
  assert.equal(state.outageAlerts.length, 1, "ein durabler Marker entsteht");
  assert.equal(state.outageAlerts[0].code, INBOUND_EL_OUTAGE_CODE);

  const spiesOk = finishSpies();
  const okCall = elInboundCall({
    id: "call_finish_gb",
    endedAt: ENDE_ISO[2],
    conversationId: "conv_ok",
    transcript: [{ role: "caller", text: "Hallo", at: ANSWERED_ISO }],
  });
  const okState = { calls: [okCall], outageAlerts: [], platformNumberUse: boundSender() };
  const logOk = captureLog();
  await makeFinish({ store: makeFinishStore(okState, spiesOk), spies: spiesOk }).finishCall(okCall);
  logOk.restore();
  assert.equal(spiesOk.auditCalls.filter((eintrag) => eintrag.action.startsWith("outage_")).length, 0);
  assert.equal(okState.outageAlerts.length, 0, "kein Marker ohne Ausfall");
});

test("IEX-B1-7 (O3/I3): der Inbound-Alarm erzeugt KEINE Tenant- oder Owner-Nachricht", async () => {
  const spies = finishSpies();
  const calls = rueckfallCalls();
  const ausloeser = calls[2];
  const state = {
    calls,
    outageAlerts: [offenerMarker(INBOUND_EL_OUTAGE_CODE)],
    platformNumberUse: boundSender(),
  };
  const store = makeFinishStore(state, spies);
  const log = captureLog();
  await makeFinish({ store, spies }).finishCall(ausloeser);
  log.restore();

  assert.equal(spies.notifications.length, 0, "keine Benachrichtigung an den Tenant");
  assert.deepEqual(spies.summaryPlanCalls, [], "planSummarySms wird gar nicht erst gefragt");
  assert.deepEqual(spies.summaryMarker, [], "keine Zusammenfassungs-Mail/-SMS");
  assert.equal(spies.smsCalls.length, 1, "genau die EINE Betreiber-SMS");
  assert.equal(spies.smsCalls[0].to, ALERT_SMS_TO, "Ziel ist der Plattform-Alarmkanal");
  assert.equal(spies.smsCalls[0].from, ALERT_SENDER_E164, "Absender ist die plattform-gebundene Nummer");
  assert.equal(spies.mailCalls.length, 1, "genau die EINE Betreiber-Mail");
  assert.equal(spies.mailCalls[0].to, ALERT_MAIL_TO);
});

test("IEX-B1-8 (I2/R7): der Alarm-Body der Inbound-Klasse ist PII-frei und nennt SEIN Fenster", async () => {
  const spies = makeSpies();
  const store = makeStore({
    calls: rueckfallCalls(),
    outageAlerts: [offenerMarker(INBOUND_EL_OUTAGE_CODE)],
  });
  const log = captureLog();
  await reportSystematicOutage({
    store,
    config: CONFIG,
    call: rueckfallCalls()[2],
    audit: spies.audit,
    messaging: spies.messaging,
    mailer: spies.mailer,
  });
  log.restore();
  const body = spies.mailCalls[0].text;
  assert.ok(!/\+?\d{7,}/.test(body), `keine Rufnummer im Body: ${body}`);
  assert.ok(!/t_user_/.test(body), `keine Tenant-ID im Body: ${body}`);
  assert.ok(!/call_/.test(body), `keine Call-ID im Body: ${body}`);
  assert.ok(body.includes(`klasse=${INBOUND_EL_OUTAGE_CODE}`), body);
  assert.ok(body.includes("fehler=3"), body);
  assert.ok(body.includes("versuche=3"), body);
  assert.ok(body.includes("erfolge=0"), body);
  assert.ok(
    body.includes(`fenster_min=${INBOUND_FENSTER_MS / MS_PER_MINUTE}`),
    `der Body muss das INBOUND-Fenster nennen, nicht das Outbound-Fenster: ${body}`,
  );
});

test("IEX-B1-9 (I1): der Bestandspfad sieht die neue Klasse nicht - der Default ist die Bestandsdefinition", () => {
  const calls = rueckfallCalls();
  const ohneZaehlweise = outageWindow(calls, {
    nowMs: NOW_MS,
    windowMs: INBOUND_FENSTER_MS,
    bucket: INBOUND_EL_OUTAGE_CODE,
  });
  assert.deepEqual(ohneZaehlweise, { fehler: 0, versuche: 0, erfolge: 0, tenants: 0 });
  const mitOutbound = outageWindow(calls, {
    nowMs: NOW_MS,
    windowMs: INBOUND_FENSTER_MS,
    bucket: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: ZAEHLWEISE_OUTBOUND,
  });
  assert.deepEqual(mitOutbound, ohneZaehlweise, "ZAEHLWEISE_OUTBOUND ist exakt der Default");
  assert.equal(AUSFALL_KLASSE.OUTBOUND.zaehlweise, ZAEHLWEISE_OUTBOUND);
});

const GEBAUTER_GRUNDWERT = 31;

test("IEX-B1-10: die vier Schwellen stehen in config.js, .env.example, render.yaml und BASE_ENV kohaerent", () => {
  const envNamen = [
    "INBOUND_OUTAGE_ALERT_WINDOW_MS",
    "INBOUND_OUTAGE_ALERT_MIN_FAILURES",
    "INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS",
    "INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT",
  ];
  const blattNamen = [
    "inboundOutageAlertWindowMs",
    "inboundOutageAlertMinFailures",
    "inboundOutageAlertMinAttempts",
    "inboundOutageAlertFailSharePercent",
  ];
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  for (const name of envNamen) {
    assert.ok(new RegExp(`^${name}=`, "m").test(envExample), `${name} fehlt in .env.example`);
    assert.ok(new RegExp(`key:\\s*${name}`).test(renderYaml), `${name} fehlt in render.yaml`);
  }
  const gesetzt = Object.fromEntries(envNamen.map((name, stelle) => [name, String(GEBAUTER_GRUNDWERT + stelle)]));
  assert.deepEqual(
    gebauteKonfiguration(gesetzt, blattNamen.map((blatt) => `billing.${blatt}`)),
    Object.fromEntries(blattNamen.map((blatt, stelle) => [`billing.${blatt}`, GEBAUTER_GRUNDWERT + stelle])),
  );
  assert.equal(BASE_ENV.INBOUND_OUTAGE_ALERT_WINDOW_MS, "0");
  assert.equal(BASE_ENV.INBOUND_OUTAGE_ALERT_MIN_FAILURES, "2");
  assert.equal(BASE_ENV.INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS, "20");
  assert.equal(BASE_ENV.INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT, "10");
});
