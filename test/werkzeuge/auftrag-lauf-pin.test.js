import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_PIN, funktion, MIT_PIN_PRUEFUNG, MIT_UNTERSTRICH, namen, PIN_MELDUNG, pruefung, ROTER_TEST, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const PIN = "pin-prüfung";
const OHNE_SKRIPT = "Pin-Prüfung: scripts/check-staged-suppressions.js fehlt.";

test("die Pin-Prüfung läuft vor der Abnahme; ihr Befund hält den Commit auf und geht in die nächste Runde des Bau-Agenten", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_UNTERSTRICH, "bau-antwort": ABSATZ_PIN };
  const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(pruefung(beleg, "commit"), undefined, JSON.stringify(beleg.pruefungen));
  const liste = namen(beleg);
  assert.ok(liste.indexOf(PIN) < liste.indexOf("abnahme"), liste.join(", "));
  assert.equal(pruefung(beleg, PIN), EXIT_ROT);
  assert.equal(beleg.grund, `${PIN} endete mit Exit ${EXIT_ROT}.`);
  assert.ok(readFileSync(join(repo, "pin-aufrufe.txt"), "utf8").includes('"src/rechnen.js"'));
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  assert.ok(zweiteRunde.includes("src/rechnen.js") && zweiteRunde.includes(PIN_MELDUNG), zweiteRunde);
});

test("ist die Pin-Prüfung grün, geht der Auftrag weiter bis zum Commit", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const liste = namen(beleg);
  assert.equal(pruefung(beleg, PIN), 0, JSON.stringify(beleg.pruefungen));
  assert.ok(liste.indexOf(PIN) < liste.indexOf("abnahme") && liste.indexOf("abnahme") < liste.indexOf("commit"), liste.join(", "));
});

test("fehlt das Pin-Skript, meldet lauf das einmal als Hinweis und der Auftrag läuft ohne Pin-Prüfung grün durch", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(!namen(beleg).includes(PIN), namen(beleg).join(", "));
  assert.deepEqual(beleg.hinweise.filter((hinweis) => hinweis.startsWith("Pin-Prüfung")), [OHNE_SKRIPT], JSON.stringify(beleg.hinweise));
});

test("die Pin-Prüfung bekommt auch vorgemerkte TypeScript-Dateien", (context) => {
  const typdatei = "src/rechnen.ts";
  const auftrag = { ...funktion("2 !== 4"), bereich: typdatei, erwarteteDateien: [typdatei, "test/rechnen.test.js"] };
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { [typdatei]: "export const zwei: number = 2;\n" }, "bau-antwort": ABSATZ_PIN };
  const { repo } = starte(context, { auftrag, drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.ok(readFileSync(join(repo, "pin-aufrufe.txt"), "utf8").includes(`"${typdatei}"`));
});
