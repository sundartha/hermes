import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 300000 };
const TEMPO_KURZ = 0.05;
const LANGES_WORT = "Gesamtkostenabrechnungsvorschlagsbestätigung";
const ZEILEN_KOPF = '<div class="rows">';

const laden = () => import("./widget-anruffolge-ueberlauf.mjs");

const mitEinschub = (html, einschub) => {
  assert.ok(html.includes(ZEILEN_KOPF));
  return html.replace(ZEILEN_KOPF, () => ZEILEN_KOPF + einschub);
};

test("Überlaufprüfung nennt bei Normalinhalt der ausgelieferten Anrufkarte keinen Treffer, aber Zeilen, Sprache und Ring", OPTIONS, async () => {
  const { messeUeberlauf } = await laden();
  const { call } = await ausgelieferteWidgets();
  const ergebnis = await messeUeberlauf(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ });
  assert.deepEqual(ergebnis.treffer, []);
  assert.equal(ergebnis.lang, "de");
  assert.equal(typeof ergebnis.ring_overflow, "string");
  assert.ok(ergebnis.ring_overflow.length > 0);
  const result = ergebnis.zeilen.find((zeile) => zeile.label === "Ergebnis");
  assert.equal(result.wert, "Der Termin am Donnerstag um 10 Uhr ist bestätigt.");
  assert.ok(ergebnis.zeilen.every((zeile) => zeile.label !== "" && typeof zeile.wert === "string"));
  assert.ok(!ergebnis.zeilen.some((zeile) => zeile.label === "Grund"));
});

test("Überlaufprüfung schlägt bei einem Element an, das über die Karte ragt, mit Klasse, Text und Überstand", OPTIONS, async () => {
  const { messeUeberlauf } = await laden();
  const { call } = await ausgelieferteWidgets();
  const html = mitEinschub(call, '<div class="zu-breit" style="width:900px;height:10px">Dieses Element ist zu breit für die Karte und ragt weit hinaus</div>');
  const ergebnis = await messeUeberlauf(chrome, html, { szenario: "voll_de", tempo: TEMPO_KURZ });
  const treffer = ergebnis.treffer.filter((eintrag) => eintrag.klasse === "zu-breit");
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].text, "Dieses Element ist zu breit für die Kart");
  assert.ok(treffer[0].ueberstand_px > 400);
});

test("Überlaufprüfung meldet das lange Wort, das seine Box innen sprengt, aber nicht den Ring und nicht verborgene Elemente", OPTIONS, async () => {
  const { messeUeberlauf } = await laden();
  const { call } = await ausgelieferteWidgets();
  const wort = `<div class="wort" style="width:100px;overflow:hidden;white-space:nowrap">${LANGES_WORT}</div>`;
  const verborgen = '<div class="versteckt" style="display:none;width:900px">unsichtbar breit</div>';
  const ergebnis = await messeUeberlauf(chrome, mitEinschub(call, wort + verborgen), { szenario: "lang_de_320", tempo: TEMPO_KURZ });
  assert.deepEqual(ergebnis.treffer.map((eintrag) => eintrag.klasse), ["wort"]);
  assert.equal(ergebnis.treffer[0].text, LANGES_WORT.slice(0, 40));
  assert.ok(ergebnis.treffer[0].ueberstand_px > 50);
});

test("Überlaufprüfung meldet ein Element, das nur senkrecht über die Karte ragt, nach unten wie nach oben", OPTIONS, async () => {
  const { messeUeberlauf } = await laden();
  const { call } = await ausgelieferteWidgets();
  const unten = '<div class="zu-tief" style="position:relative;top:3000px;width:50px;height:10px">unten</div>';
  const oben = '<div class="zu-hoch" style="position:relative;top:-3000px;width:50px;height:10px">oben</div>';
  const ergebnis = await messeUeberlauf(chrome, mitEinschub(call, unten + oben), { szenario: "voll_de", tempo: TEMPO_KURZ });
  assert.deepEqual(ergebnis.treffer.map((eintrag) => eintrag.klasse).sort(), ["zu-hoch", "zu-tief"]);
  assert.ok(ergebnis.treffer.every((eintrag) => eintrag.ueberstand_px > 1000));
});

test("Überlaufprüfung nimmt zu breite svg und canvas aus, meldet aber das zu breite div daneben", OPTIONS, async () => {
  const { messeUeberlauf } = await laden();
  const { call } = await ausgelieferteWidgets();
  const grafiken = '<svg class="svg-breit" width="900" height="10"></svg><canvas class="canvas-breit" style="width:900px;height:10px"></canvas>';
  const div = '<div class="div-breit" style="width:900px;height:10px">breit</div>';
  const ergebnis = await messeUeberlauf(chrome, mitEinschub(call, grafiken + div), { szenario: "voll_de", tempo: TEMPO_KURZ });
  const klassen = ergebnis.treffer.map((eintrag) => eintrag.klasse);
  assert.ok(klassen.includes("div-breit"));
  assert.ok(!klassen.includes("svg-breit"));
  assert.ok(!klassen.includes("canvas-breit"));
});
