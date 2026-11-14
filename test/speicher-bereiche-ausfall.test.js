import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../src/store.js";
import { makePgTestStore } from "./pg-helpers.js";

const BUCKET = "not-placed:invite-403";
const NOW_MS = Date.parse("2026-08-27T16:45:00Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
function marker(code, felder = {}) {
  return {
    id: `otg_${code}`, code, firstSeenAt: "2026-08-27T16:00:00Z", lastSeenAt: "2026-08-27T16:00:00Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null, ...felder,
  };
}

const { store: echterSpeicher } = await makePgTestStore();

function rohspeicher(zustand) {
  const protokoll = [];
  const speicher = {
    ...echterSpeicher,
    load: () => {
      protokoll.push("load");
      return zustand;
    },
    save: () => protokoll.push("save"),
  };
  return { speicher, protokoll };
}

function anruf(id, endedAt) {
  return { id, tenantId: "t_1", direction: "outbound", endedAt, answeredAt: null, failureReason: `${BUCKET}-D51`, to: "+12025550199" };
}

test("ausfall: Bereichsfunktionen sind Promises und lesen load, save und withStoreLock erst beim Aufruf", async () => {
  const zustand = { outageAlerts: [], calls: [], tenants: [], numbers: [] };
  const speicher = {};
  const { ausfall } = speicherBereiche(speicher);
  Object.assign(speicher, echterSpeicher, { load: () => zustand, save: () => {} });
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

test("ausfall: zwei gleichzeitige Reservierungen im selben Fenster ergeben genau einen Platz", async () => {
  const zustand = { outageAlerts: [marker(BUCKET)] };
  const { speicher } = rohspeicher(zustand);
  const { ausfall } = speicherBereiche(speicher);
  const frei = (offen) => offen.lastAttemptAt === null;
  const eingabe = { bucket: BUCKET, nowMs: NOW_MS, frei };
  const ergebnisse = await Promise.all([ausfall.sendeplatzReservieren(eingabe), ausfall.sendeplatzReservieren(eingabe)]);
  assert.deepEqual(ergebnisse, [true, false]);
  assert.equal(zustand.outageAlerts[0].lastAttemptAt, NOW_ISO);
});

test("ausfall: Wirft die Speicherfunktion, lehnt jede schreibende Bereichsfunktion ab und speichert nichts", async () => {
  const protokoll = [];
  const speicher = {
    ...echterSpeicher,
    load: () => {
      throw new Error("kaputt");
    },
    save: () => protokoll.push("save"),
  };
  const { ausfall } = speicherBereiche(speicher);
  await assert.rejects(ausfall.alarmVersendet({ code: BUCKET, nowMs: NOW_MS, channels: [] }), /kaputt/);
  await assert.rejects(ausfall.sendeplatzReservieren({ bucket: BUCKET, nowMs: NOW_MS, frei: () => true }), /kaputt/);
  await assert.rejects(ausfall.holdKandidaten({ nowMs: NOW_MS, maxAgeMs: 1 }), /kaputt/);
  assert.deepEqual(protokoll, []);
});

test("ausfall: Schliessen ohne offenen Marker aendert nichts", async () => {
  const zustand = { outageAlerts: [marker(BUCKET, { closedAt: NOW_ISO })] };
  const { speicher } = rohspeicher(zustand);
  await speicherBereiche(speicher).ausfall.markerSchliessen({ code: BUCKET, nowMs: NOW_MS + 5000 });
  assert.equal(zustand.outageAlerts[0].closedAt, NOW_ISO);
});
