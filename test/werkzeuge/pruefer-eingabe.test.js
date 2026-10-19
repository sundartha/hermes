import assert from "node:assert/strict";
import { test } from "node:test";

import { auftragFuerPruefer, eingabeMangel } from "../../tools/auftrag/pruefer-lauf.mjs";

const KENNUNG = "0123456789abcdef";
const LANGE_ZEILE = `+${"x".repeat(6000)}`;
const READ_GRENZE = 2000;
const COMMIT = { sha: "a".repeat(40), letzter: true };

function patch(name, text) {
  return { name, inhalt: Buffer.from(text) };
}

function zweiPatches() {
  const gleich = `diff --git a/t.js b/t.js\n${LANGE_ZEILE}\n`;
  return [patch("diff/001.patch", gleich), patch("pr/gesamt.patch", gleich)];
}

test("eine vollständige Eingabe mit einer Zeile von 6000 Zeichen hat keinen Mangel", () => {
  const inhalte = zweiPatches();
  const eingabe = auftragFuerPruefer(COMMIT, inhalte, KENNUNG);
  assert.equal(eingabeMangel(eingabe, inhalte, KENNUNG), null);
});

test("ist die lange Zeile auf 2000 Zeichen gekürzt, nennt die Prüfung jeden betroffenen Patch", () => {
  const inhalte = zweiPatches();
  const eingabe = auftragFuerPruefer(COMMIT, inhalte, KENNUNG).replaceAll(
    LANGE_ZEILE,
    LANGE_ZEILE.slice(0, READ_GRENZE),
  );
  assert.equal(
    eingabeMangel(eingabe, inhalte, KENNUNG),
    "nicht vollständig in der Eingabe: diff/001.patch, pr/gesamt.patch",
  );
});

test("ist nur der erste Block gekürzt, zählt der gleiche Text im zweiten Block nicht für ihn", () => {
  const inhalte = zweiPatches();
  const eingabe = auftragFuerPruefer(COMMIT, inhalte, KENNUNG).replace(
    LANGE_ZEILE,
    LANGE_ZEILE.slice(0, READ_GRENZE),
  );
  assert.equal(
    eingabeMangel(eingabe, inhalte, KENNUNG),
    "nicht vollständig in der Eingabe: diff/001.patch",
  );
});

test("fehlt ein Patch in der Eingabe, ist das ein Mangel", () => {
  const inhalte = zweiPatches();
  const eingabe = auftragFuerPruefer(COMMIT, inhalte.slice(0, 1), KENNUNG);
  assert.equal(
    eingabeMangel(eingabe, inhalte, KENNUNG),
    "nicht vollständig in der Eingabe: pr/gesamt.patch",
  );
});

test("fehlt auftrag.md in der Eingabe, ist das ein Mangel wie bei einem Patch", () => {
  const auftrag = patch("auftrag.md", "# Auftragszettel\n");
  const inhalte = [auftrag, ...zweiPatches()];
  const eingabe = auftragFuerPruefer(COMMIT, inhalte.slice(1), KENNUNG);
  assert.equal(
    eingabeMangel(eingabe, inhalte, KENNUNG),
    "nicht vollständig in der Eingabe: auftrag.md",
  );
});

test("ein Patch, der kein gültiges UTF-8 ist, kommt nicht byte-genau in die Eingabe und ist ein Mangel", () => {
  const inhalte = [{ name: "diff/001.patch", inhalt: Buffer.from([0x2b, 0xe4, 0x0a]) }];
  const eingabe = auftragFuerPruefer(COMMIT, inhalte, KENNUNG);
  assert.equal(
    eingabeMangel(eingabe, inhalte, KENNUNG),
    "nicht vollständig in der Eingabe: diff/001.patch",
  );
});
