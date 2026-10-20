import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { kenntZweck, ohneZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT, outputLines, probeDirectory, runIn } from "./probe-repo.js";
import { EXIT_ROT, pruefeZwischen } from "./testwirkung-probe.js";
import { blockDanach, nurGenutzteIds, quelltext } from "./zweck-quellen.js";

const BEREICH = "tests";
const TESTWIRKUNG = "tools/testwirkung.mjs";
const MUTATION = "tools/mutationspruefung.mjs";
const LAUFZEIT = join(REPO_ROOT, "tools/testlaufzeit-pruefen.mjs");
const GRUPPEN_ANFANG = "  const gruppen = [";
const LISTEN_ENDE = "  ];";
const MIT_ZWECK = /^\[WIRKUNG_ZWECK\.[A-Z_]+, /;
const NEUE_TESTS = "...neueTestsVerstoesse(";
const ZWECK_KONSTANTE = /^const WIRKUNG_ZWECK = \{\n([\s\S]*?)\n\};$/m;
const ZWECK_WERT = /"(tests\/[a-z-]+)"/g;
const ROTER_AUSGANG = /\bEXIT_ROT\b/g;
const EXIT_OK = 0;
const EXIT_BEFUND = 1;

function listeAb(text, anfang) {
  const zeilen = text.split("\n");
  const beginn = zeilen.indexOf(anfang);
  assert.ok(beginn >= 0, `${anfang} fehlt`);
  const ende = zeilen.indexOf(LISTEN_ENDE, beginn);
  return zeilen.slice(beginn + 1, ende).map((zeile) => zeile.trim());
}

test("tools/zweck/tests.json hat genau die IDs, die Werkzeuge und Workflow-Schritte nennen", () => {
  nurGenutzteIds(BEREICH);
});

test("jede Verstoß-Quelle der Testwirkung gehört zu einer Gruppe mit Zweck-ID, und nur Gruppen werden gemeldet", () => {
  const text = quelltext(TESTWIRKUNG);
  const [, konstante] = ZWECK_KONSTANTE.exec(text);
  const ids = [...konstante.matchAll(ZWECK_WERT)].map(([, id]) => id);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(kenntZweck(id), id);
  const gruppen = listeAb(text, GRUPPEN_ANFANG);
  assert.deepEqual(gruppen.filter((zeile) => !MIT_ZWECK.test(zeile) && !zeile.startsWith(NEUE_TESTS)), []);
  const neueTests = listeAb(text.slice(text.indexOf("function neueTestsVerstoesse(")), "  return [");
  assert.deepEqual(neueTests.filter((zeile) => !MIT_ZWECK.test(zeile)), []);
  assert.equal(text.match(/console\.log\(`Verstoß: /g).length, 1);
  assert.match(text, /const gefunden = gruppen\.flatMap\(\(\[, liste\]\) => liste\);/);
});

test("die Mutationsprüfung endet nur rot, wenn sie die Zweck-Blöcke ihrer roten Arten nennt", () => {
  const text = quelltext(MUTATION);
  const rot = [...text.matchAll(ROTER_AUSGANG)].length;
  const mitBlock = text.match(/zeigeZweck\(rot\);\n {2}return rot\.size === 0 \? EXIT_GRUEN : EXIT_ROT;/g) ?? [];
  assert.equal(rot - 1, mitBlock.length, "jeder Ausgang EXIT_ROT folgt auf zeigeZweck");
  assert.match(text, /return roteZwecke\(\{ ueberlebende, zugriffe \}\);/);
  assert.match(text, /function roteZwecke\(\{ ueberlebende, zugriffe \}\) \{\n {2}return \[\.\.\.\(ueberlebende\.length > 0 \? \[ZWECK_UEBERLEBT\] : \[\]\), \.\.\.\(zugriffe\.length > 0 \? \[ZWECK_ZUSTAND\] : \[\]\)\];/);
});

test("die Testwirkung nennt nach der Zusammenfassung den Block der Verstoßart und lässt die verankerten Zeilen unverändert", (context) => {
  const ohne = 'import { test } from "node:test";\ntest("prüft nichts", () => {});\n';
  const lauf = pruefeZwischen(context, { "test/alt.test.js": 'import { test } from "node:test";\n' }, { "test/neu.test.js": ohne });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const zeilen = outputLines(lauf.stdout);
  assert.match(lauf.stdout, /^Verstoß: Test bleibt grün, obwohl jede Prüfung scheitert: test\/neu\.test\.js › prüft nichts$/m);
  assert.match(lauf.stdout, /^rot: 1 neue Tests, 1 ohne wirksame Prüfung, 0 wackeln in 5 Läufen, 0 nicht gelaufen\.$/m);
  const { block, gefunden } = blockDanach(zeilen, "tests/wirkung-leer", /^rot: /);
  assert.deepEqual(gefunden, block);
  for (const andere of ["tests/wirkung-wackeln", "tests/wirkung-katalog", "tests/wirkung-geaendert", "tests/wirkung-erreicht"]) {
    assert.ok(!zeilen.includes(zweckBlock(andere)[0]), andere);
  }
});

test("die Testlaufzeit nennt nach den Befunden den Block als eigene Absätze, ein grüner Lauf keinen", (context) => {
  const ordner = probeDirectory(context, {
    "hilfsdatei.jsonl": '{"datei":"test/helfer-probe.js","dauer_ms":5}\n',
    "sauber.jsonl": '{"datei":"test/eins.test.js","dauer_ms":5}\n',
  });
  const rot = runIn(REPO_ROOT, process.execPath, [LAUFZEIT, "--laufzeiten", join(ordner, "hilfsdatei.jsonl")]);
  assert.equal(rot.status, EXIT_BEFUND, rot.stdout + rot.stderr);
  const [, befunde] = rot.stdout.split("### Befunde\n");
  const block = zweckBlock("tests/testlaufzeit");
  assert.match(befunde, /^- Testfälle in test\/helfer-probe\.js: /);
  assert.ok(befunde.endsWith(`${block.map((zeile) => `\n${zeile}\n`).join("")}`), befunde);
  assert.deepEqual(ohneZweck(befunde.split("\n")).filter((zeile) => zeile !== "").length, 1);
  const gruen = runIn(REPO_ROOT, process.execPath, [LAUFZEIT, "--laufzeiten", join(ordner, "sauber.jsonl")]);
  assert.equal(gruen.status, EXIT_OK, gruen.stdout + gruen.stderr);
  assert.doesNotMatch(gruen.stdout, /Wozu:/);
});

test("der CI-Schritt Tests zeigt bei Rot den Block der Regressionsbank", () => {
  const ci = quelltext(".github/workflows/ci.yml");
  assert.match(ci, /- name: Tests\n {8}id: tests\n/);
  assert.match(ci, /- name: Zweck der Tests\n {8}if: failure\(\) && steps\.tests\.outcome == 'failure'\n {8}run: node tools\/zweck-zeigen\.mjs tests\/regression\n/);
});
