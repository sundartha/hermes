import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche, withStoreLock } from "../src/store.js";
import { meldeVollBefund, reportSystematicOutage, runAlertChannelSelfTest, runOutageRecoverySweep, runPlatformHoldEscalationSweep } from "../src/telephony/outage-report.js";

const BUCKET = "not-placed:invite-403";
const NOW_MS = Date.parse("2026-08-27T16:45:00Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
const CONFIG = Object.freeze({
  billing: {
    outageAlertWindowMs: 3600000,
    outageAlertMinFailures: 3,
    outageAlertMinAttempts: 20,
    outageAlertFailSharePercent: 20,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    outageAlertSelfTestIntervalMs: 86400000,
    platformHoldEscalationMaxAgeMs: 1000,
    platformAlertSmsTo: "",
  },
  mail: { platformAlertMailTo: "ops@example.test" },
});

function marker(code, felder = {}) {
  return {
    id: `otg_${code}`, code, firstSeenAt: "2026-08-27T16:00:00Z", lastSeenAt: "2026-08-27T16:00:00Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null, ...felder,
  };
}

function rohspeicher(zustand) {
  const protokoll = [];
  const speicher = {
    load: () => {
      protokoll.push("load");
      return zustand;
    },
    save: () => protokoll.push("save"),
    withStoreLock,
  };
  return { speicher, protokoll };
}

function anruf(id, endedAt) {
  return { id, tenantId: "t_1", direction: "outbound", endedAt, answeredAt: null, failureReason: `${BUCKET}-D51`, to: "+12025550199" };
}

function spione() {
  const audits = [];
  const mails = [];
  return {
    audits, mails,
    audit: (aktion) => audits.push(aktion),
    mailer: { sendMail: async (args) => mails.push(args) },
    messaging: () => ({ sendSms: async () => {} }),
  };
}

test("ausfall: Bereichsfunktionen sind Promises und lesen load, save und withStoreLock erst beim Aufruf", async () => {
  const zustand = { outageAlerts: [], calls: [], tenants: [], numbers: [] };
  const speicher = {};
  const { ausfall } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  speicher.save = () => {};
  speicher.withStoreLock = (fn) => Promise.resolve().then(fn);
  const antwort = ausfall.notizClaimen({ code: BUCKET, nowMs: NOW_MS });
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.equal(zustand.outageAlerts[0].code, BUCKET);
  assert.ok(ausfall.sendeplatzReserviert({ bucket: BUCKET, nowMs: NOW_MS }) instanceof Promise);
  speicher.load = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(ausfall.offeneAusfallZustand(), /kaputt/);
});

test("ausfall: Sendeplatz ist nur beim gleichen Marker und gleichen Versandzeitpunkt reserviert", async () => {
  const { speicher } = rohspeicher({ outageAlerts: [marker(BUCKET, { lastAttemptAt: NOW_ISO })] });
  const { ausfall } = speicherBereiche(speicher);
  assert.equal(await ausfall.sendeplatzReserviert({ bucket: BUCKET, nowMs: NOW_MS }), true);
  assert.equal(await ausfall.sendeplatzReserviert({ bucket: BUCKET, nowMs: NOW_MS + 1000 }), false);
  assert.equal(await ausfall.sendeplatzReserviert({ bucket: "anderer", nowMs: NOW_MS }), false);
});

test("ausfall: Reservieren schreibt und speichert nur, wenn der Platz frei ist", async () => {
  const zustand = { outageAlerts: [] };
  const { speicher, protokoll } = rohspeicher(zustand);
  const { ausfall } = speicherBereiche(speicher);
  assert.equal(await ausfall.sendeplatzReservieren({ bucket: BUCKET, nowMs: NOW_MS, frei: () => false }), false);
  assert.deepEqual(zustand.outageAlerts, []);
  assert.equal(protokoll.includes("save"), false);
  assert.equal(await ausfall.sendeplatzReservieren({ bucket: BUCKET, nowMs: NOW_MS, frei: (m) => m === undefined }), true);
  assert.equal(zustand.outageAlerts[0].lastAttemptAt, NOW_ISO);
  assert.equal(zustand.outageAlerts[0].deliveredChannels, null);
  assert.equal(protokoll.filter((eintrag) => eintrag === "save").length, 1);
});

test("ausfall: Urteil sieht Anrufe und Marker und reserviert nur bei Alarm", async () => {
  const zustand = { calls: [anruf("c1", NOW_ISO)], outageAlerts: [marker(BUCKET)] };
  const { speicher, protokoll } = rohspeicher(zustand);
  const { ausfall } = speicherBereiche(speicher);
  const gesehen = [];
  const beurteile = (eingabe) => {
    gesehen.push(eingabe);
    return { urteil: "x" };
  };
  assert.deepEqual(await ausfall.urteilClaimen({ bucket: BUCKET, nowMs: NOW_MS, beurteile, istAlarm: () => false }), { urteil: "x" });
  assert.equal(gesehen[0].calls, zustand.calls);
  assert.equal(gesehen[0].marker, zustand.outageAlerts[0]);
  assert.equal(zustand.outageAlerts[0].lastAttemptAt, null);
  assert.equal(protokoll.filter((eintrag) => eintrag === "save").length, 1);
  await ausfall.urteilClaimen({ bucket: BUCKET, nowMs: NOW_MS, beurteile, istAlarm: () => true });
  assert.equal(zustand.outageAlerts[0].lastAttemptAt, NOW_ISO);
});

test("ausfall: Versandmarkierung, Notiz und Schliessen schreiben die Marker", async () => {
  const zustand = { outageAlerts: [marker(BUCKET), marker("zu")] };
  const { speicher, protokoll } = rohspeicher(zustand);
  const { ausfall } = speicherBereiche(speicher);
  await ausfall.alarmVersendet({ code: BUCKET, nowMs: NOW_MS, channels: ["mail"] });
  assert.equal(zustand.outageAlerts[0].deliveredChannels, "mail");
  assert.equal(zustand.outageAlerts[0].lastAttemptAt, NOW_ISO);
  await ausfall.notizClaimen({ code: "zu", nowMs: NOW_MS });
  assert.equal(zustand.outageAlerts[1].lastAttemptAt, null);
  assert.equal(zustand.outageAlerts[1].lastSeenAt, NOW_ISO);
  await ausfall.markerSchliessen({ code: "zu", nowMs: NOW_MS });
  assert.equal(zustand.outageAlerts[1].closedAt, NOW_ISO);
  assert.equal(zustand.outageAlerts[0].closedAt, null);
  assert.equal(protokoll.filter((eintrag) => eintrag === "save").length, 3);
});

test("ausfall: Hold-Eskalation und Selbsttest werden je Platz genau einmal beansprucht", async () => {
  const zustand = { outageAlerts: [] };
  const { speicher } = rohspeicher(zustand);
  const { ausfall } = speicherBereiche(speicher);
  assert.equal(await ausfall.holdEskalationClaimen({ bucket: "hold:x", nowMs: NOW_MS }), true);
  assert.equal(await ausfall.holdEskalationClaimen({ bucket: "hold:x", nowMs: NOW_MS }), false);
  assert.equal(zustand.outageAlerts.length, 1);
  assert.equal(zustand.outageAlerts[0].lastAttemptAt, NOW_ISO);
  assert.equal(await ausfall.selbsttestClaimen({ bucket: "st", nowMs: NOW_MS, faellig: () => false }), false);
  assert.equal(zustand.outageAlerts.length, 1);
  assert.equal(await ausfall.selbsttestClaimen({ bucket: "st", nowMs: NOW_MS, faellig: (m) => m === undefined }), true);
  assert.equal(zustand.outageAlerts[1].lastAttemptAt, NOW_ISO);
});

test("ausfall: offener Zustand enthaelt nur offene Marker, Hold-Kandidaten kommen aus dem Zustand", async () => {
  const zustand = {
    calls: [anruf("c1", NOW_ISO)],
    outageAlerts: [marker("a"), marker("b", { closedAt: NOW_ISO })],
    tenants: [],
    numbers: [],
  };
  const { speicher } = rohspeicher(zustand);
  const { ausfall } = speicherBereiche(speicher);
  const offen = await ausfall.offeneAusfallZustand();
  assert.equal(offen.calls, zustand.calls);
  assert.deepEqual(offen.outageAlerts.map((m) => m.code), ["a"]);
  assert.deepEqual(await ausfall.holdKandidaten({ nowMs: NOW_MS, maxAgeMs: 1 }), []);
});

test("ausfall: Meldung ueber reportSystematicOutage laeuft nur ueber load, save und Sperre des Speichers", async () => {
  const calls = [anruf("a", "2026-08-27T16:43:00Z"), anruf("b", "2026-08-27T16:44:00Z"), anruf("c", NOW_ISO)];
  const zustand = { calls, outageAlerts: [marker(BUCKET)], platformNumberUse: [] };
  const { speicher, protokoll } = rohspeicher(zustand);
  const s = spione();
  await reportSystematicOutage({ store: speicher, config: CONFIG, call: calls[2], audit: s.audit, messaging: s.messaging, mailer: s.mailer });
  assert.deepEqual(s.audits, ["outage_alert"]);
  assert.equal(s.mails.length, 1);
  const [eintrag] = zustand.outageAlerts;
  assert.equal(eintrag.lastAttemptAt, NOW_ISO);
  assert.equal(eintrag.deliveredChannels, "mail");
  assert.ok(protokoll.includes("save"));
});

test("ausfall: zwei gleichzeitige Meldungen im Entprellfenster ergeben genau einen Versand", async () => {
  const zustand = { calls: [], outageAlerts: [marker(BUCKET)], platformNumberUse: [] };
  const { speicher } = rohspeicher(zustand);
  const s = spione();
  const eingabe = { store: speicher, config: CONFIG, audit: s.audit, messaging: s.messaging, mailer: s.mailer, bucket: BUCKET, aktion: "outage_alert", zeile: "z", nowMs: NOW_MS };
  await Promise.all([meldeVollBefund(eingabe), meldeVollBefund(eingabe)]);
  assert.deepEqual([...s.audits].sort(), ["outage_alert", "outage_alert_entprellt"]);
  assert.equal(s.mails.length, 1);
});

test("ausfall: Wirft der Speicher, faengt der Melder den Fehler ab und meldet ihn", async () => {
  const fehler = [];
  const original = console.error;
  console.error = (...args) => fehler.push(args.join(" "));
  const kaputt = { load: () => { throw new Error("kaputt"); }, save: () => {}, withStoreLock };
  const s = spione();
  try {
    await reportSystematicOutage({ store: kaputt, config: CONFIG, call: anruf("a", NOW_ISO), audit: s.audit, messaging: s.messaging, mailer: s.mailer });
    await runAlertChannelSelfTest({ store: kaputt, config: CONFIG, audit: s.audit, messaging: s.messaging, mailer: s.mailer, nowMs: NOW_MS });
    await runPlatformHoldEscalationSweep({ store: kaputt, config: CONFIG, audit: s.audit, messaging: s.messaging, mailer: s.mailer, nowMs: NOW_MS });
  } finally {
    console.error = original;
  }
  assert.deepEqual(fehler, [
    "[outage] Ausfall-Melder fehlgeschlagen: kaputt",
    "[outage] Alarmkanal-Selbsttest fehlgeschlagen: kaputt",
    "[outage] HOLD-Eskalation fehlgeschlagen: kaputt",
  ]);
});

test("ausfall: Erholungslauf schliesst einen offenen Marker ohne neue Fehler", async () => {
  const erfolg = { ...anruf("ok", "2026-08-27T16:40:00Z"), failureReason: null, answeredAt: "2026-08-27T16:40:05Z" };
  const zustand = { calls: [erfolg], outageAlerts: [marker(BUCKET, { lastAttemptAt: "2026-08-27T10:00:00Z", reportedAt: "2026-08-27T10:00:00Z" })] };
  const { speicher } = rohspeicher(zustand);
  const s = spione();
  await runOutageRecoverySweep({ store: speicher, config: CONFIG, audit: s.audit, nowMs: NOW_MS });
  assert.deepEqual(s.audits, ["outage_recovered"]);
  assert.equal(zustand.outageAlerts[0].closedAt, NOW_ISO);
});
