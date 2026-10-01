import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { agentFuer } from "../../tools/auftrag/agenten.mjs";

const ROLLE = "bau";
const KRITISCHE_ROLLE = "bau-kritisch";
const GATE_TESTS = new URL("../../tools/gate-tests.json", import.meta.url);
const FUNKTIONSANKER = /#.*$/;
const KRITISCH_OHNE_GATE_TEST = ["src/plans.js", "src/elevenlabs/convai.js"];
const PFAD_OHNE_GATE = "src/ohne-gate.js";

function pfadeDerGateListe() {
  const gates = Object.values(JSON.parse(readFileSync(GATE_TESTS, "utf8")));
  return gates.flatMap((gate) => [...gate.module, ...gate.tests]).map((pfad) => pfad.replace(FUNKTIONSANKER, ""));
}

function nichtKritisch(pfade) {
  return pfade.filter((pfad) => agentFuer(ROLLE, pfad) !== KRITISCHE_ROLLE);
}

test("jeder Pfad aus der Gate-Liste wird vom kritischen Agenten gebaut", () => {
  assert.deepEqual(nichtKritisch(pfadeDerGateListe()), []);
});

test("Preise und die ElevenLabs-Anbindung werden ohne Gate-Test vom kritischen Agenten gebaut", () => {
  assert.deepEqual(nichtKritisch(KRITISCH_OHNE_GATE_TEST), []);
});

test("ein Pfad ohne Gate und ohne Ergänzung wird vom normalen Agenten gebaut", () => {
  assert.equal(agentFuer(ROLLE, PFAD_OHNE_GATE), ROLLE);
});
