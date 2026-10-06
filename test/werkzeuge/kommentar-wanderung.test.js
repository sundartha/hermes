import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/kommentar-wanderung.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_ABORT = 2;
const CODE = "export const wert = true;";
const KOMMENTAR = [
  "// Der Abruf wartet höchstens zehn Sekunden auf",
  "// die Antwort des Anbieters, danach bricht er ab.",
];
const SATZ = "Der Abruf wartet höchstens zehn Sekunden auf die Antwort des Anbieters.";

function quelle(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

function basisRepo(context) {
  const directory = probeRepository(context, {
    "eslint.config.mjs": "export default [];\n",
    "src/abruf.js": quelle([...KOMMENTAR, CODE]),
    ".github/workflows/probe.yml": quelle(["name: Probe", "# Der Lauf startet nur auf master und nie für Forks", "on: push"]),
    "docs/notiz.md": quelle(["# Notiz", ""]),
  });
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return { directory, basis };
}

function nachher({ directory, basis }, dateien) {
  writeFiles(directory, dateien);
  commitAll(directory, "Nachher");
  const run = runIn(directory, process.execPath, [TOOL, "--basis", basis]);
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const OHNE_KOMMENTAR = { "src/abruf.js": quelle([CODE]) };

test("kommentar-wanderung: ein Kommentarsatz, der nach Markdown wandert, ist rot, auch umbrochen", (context) => {
  const lauf = nachher(basisRepo(context), {
    ...OHNE_KOMMENTAR,
    "docs/notiz.md": quelle(["# Notiz", "", "Der Abruf wartet höchstens", "zehn Sekunden auf die Antwort."]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /Kommentar aus src\/abruf\.js:1 taucht in docs\/notiz\.md:3 wieder auf/);
  assert.match(lauf.output, /Markdown-Zuwachs im PR: 2 Zeilen/);
});

test("kommentar-wanderung: ein Kommentarsatz, der in eine Zeichenkette wandert, ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    "src/abruf.js": quelle([CODE, `export const HINWEIS = ${JSON.stringify(SATZ)};`]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /taucht in src\/abruf\.js:2 wieder auf/);
});

test("kommentar-wanderung: ein YAML-Kommentar, der nach Markdown wandert, ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    ".github/workflows/probe.yml": quelle(["name: Probe", "on: push"]),
    "docs/notiz.md": quelle(["# Notiz", "", "Der Lauf startet nur auf master und nie für Forks."]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /Kommentar aus \.github\/workflows\/probe\.yml:2/);
});

test("kommentar-wanderung: ein nur gelöschter Kommentar ist grün", (context) => {
  const lauf = nachher(basisRepo(context), OHNE_KOMMENTAR);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.match(lauf.output, /1 entfernte Kommentare, 0 wieder aufgetaucht/);
});

test("kommentar-wanderung: fünf gleiche Wörter sind grün", (context) => {
  const lauf = nachher(basisRepo(context), {
    ...OHNE_KOMMENTAR,
    "docs/notiz.md": quelle(["# Notiz", "", "Der Abruf wartet höchstens zehn Minuten."]),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("kommentar-wanderung: ohne, mit leerer oder unbekannter Basis bricht es mit Exit 2 ab", (context) => {
  const { directory } = basisRepo(context);
  for (const args of [[], ["--basis", ""], ["--basis", "gibt-es-nicht"]]) {
    const run = runIn(directory, process.execPath, [TOOL, ...args]);
    assert.equal(run.status, EXIT_ABORT, `${args.join(" ")}: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /Abbruch: .*--basis/);
  }
});
