import assert from "node:assert/strict";
import { test } from "node:test";

import { anrufpause } from "../../tools/deploy-weg/anrufpause.mjs";
import { AUFWACHEN_TAKTE } from "../../tools/deploy-weg/takt.mjs";
import {
  anfragenAn,
  attrappeStarten,
  DEPLOY_TOKEN,
  einstellungenFuer,
  ohneAnfragenStarten,
  RENDER_SCHLUESSEL,
  sammler,
  testUhr,
  umgebungFuer,
  weltAnlegen,
  werkzeugStarten,
} from "./deploy-weg-attrappe.mjs";

const EXIT_OK = 0;
const EXIT_ROT = 1;
const ZWEI_ANRUFE = 2;
const PAUSE = /\/prod\/intern\/anrufpause$/;
const ANRUFE = /\/prod\/intern\/anrufe-laufend$/;
const MASKE = "::add-mask::";
const AUFRUF = /Aufruf: node tools\/deploy-weg\.mjs .*\| anrufpause --an ja\|nein/;
const FALSCHES_TOKEN = "f".repeat(DEPLOY_TOKEN.length);
const PROBE_ZEILE = "Jetzt ein Versuch über place_call; er muss mit „pausiert“ scheitern.";

async function pauseMit(kontext, { welt = {}, mehr = {}, an = true } = {}) {
  const uhr = testUhr();
  const attrappe = await attrappeStarten(kontext, weltAnlegen(welt), uhr);
  const einstellungen = einstellungenFuer("anrufpause", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const ok = await anrufpause({ einstellungen, an, ausgabe, uhr, takte: AUFWACHEN_TAKTE });
  return { ok, zeilen, text: zeilen.join("\n"), attrappe };
}

function pauseStand(lauf) {
  const { pausen } = lauf.attrappe.welt;
  return pausen.at(-1);
}

function pfade(lauf) {
  return lauf.attrappe.anfragen.map(({ methode, pfad }) => methode + " " + pfad);
}

test("anrufpause ja: setzt die Pause mit Deploy-Token, liest sie zurück und meldet laufende Anrufe", async (kontext) => {
  const lauf = await pauseMit(kontext, { welt: { laufend: [ZWEI_ANRUFE] } });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(pfade(lauf), [
    "GET /prod/healthz",
    "POST /prod/intern/anrufpause",
    "GET /prod/intern/anrufpause",
    "GET /prod/intern/anrufe-laufend",
  ]);
  const [setzen] = anfragenAn(lauf.attrappe, "POST", PAUSE);
  assert.deepEqual(setzen.koerper, { an: true });
  assert.equal(setzen.kopf, "Bearer " + DEPLOY_TOKEN);
  assert.equal(anfragenAn(lauf.attrappe, "GET", PAUSE)[0].kopf, "Bearer " + DEPLOY_TOKEN);
  assert.equal(pauseStand(lauf), true);
  assert.deepEqual(lauf.zeilen, [
    "Anrufpause angefordert: HTTP 200",
    "Anrufpause in Produktion: ja",
    "Laufende Anrufe: 2, sie laufen weiter",
    PROBE_ZEILE,
  ]);
});

test("anrufpause nein: gibt die Anrufe frei und verlangt keinen Versuch über place_call", async (kontext) => {
  const lauf = await pauseMit(kontext, { welt: { pausen: [true] }, an: false });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", PAUSE)[0].koerper, { an: false });
  assert.equal(pauseStand(lauf), false);
  assert.deepEqual(lauf.zeilen, [
    "Anrufpause angefordert: HTTP 200",
    "Anrufpause in Produktion: nein",
    "Laufende Anrufe: 0, sie laufen weiter",
  ]);
});

test("anrufpause rot bei 401: falsches Token, kein Rücklesen", async (kontext) => {
  const lauf = await pauseMit(kontext, { mehr: { HERMES_DEPLOY_TOKEN: FALSCHES_TOKEN } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Abbruch im Schritt anrufpause: HTTP 401/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", PAUSE), []);
  assert.doesNotMatch(lauf.text, /place_call/);
});

test("anrufpause rot, wenn die Antwort auf das Setzen einen anderen Wert meldet", async (kontext) => {
  const lauf = await pauseMit(kontext, { welt: { pauseAntwort: false } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Rot: Produktion meldet die Anrufpause nicht wie verlangt/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", PAUSE), []);
});

test("anrufpause rot, wenn das Rücklesen einen anderen Wert zeigt", async (kontext) => {
  const lauf = await pauseMit(kontext, { welt: { pauseGelesen: false } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Rot: Produktion meldet die Anrufpause nicht wie verlangt/);
  assert.doesNotMatch(lauf.text, /Anrufpause in Produktion/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", ANRUFE), []);
});

test("anrufpause bleibt grün, wenn die laufenden Anrufe nicht lesbar sind, und sagt es", async (kontext) => {
  const lauf = await pauseMit(kontext, { welt: { laufend: ["viele"] } });
  assert.equal(lauf.ok, true, lauf.text);
  assert.match(lauf.text, /Warnung: laufende Anrufe nicht lesbar \(HTTP 200\)/);
  assert.doesNotMatch(lauf.text, /sie laufen weiter/);
});

test("anrufpause weckt eine schlafende Produktion und ist rot, wenn sie nicht aufwacht", async (kontext) => {
  const geweckt = await pauseMit(kontext, { welt: { wach: [false, true] } });
  assert.equal(geweckt.ok, true, geweckt.text);
  assert.equal(geweckt.zeilen[0], "Produktion hat geschlafen und ist frisch geweckt");
  const schlaeft = await pauseMit(kontext, { welt: { wach: [false] } });
  assert.equal(schlaeft.ok, false);
  assert.match(
    schlaeft.text,
    /Rot: Produktion ist im Schritt anrufpause nach 5 Minuten nicht aufgewacht/,
  );
  assert.deepEqual(anfragenAn(schlaeft.attrappe, "POST", PAUSE), []);
});

test("anrufpause in GitHub Actions verlangt, dass alle Akteure freigeben dürfen", async (kontext) => {
  const fremd = await pauseMit(kontext, {
    mehr: { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "jonas986", GITHUB_TRIGGERING_ACTOR: "fremd" },
  });
  assert.equal(fremd.ok, false);
  assert.deepEqual(fremd.zeilen, ["Rot: Hand-Start durch einen Nutzer ohne Freigaberecht"]);
  assert.deepEqual(fremd.attrappe.anfragen, []);
  const frei = await pauseMit(kontext, {
    mehr: { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "jonas986", GITHUB_TRIGGERING_ACTOR: "" },
  });
  assert.equal(frei.ok, true, frei.text);
});

function ohneMasken(text) {
  return text
    .split("\n")
    .filter((zeile) => !zeile.startsWith(MASKE))
    .join("\n");
}

test("CLI anrufpause --an ja grün in Actions: Exit 0, Token nur in add-mask-Zeilen", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const umgebung = umgebungFuer(attrappe.basis, {
    GITHUB_ACTIONS: "true",
    GITHUB_ACTOR: "jonas986",
  });
  const lauf = await werkzeugStarten(["anrufpause", "--an", "ja"], umgebung);
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.match(lauf.ausgabe, /Ergebnis: ja/);
  assert.deepEqual(
    anfragenAn(attrappe, "POST", PAUSE).map(({ koerper }) => koerper),
    [{ an: true }],
  );
  assert.ok(lauf.ausgabe.includes(MASKE + DEPLOY_TOKEN));
  assert.ok(!ohneMasken(lauf.ausgabe).includes(DEPLOY_TOKEN));
  assert.ok(!ohneMasken(lauf.ausgabe).includes("127.0.0.1"));
});

test("CLI anrufpause vom Mac: weder Deploy-Token noch Render-Schlüssel stehen in der Ausgabe", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const lauf = await werkzeugStarten(["anrufpause", "--an", "ja"], umgebungFuer(attrappe.basis));
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.match(lauf.ausgabe, /Anrufpause in Produktion: ja/);
  assert.ok(!lauf.ausgabe.includes(DEPLOY_TOKEN));
  assert.ok(!lauf.ausgabe.includes(RENDER_SCHLUESSEL));
  assert.ok(!lauf.ausgabe.includes(MASKE));
});

test("CLI anrufpause --an nein mit falschem Token: Exit 1", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const umgebung = umgebungFuer(attrappe.basis, { HERMES_DEPLOY_TOKEN: FALSCHES_TOKEN });
  const lauf = await werkzeugStarten(["anrufpause", "--an", "nein"], umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Abbruch im Schritt anrufpause: HTTP 401/);
  assert.match(lauf.ausgabe, /Ergebnis: nein/);
});

test("CLI anrufpause mit einem anderen Wert als ja/nein meldet den Aufruf und fragt nichts ab", async (kontext) => {
  const falsch = [["anrufpause"], ["anrufpause", "--an", "true"]];
  const { attrappe, laeufe } = await ohneAnfragenStarten(kontext, falsch);
  assert.deepEqual(
    laeufe.map(({ status }) => status),
    [EXIT_ROT, EXIT_ROT],
  );
  assert.ok(laeufe.every(({ ausgabe }) => AUFRUF.test(ausgabe)));
  assert.deepEqual(attrappe.anfragen, []);
});

test("CLI anrufpause ohne Einstellungen nennt nur Token und Produktionsadresse", async () => {
  const lauf = await werkzeugStarten(["anrufpause", "--an", "ja"], {});
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: HERMES_DEPLOY_TOKEN/);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: PRODUKTION_URL/);
  assert.doesNotMatch(lauf.ausgabe, /RENDER_API_KEY/);
});
