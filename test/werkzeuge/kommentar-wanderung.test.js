import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";
import { brichtOhneBasisAb, nachCommitPruefen, repoMitBasis } from "./pr-probe.js";

const TOOL = join(REPO_ROOT, "tools/kommentar-wanderung.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
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
  return repoMitBasis(context, {
    "eslint.config.mjs": "export default [];\n",
    "src/abruf.js": quelle([...KOMMENTAR, CODE]),
    ".github/workflows/probe.yml": quelle(["name: Probe", "# Der Lauf startet nur auf master und nie für Forks", "on: push"]),
    "docs/notiz.md": quelle(["# Notiz", ""]),
  });
}

function nachher(repo, dateien) {
  return nachCommitPruefen(repo, TOOL, dateien);
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

test("kommentar-wanderung: ein gelöschter Kommentar am Ende einer Zeile, deren Zeichenkette denselben Satz trägt, ist grün", (context) => {
  const hinweis = `export const HINWEIS = ${JSON.stringify(SATZ)};`;
  const repo = repoMitBasis(context, {
    "eslint.config.mjs": "export default [];\n",
    "src/hinweis.js": quelle([`${hinweis} // ${SATZ}`]),
  });
  const lauf = nachher(repo, { "src/hinweis.js": quelle([hinweis]) });
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
  brichtOhneBasisAb(basisRepo(context).directory, TOOL);
});
