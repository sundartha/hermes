import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge, schneideFenster, summiereVerschiebungen } from "./widget-anruffolge-messen.mjs";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 120000 };
const FENSTER = { von: 100, bis: 200, von_sim_ms: 1000, bis_sim_ms: 2000 };

function roh(verschiebungen, fenster = FENSTER) {
  return { fenster, rafs: [], zeichnungen: [], proben: [], langaufgaben: [], verschiebungenMitZeit: verschiebungen };
}

test("Layout-Verschiebungen der Ladephase vor dem Abheben zählen nicht zum Gesprächsfenster", () => {
  const im = schneideFenster(roh([[10, 0.5], [99, 0.25], [150, 0.125]]));
  assert.deepEqual(im.verschiebungen, [[150, 0.125]]);
});

test("Layout-Verschiebungen nach dem Gesprächsende zählen nicht zum Gesprächsfenster", () => {
  const im = schneideFenster(roh([[100, 0.25], [200, 0.125], [201, 0.5]]));
  assert.deepEqual(im.verschiebungen, [[100, 0.25], [200, 0.125]]);
});

test("Layout-Verschiebungen bei offenem Fenster zählen ab dem Abheben", () => {
  const im = schneideFenster(roh([[50, 0.5], [500, 0.25]], { von: 100, bis: null, von_sim_ms: 1000, bis_sim_ms: null }));
  assert.deepEqual(im.verschiebungen, [[500, 0.25]]);
});

test("Rohdaten ohne Zeitliste der Verschiebungen ergeben im Gesprächsfenster keine Verschiebungen", () => {
  const ohne = roh([]);
  delete ohne.verschiebungenMitZeit;
  assert.deepEqual(schneideFenster(ohne).verschiebungen, []);
});

test("Summe der Verschiebungen im Gesprächsfenster addiert die Werte", () => {
  assert.equal(summiereVerschiebungen([[1, 0.25], [2, 0.125]]), 0.375);
});

test("Summe ohne Verschiebungen im Gesprächsfenster ist null", () => {
  assert.equal(summiereVerschiebungen([]), 0);
});

test("Messung der Anruffolge kennzeichnet layout_shift als gesamte Anruffolge und nennt den Wert des Gesprächsfensters", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const lauf = await messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: 0.1 });
  assert.equal(lauf.layout_shift_bereich, "gesamte Anruffolge");
  assert.ok(lauf.layout_shift_fenster >= 0 && lauf.layout_shift_fenster <= lauf.layout_shift);
});
