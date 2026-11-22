import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mutantKandidaten, mutantReihenfolge, mutationUrteil } from "../../tools/pruefen.mjs";

const dateien = (anzahl) => Array.from({ length: anzahl }, (_, nr) => `test/x/t${String(nr).padStart(4, "0")}.test.js`);

test("301 Kandidaten werden auf 300 gekürzt und der Vermerk nennt beide Zahlen", () => {
  const { auswahl, kandidaten } = mutantKandidaten({ tests: dateien(301), geaendert: [] }, "", 300);
  assert.equal(auswahl.length, 300);
  assert.equal(kandidaten, 301);
  assert.deepEqual(auswahl, dateien(300));
});

test("300 und 299 Kandidaten bleiben ungekürzt", () => {
  assert.equal(mutantKandidaten({ tests: dateien(300), geaendert: [] }, "", 300).auswahl.length, 300);
  const { auswahl, kandidaten } = mutantKandidaten({ tests: dateien(299), geaendert: [] }, "", 300);
  assert.equal(auswahl.length, 299);
  assert.equal(kandidaten, 299);
});

test("geänderte Testdateien laufen immer mit, auch hinter Platz 300", () => {
  const tests = dateien(500);
  const geaendert = [tests[400], tests[450]];
  const { auswahl } = mutantKandidaten({ tests, geaendert }, "", 300);
  assert.ok(auswahl.includes(tests[400]));
  assert.ok(auswahl.includes(tests[450]));
  assert.ok(auswahl.length <= 302);
});

test("mehr geänderte Testdateien als die Obergrenze laufen alle", () => {
  const tests = dateien(20);
  const { auswahl } = mutantKandidaten({ tests, geaendert: tests.slice(10) }, "", 3);
  assert.equal(auswahl.length, 10);
  assert.ok(tests.slice(10).every((datei) => auswahl.includes(datei)));
});

test("mutantKandidaten liefert den Kürzungsvermerk nur bei Kürzung", () => {
  assert.deepEqual(mutantKandidaten({ tests: dateien(301), geaendert: [] }, "", 300).gekuerzt, { geprueft: 300, kandidaten: 301 });
  assert.deepEqual(mutantKandidaten({ tests: dateien(500), geaendert: [dateien(500)[400]] }, "", 300).gekuerzt, { geprueft: 300, kandidaten: 500 });
  assert.equal("gekuerzt" in mutantKandidaten({ tests: dateien(300), geaendert: [] }, "", 300), false);
});

function urteilBericht(prText, mutant) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-obergrenze-"));
  const zusammenfassung = join(ordner, "zusammenfassung.md");
  const vorher = { PR_TEXT: process.env.PR_TEXT, GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY, ROTPROBE_GRUEN: process.env.ROTPROBE_GRUEN };
  Object.assign(process.env, { PR_TEXT: prText, GITHUB_STEP_SUMMARY: zusammenfassung });
  delete process.env.ROTPROBE_GRUEN;
  const log = console.log;
  console.log = () => {};
  try {
    const gruen = mutationUrteil([mutant], 1);
    return { gruen, zeile: readFileSync(zusammenfassung, "utf8").split("\n").find((text) => text.includes("src/quelle.mjs:3/1`")) };
  } finally {
    console.log = log;
    for (const [name, wert] of Object.entries(vorher)) wert === undefined ? delete process.env[name] : (process.env[name] = wert);
  }
}

const GEKUERZT = { schluessel: "src/quelle.mjs:3/1", mutation: "StringLiteral: \"\"", ergebnis: "überlebt", gekuerzt: { geprueft: 300, kandidaten: 1585 } };

test("Ein gekürzter überlebter Mutant nennt „300 von 1585 Tests“ im Bericht und ist ohne Begründung rot", () => {
  const { gruen, zeile } = urteilBericht("## Überlebende Mutanten\n\n", GEKUERZT);
  assert.equal(gruen, false);
  assert.ok(zeile.includes("| überlebt (300 von 1585 Tests) | – |"));
});

test("Ein gekürzter überlebter Mutant ist mit Begründung im PR-Text grün", () => {
  const { gruen, zeile } = urteilBericht("## Überlebende Mutanten\n\n- `src/quelle.mjs:3/1`: äquivalent, der Text ändert nur die Anzeige und kein Ergebnis\n", GEKUERZT);
  assert.equal(gruen, true);
  assert.ok(zeile.includes("| überlebt (300 von 1585 Tests) | äquivalent"));
});

test("Ein überlebter Mutant ohne Kürzung trägt keinen Vermerk", () => {
  const { zeile } = urteilBericht("## Überlebende Mutanten\n\n", { ...GEKUERZT, gekuerzt: undefined });
  assert.ok(zeile.includes("| überlebt | – |"));
});

test("langsame Testdateien (gemessene Dauer ab 60 s) laufen zuletzt und fallen nicht unter die Obergrenze", () => {
  const tests = dateien(5);
  const dauer = { [tests[0]]: 61_000, [tests[1]]: 59_000 };
  assert.deepEqual(mutantReihenfolge({ tests, dauer }, "").slice(-1), [tests[0]]);
  assert.deepEqual(mutantReihenfolge({ tests, geaendert: [tests[0]], dauer }, "")[0], tests[0]);
  const { auswahl } = mutantKandidaten({ tests, dauer }, "", 2);
  assert.deepEqual(auswahl, [tests[1], tests[2], tests[0]]);
});
