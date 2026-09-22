// T2-02 (T-34): cache-feste, sprachunabhaengige Resource-URIs. Pin-Test fuer
// src/ui/widget-versions.json (S7 der Spec):
//   (a) SHA-256(widgetHtml(id)) == Pin der hoechsten Version je Widget, mit
//       Positiv-Kontrolle (ein veraendertes Byte MUSS genau einen Fund ergeben -
//       sonst prueft der Test nichts, Lehre pruefkommando-ohne-positiv-kontrolle).
//   (b) keine zwei Versionen desselben Widgets teilen einen Hash.
//   (c) jedes Widget hat einen Pin, kein Pin ohne Widget.
//   (d) Groessenbudget: das Widget-HTML darf gegenueber der a941d23-Baseline
//       (vor T2-02) hoechstens um einen benannten Faktor wachsen.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
  WIDGET_CALL,
  hasWidget,
  widgetHtml,
  widgetVersion,
} from "../src/ui/widget-catalog.js";

const ALL_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS, WIDGET_CALENDAR, WIDGET_CALL];

const PINS_PATH = fileURLToPath(new URL("../src/ui/widget-versions.json", import.meta.url));

function loadPins() {
  return JSON.parse(readFileSync(PINS_PATH, "utf8"));
}

function sha256Of(html) {
  return crypto.createHash("sha256").update(html, "utf8").digest("hex");
}

// Reine Pruefloglogik (S7 (a)/(b)): welche Widget-Ids tragen einen veralteten Pin -
// der SHA-256 des AUSGELIEFERTEN HTML weicht vom Pin der hoechsten Version ab?
// htmlById: { widgetId -> html }. pins: das geparste widget-versions.json (inkl.
// "_comment", wird uebersprungen). Kein Netz-/Datei-Zugriff hier (F.I.R.S.T. - die
// Positiv-Kontrolle mutiert nur htmlById, nie die Pin-Datei).
export function stalePins(htmlById, pins) {
  const stale = [];
  for (const [widgetId, html] of Object.entries(htmlById)) {
    const versions = pins[widgetId];
    if (!versions || typeof versions !== "object") {
      stale.push(widgetId);
      continue;
    }
    const highest = Math.max(...Object.keys(versions).map(Number));
    if (sha256Of(html) !== versions[String(highest)]) stale.push(widgetId);
  }
  return stale;
}

test("S7(a) Pin-Test: SHA-256(widgetHtml(id)) == Pin der hoechsten Version - HTML-Aenderung verlangt eine neue Version", () => {
  const pins = loadPins();
  const htmlById = Object.fromEntries(ALL_WIDGET_IDS.map((id) => [id, widgetHtml(id)]));

  assert.deepEqual(
    stalePins(htmlById, pins),
    [],
    "veralteter Pin gefunden - Regel: neue Version anhaengen (naechste ganze Zahl), " +
      "alten Eintrag NIE ueberschreiben (s. widget-versions.json _comment)",
  );
});

test("S7(a) Positiv-Kontrolle: ein veraendertes Byte im HTML ergibt GENAU einen Fund", () => {
  const pins = loadPins();
  const htmlById = Object.fromEntries(ALL_WIDGET_IDS.map((id) => [id, widgetHtml(id)]));

  // Build: erst die unveraenderte Menge (muss leer sein, sonst ist die
  // Kontrolle selbst nicht aussagekraeftig).
  assert.deepEqual(stalePins(htmlById, pins), [], "Ausgangslage muss sauber sein");

  // Operate: ein Byte in GENAU einem Widget-HTML aendern.
  const mutated = { ...htmlById, [WIDGET_MY_NUMBER]: `${htmlById[WIDGET_MY_NUMBER]} ` };

  // Check: GENAU dieses eine Widget faellt auf, kein anderes.
  assert.deepEqual(stalePins(mutated, pins), [WIDGET_MY_NUMBER]);
});

test("S7(b) keine zwei Versionen desselben Widgets teilen einen Hash", () => {
  const pins = loadPins();
  for (const widgetId of ALL_WIDGET_IDS) {
    const versions = pins[widgetId];
    const hashes = Object.values(versions);
    assert.equal(
      new Set(hashes).size,
      hashes.length,
      `${widgetId}: zwei Versionen mit demselben Hash - eine neue Version muss inhaltlich neu sein`,
    );
  }
});

test("S7(c) jedes Widget hat einen Pin, kein Pin ohne Widget", () => {
  const pins = loadPins();
  const pinnedIds = Object.keys(pins).filter((key) => !key.startsWith("_"));

  for (const widgetId of ALL_WIDGET_IDS) {
    assert.ok(hasWidget(widgetId), `${widgetId}: kein Pin - hasWidget() muesste fail-closed auf Stufe-0-only fallen`);
    assert.ok(Object.prototype.hasOwnProperty.call(pins, widgetId), `${widgetId}: kein Eintrag in widget-versions.json`);
  }
  assert.deepEqual(
    [...pinnedIds].sort(),
    [...ALL_WIDGET_IDS].sort(),
    "widget-versions.json traegt einen Pin fuer ein Widget, das der Katalog nicht kennt (oder umgekehrt)",
  );
});

test("S1 hasWidget() faellt fail-closed auf Stufe-0-only, wenn ein Pin fehlt", () => {
  assert.equal(hasWidget("kein-solches-widget"), false);
  assert.equal(widgetVersion("kein-solches-widget"), null);
});

// S7 (d): Groessenbudget. Baselines gemessen an a941d23 (letzter Commit VOR T2-02),
// groesste (und einzige) Fassung je Widget in Byte - benannte Konstanten statt
// verstreuter Magic Numbers (G25). BUDGET_FACTOR als benannte Konstante: Erwartung
// laut Spec-Pre-Mortem 7 ist ca. +1-3% (das eingebettete I18N_SCRIPT traegt jetzt
// ALLE Sprachtabellen statt nur einer) - 1.10 laesst Luft, ohne einen echten
// Aufblaeh-Regressionsfehler zu verdecken.
const BASELINE_BYTES_A941D23 = {
  [WIDGET_AGENT_STATUS]: 214943,
  [WIDGET_MY_NUMBER]: 213294,
  [WIDGET_CALLS]: 214450,
  [WIDGET_CALENDAR]: 213767,
  [WIDGET_CALL]: 247763,
};
const BUDGET_FACTOR = 1.1;

test("S7(d) Groessenbudget: hoechstens +10% gegenueber der a941d23-Baseline (Bestandsgrenze 260KB fuer call.html bleibt gueltig)", () => {
  for (const widgetId of ALL_WIDGET_IDS) {
    const size = Buffer.byteLength(widgetHtml(widgetId), "utf8");
    const budget = BASELINE_BYTES_A941D23[widgetId] * BUDGET_FACTOR;
    assert.ok(
      size <= budget,
      `${widgetId}: ${size} Byte ueberschreitet das Budget ${budget} Byte (Baseline ${BASELINE_BYTES_A941D23[widgetId]} * ${BUDGET_FACTOR})`,
    );
  }
});
