import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";

import { ROTER_TEST, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" } };

function laufMitIssue(context, issue) {
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, phase: { issue } });
  const prompts = readdirSync(werkzeug).filter((name) => name.startsWith("prompt-"));
  return { lauf, beleg, prompts };
}

test("lauf bricht ohne gültiges Phasen-Issue ab, bevor ein Agent läuft, und nennt Zweck und Ausweg", (context) => {
  for (const issue of [undefined, 0, -3, "54", 5.5, "https://github.com/sundartha/hermes/issues/54"]) {
    const { lauf, beleg, prompts } = laufMitIssue(context, issue);
    assert.equal(lauf.status, EXIT_ROT, `issue ${issue}: ${lauf.stdout}${lauf.stderr}`);
    assert.deepEqual([prompts, beleg], [[], null], `issue ${issue}`);
    assert.match(lauf.stderr, /issue muss die Nummer des Phasen-Issues sein\./);
    assert.match(lauf.stderr, /Entscheidung[\s\S]*Freigabe[\s\S]*"issue": <Nummer>/);
  }
});

test("lauf startet mit einer gültigen Issue-Nummer wie bisher", (context) => {
  const { lauf, prompts } = laufMitIssue(context, 54);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(prompts.length > 0);
});
