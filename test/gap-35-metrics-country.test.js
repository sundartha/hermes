// GAP-35 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-35").
// Telemetrie muss Land und Sprache tragen, sobald mehr als ein Land im Gate steht -
// sonst gibt es keine Log-Zeile, die einen laenderspezifischen Totalausfall sichtbar
// macht. Zwei Teile: (a) render.yaml-Datei-Test (Muster
// test/env-docs-spend-cap-coherence.test.js), (b) createMetrics()-API-Oberflaeche
// (src/metrics.js kennt sechs Ereignisse: llmCall/logTurn/recordTurnRendered/
// logTurnGap/logShimTurn/logSpeechResult - keines traegt country/language).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createMetrics } from "../src/metrics.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_YAML = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

function readRenderValue(text, name) {
  const m = text.match(new RegExp(`key:\\s*${name}\\s*\\n\\s*value:\\s*"?([^"\\n]+)"?`));
  if (!m) throw new Error(`${name} nicht in render.yaml gefunden`);
  return m[1].trim();
}

test("GAP-35 SOLL: render.yaml mit mehr als einem Land im Gate muss METRICS_ENABLED=true tragen", () => {
  const allowedCountryCodes = readRenderValue(RENDER_YAML, "ALLOWED_COUNTRY_CODES");
  const codeCount = allowedCountryCodes === "*" ? Infinity : allowedCountryCodes.split(",").length;
  assert.ok(
    codeCount > 1,
    `Vorbedingung: render.yaml oeffnet mehr als ein Land (war: '${allowedCountryCodes}')`,
  );
  const metricsEnabled = readRenderValue(RENDER_YAML, "METRICS_ENABLED");
  assert.equal(
    metricsEnabled,
    "true",
    "SOLL: 'wenn ab morgen 100% der Anrufe aus Land X scheitern - welche Log-Zeile sagt " +
      `das?' braucht METRICS_ENABLED=true im Mehr-Laender-Betrieb; heute: '${metricsEnabled}' ` +
      "(render.yaml:337-339)",
  );
});

test("GAP-35 SOLL: ein Ablehnungs-Ereignis traegt country/language (heute: kein Ablehnungs-Ereignis existiert ueberhaupt)", () => {
  const logged = [];
  const metrics = createMetrics({ enabled: true, log: (kind, payload) => logged.push({ kind, payload }) });
  const denialEvents = Object.keys(metrics).filter((name) => /denial|denied|reject/i.test(name));
  assert.ok(
    denialEvents.length > 0,
    "SOLL: createMetrics() muss ein Ablehnungs-Ereignis mit country/language-Dimensionen " +
      `anbieten; heute kennt es nur: ${Object.keys(metrics).join(", ")} - keines davon ist ein ` +
      "Ablehnungs-Ereignis (src/metrics.js:18,35,56,64,75,86,95). Ablehnungen laufen " +
      "ausschliesslich ueber audit() (outbound-gates.js:120-124), PII-arm ohne " +
      "Zielvorwahl/Land-Feld",
  );
});
