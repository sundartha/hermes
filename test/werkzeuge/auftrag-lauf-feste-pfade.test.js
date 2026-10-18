import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const FESTE_PFADE = "feste-pfade";
const WOZU = "Wozu: Schutzlisten nennen Dateien über feste Pfade und Muster";
const ABSATZ = `Zweck ${FESTE_PFADE}: Drehbuchtext des Ersatz-Agenten.`;
const GATE_LISTE = {
  "tools/gate-tests.json": JSON.stringify({ Probe: { module: ["src/text.js#gross"], tests: ["test/text.test.js"] } }),
};

function mitGateListe(context, dateien) {
  return starte(context, { auftrag: UMBAU, drehbuch: { bau: dateien, "bau-antwort": ABSATZ }, dateien: GATE_LISTE });
}

test("die Prüfung fester Pfade läuft im Bau direkt nach der Migrationsprüfung und ist grün, wenn der Bau keinen Eintrag ins Leere zeigen lässt", (context) => {
  const { lauf, beleg } = mitGateListe(context, { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  assert.equal(namen[namen.indexOf("migrationen") + 1], FESTE_PFADE, namen.join(", "));
  assert.equal(pruefung(beleg, FESTE_PFADE), 0, JSON.stringify(beleg.pruefungen));
});

test("nimmt der Bau-Agent eine Funktion weg, die eine Gate-Liste nennt, wird die Runde rot, und die zweite Runde bekommt Befund und Zweck-Text", (context) => {
  const { werkzeug, lauf, beleg } = mitGateListe(context, { "src/text.js": "export function laut(wort) {\n  return wort.toUpperCase();\n}\n" });
  const ergebnis = { status: lauf.status, ergebnis: beleg.ergebnis, grund: beleg.grund, exitCode: pruefung(beleg, FESTE_PFADE) };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, ergebnis: "rot", grund: `${FESTE_PFADE} endete mit Exit ${EXIT_ROT}.`, exitCode: EXIT_ROT }, lauf.stdout + lauf.stderr);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  for (const teil of ["src/text.js#gross: gross ist dort nicht deklariert", WOZU, `dem Bau-Agenten: ${FESTE_PFADE}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
});
