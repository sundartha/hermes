import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS } from "./auftrag-lauf-probe.js";
import { MIT_MUTATION, MUTANT, grenzenBau, listenLauf, zeigt } from "./auftrag-lauf-listen-probe.js";
import { runIn } from "./probe-repo.js";

const UNTERDRUECKUNGEN = JSON.stringify({ "src/text.js": { complexity: { count: 1 } } }, null, 2);
const GATES = JSON.stringify({ Probe: { module: ["src/a.js#eins", "src/text.js"], tests: ["test/a.test.js", "test/text.test.js"] } });
const TEXT_TS = "export function gross(text: string): string {\n  return text.toUpperCase();\n}\n";
const AUFTRAG = { id: "A1", art: "umbau", ziel: "Typisiere src/text.js", bereich: "src/text.js", erwarteteDateien: ["src/text.ts"], vorbild: "src/text.js", abnahme: "test/text.test.js" };
const DREHBUCH = { "bau-umbenennen": [["src/text.js", "src/text.ts"]], bau: { "src/text.ts": TEXT_TS } };
const NACH_UMZUG = "M\teslint-suppressions.json\nD\tsrc/text.js\nA\tsrc/text.ts\nM\ttest/text.test.js\nM\ttools/gate-tests.json\n";
const LISTEN = { "eslint-suppressions.json": UNTERDRUECKUNGEN, "tools/gate-tests.json": GATES };

function umbenannt(context, { drehbuch = DREHBUCH, skripte = {}, zusatz = {} } = {}) {
  return listenLauf(context, { auftrag: AUFTRAG, drehbuch, listen: LISTEN, skripte, zusatz });
}

test("auftrag-lauf-listenumzug: ein Umbau, der eine Datei nur mit Typen nach .ts umbenennt, endet mit Commit, in dem die Bestandslisten die neue Datei nennen", (context) => {
  const { repo, lauf, basis } = umbenannt(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(runIn(repo, "git", ["diff", "--name-status", "--no-renames", basis, "HEAD"]).stdout, NACH_UMZUG);
  assert.equal(zeigt(repo, "eslint-suppressions.json"), UNTERDRUECKUNGEN.replace("src/text.js", "src/text.ts"));
  assert.equal(zeigt(repo, "tools/gate-tests.json"), GATES.replace("src/text.js", "src/text.ts"));
});

test("auftrag-lauf-listenumzug: wiederholt der Lauf nach einem überlebenden Mutanten die Bau-Schritte, zählt grenzen bau den eigenen Listenumzug nicht als Verstoß", (context) => {
  const drehbuch = { ...DREHBUCH, "bau-nachrunde-antwort": `Gleichwertig: ${MUTANT}, weil nur der Typ dazukam` };
  const { repo, lauf, beleg } = umbenannt(context, { drehbuch, ...MIT_MUTATION });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(grenzenBau(beleg), [0, 0]);
  assert.equal(zeigt(repo, "eslint-suppressions.json"), UNTERDRUECKUNGEN.replace("src/text.js", "src/text.ts"));
});

test("auftrag-lauf-listenumzug: meldet der Bau-Agent in der Nachrunde einen alten Test, sieht grenzen bau den eigenen Listenumzug nicht als Verstoß", (context) => {
  const alterTest = BASIS["test/text.test.js"].replace('test("gross"', 'test("gross bleibt"');
  const zeile = "Alter Test hält altes Verhalten fest: test/gross.test.js:gross bleibt – Das Ziel verlangt nur Typen.";
  const drehbuch = { ...DREHBUCH, "bau-nachrunde-antwort": zeile, "notiz-antwort": "1. Klären" };
  const zusatz = { ...MIT_MUTATION.zusatz, "test/gross.test.js": alterTest };
  const { beleg } = umbenannt(context, { drehbuch, skripte: MIT_MUTATION.skripte, zusatz });
  assert.deepEqual(grenzenBau(beleg), [0, 0], JSON.stringify(beleg.pruefungen));
  assert.equal(beleg.alterTest?.datei, "test/gross.test.js");
});
