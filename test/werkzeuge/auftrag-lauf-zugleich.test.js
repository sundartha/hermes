import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { KOPIEN_LISTE, ROTER_TEST, VERDOPPELT, funktion, namen, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const JSCPD = "jscpd";
const SEMGREP = "semgrep";
const absatz = (...ids) => ids.map((id) => `Zweck ${id}: Drehbuchtext des Ersatz-Agenten.`).join("\n");
const LISTEN = { ...KOPIEN_LISTE, "tools/basis/semgrep.json": `${JSON.stringify({ version: "1.0.0", befunde: [] })}\n` };
const RECHNUNG = [
  "  const eingabe = [1, 2, 3, 4];",
  "  const doppelt = eingabe.map((zahl) => verdopple(zahl));",
  '  assert.deepEqual(doppelt, [2, 4, 6, 8], "jede Zahl soll verdoppelt werden");',
  "  const summe = doppelt.reduce((rest, zahl) => rest + zahl, 0);",
  '  assert.equal(summe, 20, "die Summe der Verdopplungen soll 20 sein");',
];
const DOPPELT = [1, 2].flatMap((nummer) => [`test("verdoppelt Liste ${nummer}", () => {`, ...RECHNUNG, "});"]);
const TEST_MIT_KOPIE = [ROTER_TEST.trimEnd(), ...DOPPELT, ""].join("\n");
const UMWANDLUNG = [
  "  const buchstaben = Array.from(String(text));",
  '  if (buchstaben.length === 0) throw new Error("leere Eingabe kann nicht umgewandelt werden");',
  "  const umgewandelt = buchstaben.map((buchstabe) => buchstabe.toUpperCase());",
  '  if (umgewandelt.length !== buchstaben.length) throw new Error("die Länge soll gleich bleiben");',
  '  return umgewandelt.join("");',
  "}",
];
const TEXT_MIT_KOPIE = ["gross", "laut"].flatMap((name) => [`export function ${name}(text) {`, ...UMWANDLUNG, ""]).join("\n");

function lauf(context, drehbuch, dateien = KOPIEN_LISTE) {
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { bau: { "src/rechnen.js": VERDOPPELT }, ...drehbuch }, dateien });
}

test("semgrep läuft in der Kette des Test-Agenten nach den schnellen Prüfungen, wenn alle grün sind", (context) => {
  const { beleg } = lauf(context, { test: { "test/rechnen.test.js": ROTER_TEST }, "test-antwort": absatz(SEMGREP) }, LISTEN);
  const liste = namen(beleg);
  assert.ok(liste.includes(SEMGREP), liste.join(", "));
  assert.ok(pruefung(beleg, JSCPD) === 0 && liste.indexOf(JSCPD) < liste.indexOf(SEMGREP), liste.join(", "));
});

test("semgrep läuft in der Kette des Test-Agenten nicht, solange eine schnelle Prüfung rot ist", (context) => {
  const { beleg, werkzeug } = lauf(context, { test: { "test/rechnen.test.js": TEST_MIT_KOPIE }, "test-antwort": absatz(JSCPD) }, LISTEN);
  assert.deepEqual([beleg.ergebnis, beleg.runde, pruefung(beleg, JSCPD)], ["rot", 2, EXIT_ROT]);
  assert.ok(!namen(beleg).includes(SEMGREP), namen(beleg).join(", "));
  assert.ok(!namen(beleg).includes("rot"), namen(beleg).join(", "));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("semgrep und die betroffenen Tests laufen in der Kette des Bau-Agenten nicht, solange eine schnelle Prüfung rot ist", (context) => {
  const drehbuch = { bau: { "src/text.js": TEXT_MIT_KOPIE }, "bau-antwort": absatz(JSCPD) };
  const { beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: LISTEN });
  assert.equal(pruefung(beleg, JSCPD), EXIT_ROT, JSON.stringify(beleg.pruefungen));
  assert.ok(namen(beleg).includes("abnahme"), namen(beleg).join(", "));
  assert.ok(!namen(beleg).includes(SEMGREP), namen(beleg).join(", "));
  assert.ok(!namen(beleg).includes("betroffene tests"), namen(beleg).join(", "));
});
