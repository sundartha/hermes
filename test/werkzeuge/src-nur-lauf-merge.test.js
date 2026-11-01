import assert from "node:assert/strict";
import { test } from "node:test";

import { ANFANGSDATEIEN, EXIT_BEFUND, EXIT_OK, PLAN, ZWEITER_AUFTRAG, gitIn, nachricht, pruefe, sha } from "./src-nur-lauf-hilfen.js";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const ZEILEN = Array.from({ length: 12 }, (_, nummer) => `export const zeile${nummer} = ${nummer};`);
const MERGE_NACHRICHT = "Führe seite zusammen\n\nWarum: Zusammenführung.\n\nPaket: PRB\n";
const MERGE_GRUND = "Merge-Commit ändert src/ selbst, nicht zulässig";

function textMit(zeilen, nummer, wert) {
  return `${zeilen.with(nummer, `export const zeile${nummer} = ${wert};`).join("\n")}\n`;
}

function repoMitZeilen(context) {
  return probeRepository(context, { ...ANFANGSDATEIEN, "src/a.js": `${ZEILEN.join("\n")}\n` });
}

function zweiSeiten(verzeichnis, seiteDatei, hauptDatei) {
  const haupt = gitIn(verzeichnis, "rev-parse", "--abbrev-ref", "HEAD");
  gitIn(verzeichnis, "checkout", "-q", "-b", "seite");
  writeFiles(verzeichnis, seiteDatei);
  commitAll(verzeichnis, seiteDatei["src/a.js"] === undefined ? "Notiere seite" : nachricht());
  gitIn(verzeichnis, "checkout", "-q", haupt);
  writeFiles(verzeichnis, hauptDatei);
  commitAll(verzeichnis, hauptDatei["src/a.js"] === undefined ? "Notiere haupt" : nachricht(PLAN, ZWEITER_AUFTRAG));
}

function zusammengefuehrt(context, { seite = { "docs/s.md": "s\n" }, haupt = { "docs/h.md": "h\n" }, handarbeit = {}, ausgangs = repoMitZeilen }) {
  const verzeichnis = ausgangs(context);
  const basis = sha(verzeichnis);
  zweiSeiten(verzeichnis, seite, haupt);
  runIn(verzeichnis, "git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "merge", "--no-ff", "--no-commit", "seite"]);
  writeFiles(verzeichnis, handarbeit);
  gitIn(verzeichnis, "add", ".");
  gitIn(verzeichnis, "commit", "-q", "-m", MERGE_NACHRICHT);
  return { lauf: pruefe(verzeichnis, basis) };
}

test("ein Merge-Commit, der beim Auflösen eine neue src-Datei anlegt, ist rot und nennt die Datei", (context) => {
  const { lauf } = zusammengefuehrt(context, { handarbeit: { "src/evil.js": "export const evil = 1;\n" } });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`${MERGE_GRUND}; geändert: src/evil\\.js`));
});

test("ein Merge-Commit, der beim Auflösen eine bestehende src-Datei von Hand ändert, ist rot", (context) => {
  const { lauf } = zusammengefuehrt(context, { handarbeit: { "src/a.js": textMit(ZEILEN, 5, 99) } });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`${MERGE_GRUND}; geändert: src/a\\.js`));
});

test("ein Merge-Commit mit von Hand aufgelöstem Konflikt in src ist rot", (context) => {
  const seite = { "src/a.js": textMit(ZEILEN, 3, 1) };
  const haupt = { "src/a.js": textMit(ZEILEN, 3, 2) };
  const { lauf } = zusammengefuehrt(context, { seite, haupt, handarbeit: { "src/a.js": textMit(ZEILEN, 3, 3) } });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`${MERGE_GRUND}; geändert: src/a\\.js`));
});

test("ein reiner Merge-Commit ohne eigene Änderung ist grün", (context) => {
  const { lauf } = zusammengefuehrt(context, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(`${lauf.stdout}${lauf.stderr}`, "");
});

test("ein Merge-Commit mit eigener Änderung nur außerhalb von src ist grün", (context) => {
  const { lauf } = zusammengefuehrt(context, { handarbeit: { "docs/zusammen.md": "zusammen\n" } });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("ein Merge-Commit, der dieselbe src-Datei auf beiden Seiten in getrennten Zeilen sauber zusammenführt, ist grün", (context) => {
  const seite = { "src/a.js": textMit(ZEILEN, 0, 1) };
  const haupt = { "src/a.js": textMit(ZEILEN, ZEILEN.length - 1, 1) };
  const { lauf } = zusammengefuehrt(context, { seite, haupt });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});
