import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { ROTER_TEST, VERDOPPELT, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const STATISCH = "tests/statisch";
const ABSATZ = `Zweck ${STATISCH}: Drehbuchtext des Ersatz-Agenten.`;
const MIT_TEMPLATE_NAMEN = ROTER_TEST.replace('test("verdoppelt",', "test(`verdoppelt ${2}`,");
const VERSTOSS = "Verstoß: Test ohne festen Namen: test/rechnen.test.js › `verdoppelt ${2}`";

test("die statische Testprüfung läuft direkt nach der Grenzprüfung des Test-Agenten und ist bei festen Testnamen grün", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  assert.equal(namen[namen.indexOf("grenzen test") + 1], STATISCH, namen.join(", "));
  assert.equal(pruefung(beleg, STATISCH), 0, JSON.stringify(beleg.pruefungen));
});

test("schreibt der Test-Agent einen Test mit Template-Namen, hält lauf vor dem Bau an und gibt dem Test-Agenten Befund und Zweck-Text", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": MIT_TEMPLATE_NAMEN }, "test-antwort": ABSATZ, bau: { "src/rechnen.js": VERDOPPELT } };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  const ergebnis = { status: lauf.status, ergebnis: beleg.ergebnis, grund: beleg.grund, exitCode: pruefung(beleg, STATISCH) };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, ergebnis: "rot", grund: `${STATISCH} endete mit Exit ${EXIT_ROT}.`, exitCode: EXIT_ROT }, lauf.stdout + lauf.stderr);
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  for (const teil of [VERSTOSS, zweckBlock(STATISCH)[0], `dem Test-Agenten: ${STATISCH}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
});
