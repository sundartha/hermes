import { test } from "node:test";
import assert from "node:assert/strict";
import { bewerteChromeMetriken } from "./widget-anruffolge-messen.mjs";

const GEFUELLT = { n: 479 };
const LEER = { n: 0 };

test("Gesprächsfenster mit Stilberechnungen und Aufgabenzeit gilt als gemessen, auch ohne neues Layout", () => {
  assert.equal(bewerteChromeMetriken({ LayoutCount: 1, RecalcStyleCount: 480, ScriptDuration: 0.1, TaskDuration: 0.7 }, GEFUELLT), "ok");
  assert.equal(bewerteChromeMetriken({ LayoutCount: 0, RecalcStyleCount: 480, ScriptDuration: 0.1, TaskDuration: 0.7 }, GEFUELLT), "ok");
});

test("Gesprächsfenster ohne jede Chrome-Metrik trotz gefülltem Fenster wird als fehlende Chrome-Auskunft gemeldet", () => {
  assert.equal(bewerteChromeMetriken({ LayoutCount: 0, RecalcStyleCount: 0, ScriptDuration: 0, TaskDuration: 0 }, GEFUELLT), "Chrome liefert keine Metriken für das Gesprächsfenster");
});

test("Fenster ohne Zeichnungen bleibt als Messfenster leer rot, auch wenn Chrome nichts liefert", () => {
  assert.equal(bewerteChromeMetriken({ LayoutCount: 0, RecalcStyleCount: 0, ScriptDuration: 0, TaskDuration: 0 }, LEER), "Messfenster leer");
  assert.equal(bewerteChromeMetriken({ LayoutCount: 1, RecalcStyleCount: 480, ScriptDuration: 0.1, TaskDuration: 0.7 }, LEER), "Messfenster leer");
});

test("Gesprächsfenster mit Aufgabenzeit, aber ohne Stilberechnung ist ein Messfehler und kein Überspringen", () => {
  assert.equal(bewerteChromeMetriken({ LayoutCount: 0, RecalcStyleCount: 0, ScriptDuration: 0.1, TaskDuration: 0.7 }, GEFUELLT), "Chrome-Metriken widersprüchlich");
});
