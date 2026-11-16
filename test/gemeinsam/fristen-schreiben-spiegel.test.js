import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const A = "t_fws_a";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const SEKUNDE_MS = 1000;
const STANDARD_S = 1800;
const NEUN_STUNDEN_MS = 9 * 60 * 60 * SEKUNDE_MS;
const ANFRAGE = { art: "hoechstdauer", jetztMs: JETZT, limitJeMandant: 10, leaseMs: 30_000 };

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-schreiben-");
await speicher.oeffneSpeicher();

function anruf({ status = "active", abgehobenVorMs = null, abgehobenText = null, maxDurationS = undefined, frist = undefined } = {}) {
  const call = speicher.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: A });
  call.status = status;
  call.maxDurationS = maxDurationS;
  call.answeredAt = abgehobenText ?? (abgehobenVorMs === null ? null : new Date(JETZT - abgehobenVorMs).toISOString());
  call.fristHoechstdauerAt = frist;
  return call.id;
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Frist schreiben im JSON-Speicher: setzt die Frist eines aktiven Anrufs, einen beendeten laesst sie unveraendert", async () => {
  const aktiv = anruf();
  const beendet = anruf({ status: "completed" });
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeHoechstdauerFrist({ callId: aktiv, tenantId: A, faelligAt });
  await speicher.setzeHoechstdauerFrist({ callId: beendet, tenantId: A, faelligAt });
  assert.equal(speicher.getCall(aktiv).fristHoechstdauerAt, faelligAt);
  assert.equal(speicher.getCall(beendet).fristHoechstdauerAt, undefined);
});

test("Frist schreiben im JSON-Speicher: ein unbekannter Anruf wirft nicht", async () => {
  await speicher.setzeHoechstdauerFrist({ callId: "call_gibt_es_nicht", tenantId: A, faelligAt: "2031-05-06T07:08:09.000Z" });
});

test("Altzeile im JSON-Speicher: ohne Frist faellig nach Abheben plus eigener Hoechstdauer, davor nicht", async () => {
  const faellig = anruf({ abgehobenVorMs: 120 * SEKUNDE_MS, maxDurationS: 60 });
  const offen = anruf({ abgehobenVorMs: 30 * SEKUNDE_MS, maxDurationS: 60 });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.ok(ids(treffer).includes(faellig));
  assert.ok(!ids(treffer).includes(offen));
  const gefunden = treffer.find((eintrag) => eintrag.callId === faellig);
  assert.equal(gefunden.faelligAt, new Date(JETZT - 60 * SEKUNDE_MS).toISOString());
});

test("Altzeile im JSON-Speicher: ohne eigene Hoechstdauer gilt die Kappung von 1800 Sekunden, genau an der Grenze ist sie faellig", async () => {
  const genau = anruf({ abgehobenVorMs: STANDARD_S * SEKUNDE_MS });
  const knapp = anruf({ abgehobenVorMs: (STANDARD_S - 1) * SEKUNDE_MS });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes(genau));
  assert.ok(!treffer.includes(knapp));
});

test("Altzeile im JSON-Speicher: Zeitzonen-Versatz im Abhebe-Zeitstempel zaehlt als Zeitpunkt", async () => {
  const versetzt = new Date(JETZT - (STANDARD_S + 60) * SEKUNDE_MS + NEUN_STUNDEN_MS).toISOString().replace("Z", "+09:00");
  const faellig = anruf({ abgehobenText: versetzt });
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes(faellig));
});

test("Altzeile im JSON-Speicher: eine gesetzte Frist gilt vor dem Abhebe-Zeitpunkt, ohne Abheben und ohne Frist ist nichts faellig", async () => {
  const mitFrist = anruf({ abgehobenVorMs: 3 * 3600 * SEKUNDE_MS, frist: new Date(JETZT + 3600 * SEKUNDE_MS).toISOString() });
  const nieAbgehoben = anruf();
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(!treffer.includes(mitFrist));
  assert.ok(!treffer.includes(nieAbgehoben));
});
