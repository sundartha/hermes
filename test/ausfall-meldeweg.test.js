// OUTBOUND-E3b (E-4/F2b): der MELDEWEG - Reihenfolge, Fail-Soft, PII. Versand
// ausschliesslich gegen Attrappen (KEINE echten Anrufe/SMS/Mails). Zielnummern nur aus
// reservierten Testbereichen (+1 202 555 01xx). PII (Regel 9/10).
import test from "node:test";
import assert from "node:assert/strict";
import { reportSystematicOutage, runOutageRecoverySweep } from "../src/telephony/outage-report.js";
import { PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";

const FENSTER_MS = 3600000;
const CONFIG = Object.freeze({
  billing: {
    outageAlertWindowMs: FENSTER_MS,
    outageAlertMinFailures: 3,
    outageAlertMinAttempts: 20,
    outageAlertFailSharePercent: 20,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    platformAlertSmsTo: "+12025550143",
  },
  mail: { platformAlertMailTo: "ops@example.test" },
});
const CONFIG_KEIN_KANAL = Object.freeze({
  billing: { ...CONFIG.billing, platformAlertSmsTo: "" },
  mail: { platformAlertMailTo: "" },
});
const CONFIG_KEIN_MAIL = Object.freeze({
  billing: CONFIG.billing,
  mail: { platformAlertMailTo: "" },
});
const SENDER_E164 = "+15005550006";
const BUCKET = "not-placed:invite-403";
const NOW_ISO = "2026-08-27T16:45:00Z";

function makeStore({ calls = [], outageAlerts = [], platformNumberUse = [] } = {}) {
  const state = { calls, outageAlerts, platformNumberUse };
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
  };
}

function boundSender() {
  return [{
    id: "pnu_1", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx", tenantId: null, providerNumberId: null,
    boundAt: NOW_ISO, releasedAt: null, note: null,
  }];
}

function callRow({ id, tenantId, endedAt, failureReason = `${BUCKET}-D51`, answeredAt = null }) {
  return {
    id, tenantId, direction: "outbound", endedAt, answeredAt, failureReason,
    to: "+12025550199",
  };
}

function alarmCalls() {
  return [
    callRow({ id: "call_a", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:43:00Z" }),
    callRow({ id: "call_b", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z" }),
    callRow({ id: "call_c", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:45:00Z" }),
  ];
}

function withOpenMarker(alerts = []) {
  return [{
    id: "otg_1", code: BUCKET, firstSeenAt: "2026-08-27T16:00:00Z", lastSeenAt: "2026-08-27T16:00:00Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null,
  }, ...alerts];
}

function captureLog() {
  const lines = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => lines.push(args.map(String).join(" "));
  console.error = (...args) => lines.push(args.map(String).join(" "));
  return {
    lines,
    restore: () => {
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

function makeSpies({ mailThrows = false, smsThrowsSync = false, smsThrowsAsync = false } = {}) {
  const order = [];
  const mailCalls = [];
  const smsCalls = [];
  const auditCalls = [];
  const audit = (action, req, detail) => { order.push("audit"); auditCalls.push({ action, detail }); };
  const mailer = {
    async sendMail(args) {
      order.push("mail");
      if (mailThrows) throw new Error("mail-boom");
      mailCalls.push(args);
    },
  };
  const messaging = () => {
    order.push("sms");
    if (smsThrowsSync) throw new Error("sms-sync-boom");
    return {
      async sendSms(args) {
        if (smsThrowsAsync) throw new Error("sms-async-boom");
        smsCalls.push(args);
      },
    };
  };
  return { order, mailCalls, smsCalls, auditCalls, audit, mailer, messaging };
}

test("M1: Reihenfolge fixiert - warn, audit, mail, sms", async () => {
  const log = captureLog();
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  log.restore();
  assert.ok(log.lines.some((zeile) => zeile.includes("outage_alert")), "WARN-Zeile vorhanden");
  assert.deepEqual(spies.order, ["audit", "mail", "sms"]);
});

test("M2: Mail wirft - audit und sms laufen trotzdem, kein Wurf, reportedAt bleibt null", async () => {
  const log = captureLog();
  const spies = makeSpies({ mailThrows: true });
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  log.restore();
  assert.equal(spies.smsCalls.length, 1, "SMS lief trotz werfender Mail");
  assert.ok(log.lines.some((zeile) => zeile.includes("Kanal mail fehlgeschlagen")), "Kanal-Kennung in der WARN-Zeile");
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.reportedAt, null, "kein reportedAt bei fehlgeschlagener Mail");
  assert.ok(marker.lastAttemptAt, "lastAttemptAt ist gesetzt (S3-1)");
});

test("M3a: SMS wirft SYNCHRON (unbekannter Provider) - Mail/Audit unberuehrt, kein Wurf", async () => {
  const log = captureLog();
  const spies = makeSpies({ smsThrowsSync: true });
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  log.restore();
  assert.equal(spies.mailCalls.length, 1, "Mail lief trotz synchron werfender SMS");
  assert.ok(log.lines.some((zeile) => zeile.includes("Kanal sms fehlgeschlagen")));
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.reportedAt, "reportedAt gesetzt (Mail lief erfolgreich)");
});

test("M3b: SMS wirft ASYNCHRON (Provider lehnt ab) - kein unhandled rejection, Mail lief", async () => {
  const spies = makeSpies({ smsThrowsAsync: true });
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  // sendFailSoftAlertSms ist fire-and-forget - eine Microtask-Runde reicht.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spies.mailCalls.length, 1);
});

test("M4: Kein Mail-Ziel konfiguriert - Mail-Attrappe 0 Aufrufe, reportedAt trotzdem gesetzt", async () => {
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG_KEIN_MAIL, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.mailCalls.length, 0);
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.reportedAt, "nichts zu wiederholen -> reportedAt gesetzt");
});

test("M5: Kein Kanal konfiguriert - WARN+Audit laufen, kein Versand, kein Wurf", async () => {
  const log = captureLog();
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG_KEIN_KANAL, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  log.restore();
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 1);
  assert.ok(log.lines.length > 0, "WARN-Zeile trotzdem vorhanden");
});

test("M6: Ziel wird NIE geloggt (weder Mailadresse noch SMS-Nummer)", async () => {
  const log = captureLog();
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  log.restore();
  const gesamt = log.lines.join("\n") + JSON.stringify(spies.auditCalls);
  assert.ok(!gesamt.includes(CONFIG.mail.platformAlertMailTo));
  assert.ok(!gesamt.includes(CONFIG.billing.platformAlertSmsTo));
});

test("M7: PII-Regex (Regel 10) - der Alarm-Body traegt keine Rufnummer/Tenant-ID/Call-ID/Carrier-Rohtext", async () => {
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  const body = spies.mailCalls[0].text;
  assert.ok(!/\+?\d{7,}/.test(body), `keine Rufnummer im Body: ${body}`);
  assert.ok(!/t_user_/.test(body), `keine Tenant-ID im Body: ${body}`);
  assert.ok(!/call_/.test(body), `keine Call-ID im Body: ${body}`);
  assert.ok(!/D51/.test(body), `kein Carrier-Rohtext im Body: ${body}`);
  assert.ok(body.includes("klasse="), body);
  assert.ok(body.includes("fehler="), body);
  assert.ok(body.includes("versuche="), body);
  assert.ok(body.includes("tenants="), body);
  assert.ok(body.includes("fenster_min="), body);
});

test("M8: K0 sendet nicht - erstbefund -> 0 Mail/SMS, genau 1 Audit", async () => {
  const spies = makeSpies();
  const einzelnerCall = callRow({ id: "call_first", tenantId: "t_user_01ABC", endedAt: NOW_ISO });
  const store = makeStore({ calls: [einzelnerCall], outageAlerts: [] });
  await reportSystematicOutage({ store, config: CONFIG, call: einzelnerCall, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 1);
  assert.equal(spies.auditCalls[0].action, "outage_detected");
});

test("M9: Erholung sendet nicht - genau eine Audit-Zeile, 0 Sends (Sweep-Pfad, D9)", async () => {
  // D9: der Ausloeser reportSystematicOutage sieht NUR not-placed-Anrufe und kann
  // "erholt" strukturell nie selbst feststellen (der triggernde Call zaehlt immer als
  // eigener Fehler im Fenster) - die Erholung laeuft ueber den Sweep (runOutageRecoverySweep),
  // der das Fenster ohne einen aktuellen not-placed-Anruf neu bewertet.
  const spies = makeSpies();
  const erfolgreicherCall = callRow({
    id: "call_ok", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z",
    answeredAt: "2026-08-27T16:43:50Z", failureReason: null,
  });
  const store = makeStore({ calls: [erfolgreicherCall], outageAlerts: withOpenMarker() });
  await runOutageRecoverySweep({ store, config: CONFIG, audit: spies.audit });
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 1);
  assert.equal(spies.auditCalls[0].action, "outage_recovered");
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.closedAt, "der Marker ist geschlossen");
});

test("M9b (E3B-02): windowMs=0 (Rollback-Hebel OFF) - der Sweep schliesst NICHTS", async () => {
  // Gegenprobe zum urspruenglichen Defekt: runOutageRecoverySweep formulierte die
  // RECOVERED-Klausel selbst nach (`fenster.fehler === 0` -> schliessen) statt
  // beurteileAusfall zu fragen - dadurch griff der Rollback-Hebel OFF (windowMs=0,
  // "Melder komplett aus") im Sweep NIE. Mit dem Fix liefert beurteileAusfall bei
  // windowMs=0 IMMER urteil=OFF, der Sweep handelt dann fuer KEIN Urteil (VERDICT_HANDLERS
  // kennt OFF nicht) - der Marker bleibt offen, keine Audit-Zeile entsteht.
  const spies = makeSpies();
  const erfolgreicherCall = callRow({
    id: "call_ok2", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z",
    answeredAt: "2026-08-27T16:43:50Z", failureReason: null,
  });
  const store = makeStore({ calls: [erfolgreicherCall], outageAlerts: withOpenMarker() });
  const configOff = { ...CONFIG, billing: { ...CONFIG.billing, outageAlertWindowMs: 0 } };
  await runOutageRecoverySweep({ store, config: configOff, audit: spies.audit });
  assert.equal(spies.auditCalls.length, 0, "OFF darf keine Audit-Zeile erzeugen");
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.closedAt, null, "der Marker bleibt offen - OFF schliesst nichts");
});

test("M10: Absender kommt aus der Bindung (PM-17) - ohne Bindung keine SMS, mit Bindung die gebundene Nummer", async () => {
  const spiesOhne = makeSpies();
  const storeOhne = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: [] });
  await reportSystematicOutage({ store: storeOhne, config: CONFIG, call: alarmCalls()[2], audit: spiesOhne.audit, messaging: spiesOhne.messaging, mailer: spiesOhne.mailer });
  assert.equal(spiesOhne.smsCalls.length, 0, "keine offene Bindung -> keine SMS");

  const spiesMit = makeSpies();
  const storeMit = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store: storeMit, config: CONFIG, call: alarmCalls()[2], audit: spiesMit.audit, messaging: spiesMit.messaging, mailer: spiesMit.mailer });
  assert.equal(spiesMit.smsCalls[0].from, SENDER_E164);
});

test("M11: Nicht-not-placed loest nichts aus (unreachable)", async () => {
  const spies = makeSpies();
  const call = callRow({ id: "call_ur", tenantId: "t_user_01ABC", endedAt: NOW_ISO, failureReason: "unreachable:invite-404-D11" });
  const store = makeStore({ calls: [call], outageAlerts: [] });
  await reportSystematicOutage({ store, config: CONFIG, call, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.auditCalls.length, 0);
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
});
