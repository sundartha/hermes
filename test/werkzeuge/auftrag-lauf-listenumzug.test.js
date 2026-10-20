import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS, starte } from "./auftrag-lauf-probe.js";
import { BASE_FILES, MANIFEST_BOTH, RENAMED_FILES } from "./feste-pfade-probe.js";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const OHNE = new Set(["package.json", ".github/CODEOWNERS", "scripts/pin.js", ".githooks/pre-commit", "src/schema.sql"]);
const SCHUTZ = Object.fromEntries(Object.entries(BASE_FILES).filter(([pfad]) => !OHNE.has(pfad)));
const PAKET = JSON.parse(BASIS["package.json"]);
const MUTANT = "src/text.ts:2:10 MethodExpression → text";
const ERSATZ_MUTATION = `const mutant = ${JSON.stringify(MUTANT)};
if (!process.argv.includes("--alter-stand") && !process.argv.includes(mutant)) process.exitCode = 1;
console.log(process.exitCode ? "Verstoß: Mutant überlebt: " + mutant : "grün: keiner überlebt");
`;
const UNTERDRUECKUNGEN = JSON.stringify({ "src/text.js": { complexity: { count: 1 } } }, null, 2);
const GATES = JSON.stringify({ Probe: { module: ["src/a.js#eins", "src/text.js"], tests: ["test/a.test.js", "test/text.test.js"] } });
const TEXT_TS = "export function gross(text: string): string {\n  return text.toUpperCase();\n}\n";
const AUFTRAG = { id: "A1", art: "umbau", ziel: "Typisiere src/text.js", bereich: "src/text.js", erwarteteDateien: ["src/text.ts"], vorbild: "src/text.js", abnahme: "test/text.test.js" };
const DREHBUCH = { "bau-umbenennen": [["src/text.js", "src/text.ts"]], bau: { "src/text.ts": TEXT_TS } };
const NACH_UMZUG = "M\teslint-suppressions.json\nD\tsrc/text.js\nA\tsrc/text.ts\nM\ttest/text.test.js\nM\ttools/gate-tests.json\n";

function dateien(skripte) {
  return {
    ...SCHUTZ,
    ...MANIFEST_BOTH,
    "package.json": JSON.stringify({ ...PAKET, scripts: { ...PAKET.scripts, lint: "node -e 0 --", ...skripte } }),
    "eslint.config.js": RENAMED_FILES["eslint.config.js"],
    "eslint-suppressions.json": UNTERDRUECKUNGEN,
    "tools/gate-tests.json": GATES,
    ".gitignore": `${BASIS[".gitignore"]}node_modules\n`,
  };
}

function umbenannt(context, { drehbuch = DREHBUCH, skripte = {}, zusatz = {} } = {}) {
  const vorbereiten = (repo) => symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  return starte(context, { auftrag: AUFTRAG, drehbuch, dateien: { ...dateien(skripte), ...zusatz }, vorbereiten });
}

function zeigt(repo, pfad) {
  return runIn(repo, "git", ["show", `HEAD:${pfad}`]).stdout;
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
  const { repo, lauf, beleg } = umbenannt(context, { drehbuch, skripte: { "test:mutation": "node mutation.mjs" }, zusatz: { "mutation.mjs": ERSATZ_MUTATION } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const grenzen = beleg.pruefungen.filter(({ name }) => name === "grenzen bau").map(({ exitCode }) => exitCode);
  assert.deepEqual(grenzen, [0, 0]);
  assert.equal(zeigt(repo, "eslint-suppressions.json"), UNTERDRUECKUNGEN.replace("src/text.js", "src/text.ts"));
});

test("auftrag-lauf-listenumzug: meldet der Bau-Agent in der Nachrunde einen alten Test, sieht grenzen bau den eigenen Listenumzug nicht als Verstoß", (context) => {
  const alterTest = BASIS["test/text.test.js"].replace('test("gross"', 'test("gross bleibt"');
  const zeile = "Alter Test hält altes Verhalten fest: test/gross.test.js:gross bleibt – Das Ziel verlangt nur Typen.";
  const drehbuch = { ...DREHBUCH, "bau-nachrunde-antwort": zeile, "notiz-antwort": "1. Klären" };
  const zusatz = { "mutation.mjs": ERSATZ_MUTATION, "test/gross.test.js": alterTest };
  const { beleg } = umbenannt(context, { drehbuch, skripte: { "test:mutation": "node mutation.mjs" }, zusatz });
  const grenzen = beleg.pruefungen.filter(({ name }) => name === "grenzen bau").map(({ exitCode }) => exitCode);
  assert.deepEqual(grenzen, [0, 0], JSON.stringify(beleg.pruefungen));
  assert.equal(beleg.alterTest?.datei, "test/gross.test.js");
});
