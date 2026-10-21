import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const TEXT_S1 = "Gegeben ein Kunde\nWenn er `POST /api/x` sendet\nDann enthält die Antwort `ok`";
const TEXT_B1 = "Gegeben ein Kunde\nWenn er `GET /api/y` sendet\nDann enthält die Antwort `wie bisher`";

function umbau(felder = {}) {
  return {
    id: "a1",
    art: "umbau",
    ziel: "Ziehe die Prüfung in eine eigene Funktion",
    bereich: "src/d.js",
    erwarteteDateien: ["src/d.js"],
    vorbild: "src/d.js",
    abnahme: "test/ok.test.js",
    prueft: AUSWEG,
    ...felder,
  };
}

function funktion(felder = {}) {
  return {
    id: "a2",
    art: "funktion",
    ziel: "Antworte auf POST /api/x mit ok",
    bereich: "src/d.js",
    erwarteteDateien: ["src/d.js", "test/x.test.js"],
    vorbild: "src/d.js",
    abnahme: "test/x.test.js",
    erwarteterFehler: "Expected values to be strictly equal",
    wasDarfNiePassieren: [],
    prueft: ["S1", "B1"],
    szenarien: { S1: TEXT_S1, B1: TEXT_B1 },
    ...felder,
  };
}

function pruefe(context, auftraege, name = "P-001-probe") {
  const phase = { phase: name, entwurf: { "src/d.js": "Entwurf" }, auftraege };
  const ordner = probeDirectory(context, {
    "src/d.js": "export const WERT = 1;\n",
    "test/ok.test.js": 'import { test } from "node:test";\ntest("ok", () => {});\n',
    "phase.json": JSON.stringify(phase),
  });
  return runIn(ordner, process.execPath, [EINSTIEG, "pruefe", "phase.json"]);
}

test("auftrag-pruefe: ein Auftrag aus einem Pitch mit Nummern und wörtlichem Text ist grün", (context) => {
  const lauf = pruefe(context, [umbau(), funktion({ abhaengigVon: ["a1"] })]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.match(lauf.stdout, /grün: 2 Aufträge/);
});

test("auftrag-pruefe: ein Funktionsauftrag aus einem Pitch ohne Nummer ist rot", (context) => {
  const lauf = pruefe(context, [funktion({ prueft: undefined, szenarien: undefined })]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^a2: prueft muss die Nummern nennen, die der Auftrag prüft/m);
  assert.match(lauf.stdout, /rot: 1 Befunde/);
  const klein = pruefe(context, [funktion({ prueft: undefined, szenarien: undefined })], "p-001-probe");
  assert.equal(klein.status, EXIT_ROT);
  assert.match(klein.stderr, /^a2: prueft muss die Nummern nennen, die der Auftrag prüft/m);
});

test("auftrag-pruefe: der Umbau-Ausweg gilt nur für einen Umbau", (context) => {
  const lauf = pruefe(context, [funktion({ prueft: AUSWEG, szenarien: undefined })]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /a2: prueft muss die Nummern nennen.*gilt nur für einen Umbau/);
});

test("auftrag-pruefe: ein Umbau nennt den Ausweg wörtlich und beansprucht keine Nummer", (context) => {
  const mitNummer = pruefe(context, [umbau({ prueft: ["S1"], szenarien: { S1: TEXT_S1 } })]);
  assert.equal(mitNummer.status, EXIT_ROT);
  assert.match(mitNummer.stderr, /a1: prueft muss bei einem Umbau genau „keiner, weil Umbau: bestehende Tests bleiben unverändert grün“ sein, ohne szenarien/);
  const ohneAusweg = pruefe(context, [umbau({ prueft: undefined })]);
  assert.equal(ohneAusweg.status, EXIT_ROT);
  const mitSzenario = pruefe(context, [umbau({ szenarien: {} })]);
  assert.equal(mitSzenario.status, EXIT_ROT);
});

test("auftrag-pruefe: jede Nummer braucht ihren Szenariotext, und szenarien nennt nur Nummern aus prueft", (context) => {
  const fehlt = pruefe(context, [funktion({ szenarien: { S1: TEXT_S1, B1: " " } })]);
  assert.equal(fehlt.status, EXIT_ROT);
  assert.match(fehlt.stderr, /a2: szenarien\["B1"\] fehlt; dort steht der Szenariotext wörtlich/);
  const fremd = pruefe(context, [funktion({ szenarien: { S1: TEXT_S1, B1: TEXT_B1, T2: TEXT_S1 } })]);
  assert.equal(fremd.status, EXIT_ROT);
  assert.match(fremd.stderr, /a2: szenarien nennt T2, das nicht in prueft steht/);
  const liste = pruefe(context, [funktion({ szenarien: [TEXT_S1, TEXT_B1] }), funktion({ id: "a3", szenarien: undefined }), funktion({ id: "a4", szenarien: null })]);
  assert.equal(liste.status, EXIT_ROT);
  assert.match(liste.stderr, /a2: szenarien muss je Nummer aus prueft den wörtlichen Szenariotext enthalten/);
  assert.match(liste.stderr, /^a3: szenarien muss je Nummer aus prueft den wörtlichen Szenariotext enthalten$/m);
  assert.match(liste.stderr, /^a4: szenarien muss je Nummer aus prueft den wörtlichen Szenariotext enthalten$/m);
});

test("auftrag-pruefe: prueft nennt nur Nummern wie S1, B1 oder T1 und jede nur einmal", (context) => {
  const falsch = pruefe(context, [funktion({ prueft: ["S-1"], szenarien: { "S-1": TEXT_S1 } })]);
  assert.equal(falsch.status, EXIT_ROT);
  assert.match(falsch.stderr, /a2: prueft nennt "S-1", das ist keine Nummer wie S1, B1 oder T1/);
  const null1 = pruefe(context, [funktion({ prueft: ["S0", "XS1", "S1x", ["S1"], "S12"], szenarien: {} })]);
  assert.match(null1.stderr, /prueft nennt "S0"/);
  assert.match(null1.stderr, /prueft nennt "XS1"/);
  assert.match(null1.stderr, /prueft nennt "S1x"/);
  assert.match(null1.stderr, /prueft nennt \["S1"\]/);
  assert.doesNotMatch(null1.stderr, /"S12"/);
  const doppelt = pruefe(context, [funktion({ prueft: ["S1", "S1"], szenarien: { S1: TEXT_S1 } })]);
  assert.equal(doppelt.status, EXIT_ROT);
  assert.match(doppelt.stderr, /a2: prueft nennt S1 doppelt/);
});

test("auftrag-pruefe: Phasen ohne Pitch wie Fehler und einfache Änderung brauchen keine Nummer", (context) => {
  const lauf = pruefe(context, [funktion({ prueft: undefined, szenarien: undefined })], "E-001-probe");
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  const mittendrin = pruefe(context, [funktion({ prueft: undefined, szenarien: undefined })], "a-P-001");
  assert.equal(mittendrin.status, EXIT_GRUEN, mittendrin.stderr);
});

test("auftrag-pruefe: ändert ein anderer Auftrag die Datei, die ein Umbau derselben Phase umbenennt, ist die Phase rot, in zwei Phasen grün", (context) => {
  const umbenennung = umbau({ erwarteteDateien: ["src/d.js", "src/d.ts"] });
  const laufzeit = umbau({ id: "a2", erwarteteDateien: ["src/d.ts"], abhaengigVon: ["a1"] });
  const lauf = pruefe(context, [umbenennung, laufzeit]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^a2: ändert src\/d\.js oder src\/d\.ts, die a1 in derselben Phase umbenennt; Umformung an der \.js in einer ersten Phase, reine Umbenennung in einer zweiten Phase$/m);
  assert.equal(pruefe(context, [umbenennung]).status, EXIT_GRUEN);
  const zweite = pruefe(context, [{ ...laufzeit, abhaengigVon: [] }]);
  assert.equal(zweite.status, EXIT_GRUEN, zweite.stderr);
});
