import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { funktion, GELOESCHTE_ZEILEN, NEUE_ZEILEN, ROTER_TEST, ZEILEN_UEBER_GRENZE } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

test("der Bau-Agent wird an Bereich, Zeilengrenze, geschützten Dateien, Tests und Belegen gestoppt", (context) => {
  const faelle = [
    { bau: { "lib/fremd.js": "x\n" }, erwartet: "außerhalb des Bereichs src/: lib/fremd.js" },
    { bau: { "src/gross.js": "x\n".repeat(ZEILEN_UEBER_GRENZE) }, erwartet: "erlaubt sind 400" },
    { bau: { "src/geschuetzt.js": "export const WERT = 2;\n" }, erwartet: "geschützte Datei geändert" },
    { bau: { "test/text.test.js": "neu\n" }, erwartet: "Bau-Agent hat einen Test geändert" },
    { bau: { ".fortschritt/probe/A1.json": "{}\n" }, erwartet: "hat .fortschritt/ verändert" },
  ];
  for (const { bau, erwartet } of faelle) {
    const { lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau } });
    assert.equal(lauf.status, EXIT_ROT, erwartet);
    assert.equal(beleg.ergebnis, "rot", erwartet);
    assert.ok(JSON.stringify(beleg).includes(erwartet), `${erwartet}: ${JSON.stringify(beleg)}`);
    assert.equal(kopf, basis, erwartet);
  }
});

test("eine gelöschte Datei außerhalb des Bereichs macht den Auftrag rot", (context) => {
  const drehbuch = { "bau-loeschen": ["lib/alt.js"] };
  const { lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch, dateien: { "lib/alt.js": "export const ALT = 1;\n" } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "rot");
  assert.ok(JSON.stringify(beleg).includes("außerhalb des Bereichs src/: lib/alt.js"), JSON.stringify(beleg));
  assert.equal(kopf, basis);
});

test("gelöschte Zeilen zählen nicht zur Grenze: 360 gelöscht und 50 neu besteht sie", (context) => {
  const dateien = { "src/lang.js": "export const ZEILE = 1;\n".repeat(GELOESCHTE_ZEILEN) };
  const drehbuch = { bau: { "src/lang.js": "export const ZEILE = 2;\n".repeat(NEUE_ZEILEN) } };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const grenze = beleg.pruefungen.find(({ name }) => name === "grenzen bau");
  assert.equal(grenze.exitCode, 0);
  assert.ok(grenze.zeilen.includes(`grün: 1 Dateien geändert, ${NEUE_ZEILEN} neue Zeilen Produktcode, Rolle bau.`), grenze.zeilen.join("\n"));
});

test("der Test-Agent darf nur den Abnahmetest und erwartete Testdateien ändern", (context) => {
  const testDateien = { "test/rechnen.test.js": ROTER_TEST, "test/text.test.js": "angehängt\n" };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { test: testDateien } });
  assert.equal(lauf.status, EXIT_ROT);
  assert.ok(JSON.stringify(beleg).includes("fremden Test geändert: test/text.test.js"));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});
