import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PIN_FEHLT } from "../../tools/auftrag/lauf.mjs";
import { ABSATZ_PIN, funktion, MIT_PIN_PRUEFUNG, MIT_UNTERSTRICH, PIN_MELDUNG, pruefung, ROTER_TEST, scheitertAnPinPruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

test("die Pin-Prüfung läuft direkt nach lint; ihr Befund geht vor jeder Mutationsprüfung in die nächste Runde", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_UNTERSTRICH, "bau-antwort": ABSATZ_PIN };
  const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  assert.equal(namen[namen.indexOf("lint") + 1], "pin-prüfung", namen.join(", "));
  assert.equal(pruefung(beleg, "pin-prüfung"), EXIT_ROT);
  assert.ok(!namen.some((name) => name.startsWith("mutation")), namen.join(", "));
  assert.equal(beleg.grund, `pin-prüfung endete mit Exit ${EXIT_ROT}.`);
  assert.ok(readFileSync(join(repo, "pin-aufrufe.txt"), "utf8").includes('"src/rechnen.js"'));
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  assert.ok(zweiteRunde.includes("src/rechnen.js") && zweiteRunde.includes(PIN_MELDUNG), zweiteRunde);
});

test("ist die Pin-Prüfung grün, geht der Auftrag weiter durch die Mutationsprüfung", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  assert.ok(namen.indexOf("pin-prüfung") === namen.indexOf("lint") + 1 && namen.indexOf("pin-prüfung") < namen.indexOf("mutation"), namen.join(", "));
});

test("fehlt das Pin-Skript, obwohl ein pre-commit-Hook da ist, scheitert die Pin-Prüfung laut, und die zweite Runde bekommt die Meldung", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" }, "bau-antwort": ABSATZ_PIN };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ".githooks/pre-commit": "#!/bin/sh\nexit 0\n" } });
  scheitertAnPinPruefung(lauf, beleg);
  assert.ok(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8").includes(PIN_FEHLT));
});

test("die Pin-Prüfung bekommt auch vorgemerkte TypeScript-Dateien", (context) => {
  const typdatei = "src/rechnen.ts";
  const auftrag = { ...funktion("2 !== 4"), bereich: typdatei, erwarteteDateien: [typdatei, "test/rechnen.test.js"] };
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { [typdatei]: "export const zwei: number = 2;\n" }, "bau-antwort": ABSATZ_PIN };
  const { repo } = starte(context, { auftrag, drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.ok(readFileSync(join(repo, "pin-aufrufe.txt"), "utf8").includes(`"${typdatei}"`));
});
