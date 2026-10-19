import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ausgang } from "../../tools/auftrag/ausgang.mjs";
import { GRUEN } from "../../tools/auftrag/bericht.mjs";
import { ROTER_TEST, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const GRUND = "gross erwartet einen Text, der Abnahmetest übergibt eine Zahl.";
const BEFUND = `Abnahmetest widerspricht bestehendem Code: src/text.js:2 – ${GRUND}`;
const FALL_AUS_TEXT = "verdoppelt die Zahl aus einem Text";
const FALSCHE_DATEN = `${ROTER_TEST}test(${JSON.stringify(FALL_AUS_TEXT)}, () => assert.equal(verdopple("2"), 4));\n`;
const RICHTIGE_DATEN = `${ROTER_TEST}test(${JSON.stringify(FALL_AUS_TEXT)}, () => assert.equal(verdopple(Number("2")), 4));\n`;
const VERDOPPELT = { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" };
const ABNAHME = "test/rechnen.test.js";
const ROTE_RUNDEN_BIS_ZUM_STOPP = 2;
const ABNAHMETESTS_MIT_EINEM_BEFUND = 2;
const COMMITS_EINES_GRUENEN_AUFTRAGS = "1";
const BERECHNETER_FALL = `${ROTER_TEST}const FALL = ${JSON.stringify(FALL_AUS_TEXT)};\ntest(FALL, () => assert.equal(verdopple("2"), 4));\n`;
const OHNE_FALL = 'import assert from "node:assert/strict";\nthrow new Error("2 !== 4");\n';
const MIT_HILFE = `${ROTER_TEST}import * as hilfe from "./fall.js";\nif (hilfe.MIT_FALL) test(${JSON.stringify(FALL_AUS_TEXT)}, () => assert.equal(verdopple("2"), 4));\n`;
const HILFE_OHNE_FALL = { ...VERDOPPELT, "test/fall.js": "export const MIT_FALL = false;\n" };
const TEST_NACH = "prompt-test-nach.txt";
const BAU_NACH = "prompt-bau-nach.txt";

const KEIN_CODE = { "docs/hinweis.md": "eins\nzwei\ndrei\n", "plaene/P-1-probe/notiz.js": "export const eins = 1;\nexport const zwei = 2;\n", "test/fall.js": "export const MIT_FALL = true;\n" };

function mitBefund(context, zeile, nachher) {
  const drehbuch = { nach: zeile, test: { [ABNAHME]: FALSCHE_DATEN }, bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären", ...nachher };
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: KEIN_CODE });
}

function geschriebeneAbnahmetests(repo) {
  const eintraege = runIn(repo, "git", ["reflog", "--format=%gs"]).stdout.split("\n");
  return eintraege.filter((eintrag) => eintrag.startsWith("commit: Zwischenstand: Abnahmetest")).length;
}

test("die Zeile zum Abnahmetest liest das Skript nur beim Bau-Agenten, mit Datei, Zeilennummer und Grund", () => {
  assert.deepEqual(ausgang(BEFUND, "bau").testbefund, { datei: "src/text.js", nummer: 2, grund: GRUND, zeile: BEFUND });
  const beimTest = ausgang(BEFUND, "test");
  assert.deepEqual([beimTest.testbefund, beimTest.ausstieg], [null, null]);
  const ohneZeile = "Abnahmetest widerspricht bestehendem Code: src/text.js – ohne Zeilennummer";
  assert.deepEqual([ausgang(ohneZeile, "bau").testbefund, ausgang(ohneZeile, "bau").ausstieg], [null, ohneZeile]);
});

test("widerspricht der Abnahmetest bestehendem Code, schreibt der Test-Agent ihn mit Befund und altem Test neu, ohne rote Runde", (context) => {
  const { lauf, beleg, werkzeug, repo, basis } = mitBefund(context, BEFUND, { "test-nach": { [ABNAHME]: RICHTIGE_DATEN }, "bau-nach": VERDOPPELT, "bau-nach-antwort": "Fertig." });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([beleg.ergebnis, beleg.runde], [GRUEN, 1]);
  const neu = readFileSync(join(werkzeug, TEST_NACH), "utf8");
  for (const teil of [BEFUND, 'verdopple("2")', FALL_AUS_TEXT]) assert.ok(neu.includes(teil), teil);
  assert.equal(readFileSync(join(repo, ABNAHME), "utf8"), RICHTIGE_DATEN);
  assert.equal(runIn(repo, "git", ["rev-list", "--count", `${basis}..HEAD`]).stdout.trim(), COMMITS_EINES_GRUENEN_AUFTRAGS);
});

test("ein zweiter Befund zum Abnahmetest im selben Auftrag gilt als „Auftrag passt nicht“", (context) => {
  const { lauf, beleg, werkzeug, repo } = mitBefund(context, BEFUND, { "test-nach": { [ABNAHME]: RICHTIGE_DATEN }, "bau-nach": VERDOPPELT, "bau-nach-antwort": BEFUND });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(existsSync(join(werkzeug, TEST_NACH)));
  assert.equal(geschriebeneAbnahmetests(repo), ABNAHMETESTS_MIT_EINEM_BEFUND);
  assert.deepEqual([beleg.ausstieg, beleg.runden], [BEFUND, []]);
  assert.ok(beleg.entscheidung.text.includes(`\nAuftrag passt nicht: ${BEFUND}\n`), beleg.entscheidung.text);
});

test("nennt der Befund eine Testdatei, eine .md-Datei, eine Datei unter plaene/, einen Ordner, eine fehlende Datei, eine Datei außerhalb des Repos oder eine Zeile außerhalb der Datei, hat der Auftrag keinen Test-Agenten oder lädt der verworfene Test keinen Fall, gilt er als „Auftrag passt nicht“", (context) => {
  const ohneTestAgent = starte(context, { auftrag: UMBAU, drehbuch: { nach: BEFUND, "bau-antwort": BEFUND, "notiz-antwort": "1. Klären" } });
  assert.deepEqual([ohneTestAgent.beleg.ausstieg, existsSync(join(ohneTestAgent.werkzeug, BAU_NACH))], [BEFUND, false]);
  const ohneFall = mitBefund(context, BEFUND, { test: { [ABNAHME]: OHNE_FALL } });
  assert.deepEqual([ohneFall.beleg.ausstieg, existsSync(join(ohneFall.werkzeug, TEST_NACH))], [BEFUND, false]);
  const stellen = ["test/text.test.js:2", "docs/hinweis.md:2", "plaene/P-1-probe/notiz.js:1", "./plaene/P-1-probe/notiz.js:1", "src:1", "src/gibt-es-nicht.js:1", "../aussen.js:1", "src/text.js:4", "src/text.js:0"];
  for (const zeile of stellen.map((stelle) => `Abnahmetest widerspricht bestehendem Code: ${stelle} – ${GRUND}`)) {
    const { beleg, werkzeug } = mitBefund(context, zeile, {});
    assert.deepEqual([beleg.ausstieg, beleg.runden, existsSync(join(werkzeug, TEST_NACH))], [zeile, [], false], zeile);
  }
});

function ohneVerworfenenFall(context, neuerTest, { verworfen = FALSCHE_DATEN, bau = VERDOPPELT } = {}) {
  const { lauf, beleg, werkzeug } = mitBefund(context, BEFUND, { test: { [ABNAHME]: verworfen }, bau, "test-nach": { [ABNAHME]: neuerTest }, "bau-nach": VERDOPPELT });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(existsSync(join(werkzeug, BAU_NACH)), false);
  assert.equal(beleg.runden.length, ROTE_RUNDEN_BIS_ZUM_STOPP);
  for (const runde of beleg.runden) assert.ok(runde.includes(FALL_AUS_TEXT), runde);
}

test("lässt der neu geschriebene Abnahmetest einen Fall des verworfenen weg, auch einen mit berechnetem Namen oder einen, den der Bau-Agent über eine Testhilfe abgeschaltet hat, ist die Runde rot", (context) => {
  ohneVerworfenenFall(context, ROTER_TEST);
  ohneVerworfenenFall(context, ROTER_TEST, { verworfen: BERECHNETER_FALL });
  ohneVerworfenenFall(context, ROTER_TEST, { verworfen: MIT_HILFE, bau: HILFE_OHNE_FALL });
});

test("führt der neu geschriebene Abnahmetest einen Fall des verworfenen nur als todo, ist die Runde rot", (context) => {
  ohneVerworfenenFall(context, `${ROTER_TEST}test.todo(${JSON.stringify(FALL_AUS_TEXT)});\n`);
});
