import { test } from "node:test";
import assert from "node:assert/strict";
import { schneideFenster } from "./widget-anruffolge-messen.mjs";

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
