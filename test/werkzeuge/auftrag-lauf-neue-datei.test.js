import assert from "node:assert/strict";
import { test } from "node:test";

import { ZEILEN_UEBER_GRENZE } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const GRENZE = ZEILEN_UEBER_GRENZE - 1;

function grenzzeile({ pruefungen }) {
  const { zeilen } = pruefungen.find(({ name }) => name === "grenzen bau");
  return zeilen.at(-1);
}

function mitNeuerDatei(context, inhalt) {
  return starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/neu.js": inhalt } } });
}

test("eine neue Datei zählt so viele Zeilen wie git numstat, mit und ohne Zeilenumbruch am Ende", (context) => {
  const faelle = [
    { inhalt: "x\n".repeat(GRENZE), zeilen: GRENZE },
    { inhalt: `${"x\n".repeat(GRENZE - 1)}x`, zeilen: GRENZE },
    { inhalt: "x\r\n".repeat(GRENZE), zeilen: GRENZE },
    { inhalt: "\n\n\n", zeilen: 3 },
    { inhalt: "x", zeilen: 1 },
  ];
  for (const { inhalt, zeilen } of faelle) {
    const { lauf, beleg } = mitNeuerDatei(context, inhalt);
    assert.equal(lauf.status, 0, `${zeilen}: ${lauf.stdout}${lauf.stderr}`);
    assert.equal(grenzzeile(beleg), `grün: 1 Dateien geändert, ${zeilen} neue Zeilen Produktcode, Rolle bau.`);
  }
});

test("eine neue Datei mit einer Zeile über der Grenze reißt sie, auch ohne Zeilenumbruch am Ende", (context) => {
  const { lauf, beleg } = mitNeuerDatei(context, `${"x\n".repeat(GRENZE)}x`);
  assert.equal(beleg.ergebnis, "rot");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(JSON.stringify(beleg).includes(`${ZEILEN_UEBER_GRENZE} neue Zeilen Produktcode, erlaubt sind ${GRENZE}.`), JSON.stringify(beleg));
});
