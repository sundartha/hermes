import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bauPrompt, testumbauPrompt } from "../../tools/auftrag/agenten.mjs";
import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { TESTAUSGABE_PLATZHALTER } from "../../tools/auftrag/zeige-prompt.mjs";
import { starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_GRUEN = 0;
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };
const DESIGN = "plaene/P-001-probe/design.md";
const ANNAHME = "Jede Nummer steht im Format E.164.";
const FALLE = "Der Hinweis darf nie wegfallen.";
const TESTAUSGABE = "not ok 1 - verdoppelt\n  2 !== 4\n";
const ZWEITE_RUNDE = "## Fehlerausgabe der vorigen Runde";

function funktion(felder = {}) {
  return {
    id: "A1",
    art: "funktion",
    ziel: "Schreibe groß",
    bereich: "src/text.js",
    erwarteteDateien: ["src/text.js", "test/text.test.js", "test/rechnen.test.js"],
    vorbild: "src/text.js",
    abnahme: "test/rechnen.test.js",
    erwarteterFehler: "2 !== 4",
    wasDarfNiePassieren: NIE,
    prueft: ["S1"],
    szenarien: { S1: "Gegeben ein Text\nWenn er groß geschrieben wird\nDann steht `A` da" },
    ...felder,
  };
}

function zeige(ordner, phasendatei, argumente) {
  return runIn(ordner, process.execPath, [EINSTIEG, "zeige-prompt", phasendatei, ...argumente]);
}

function pitchPhase(context, auftrag) {
  const phase = { phase: "P-001-probe", issue: 54, entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag] };
  const root = probeDirectory(context, {
    "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n",
    "test/text.test.js": 'import { test } from "node:test";\ntest("gross", () => {});\n',
    [DESIGN]: `# Design\n\n## Ausgangslage und Annahmen\n\n${ANNAHME}\n\n## Weiter\n\nx\n`,
    "plaene/P-001-probe/pitch.md": `# Pitch\n\n## Fallen\n\n${FALLE}\n\n## Nicht-Ziele\n\nKeine.\n`,
    "testausgabe.txt": TESTAUSGABE,
    "phase.json": JSON.stringify(phase),
  });
  return { phase, root };
}

function dateienIn(ordner) {
  return readdirSync(ordner, { recursive: true }).sort();
}

test("zeige-prompt: mit --rolle test steht genau der Prompt, den der Test-Agent in der ersten Runde des Laufs bekommt", (context) => {
  const { repo, werkzeug, lauf } = starte(context, { auftrag: funktion(), drehbuch: { "test-antwort": "", nach: ZWEITE_RUNDE } });
  const imLauf = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  const gezeigt = zeige(repo, join(werkzeug, "phase.json"), ["A1", "--rolle", "test"]);
  assert.equal(gezeigt.status, EXIT_GRUEN, `${gezeigt.stderr}\n${lauf.stdout}`);
  assert.equal(gezeigt.stdout, imLauf);
});

test("zeige-prompt: mit --rolle bau steht der Bau-Prompt samt Design und Pitch, mit Platzhalter oder der Datei aus --testausgabe", (context) => {
  const auftrag = funktion();
  const { phase, root } = pitchPhase(context, auftrag);
  const vorher = dateienIn(root);
  const kontext = { phase, auftrag, root, design: DESIGN };
  const ohne = zeige(root, "phase.json", ["A1", "--rolle", "bau"]);
  assert.equal(ohne.status, EXIT_GRUEN, ohne.stderr);
  assert.equal(ohne.stdout, bauPrompt(kontext, TESTAUSGABE_PLATZHALTER));
  for (const teil of [ANNAHME, FALLE, TESTAUSGABE_PLATZHALTER]) assert.ok(ohne.stdout.includes(teil), teil);
  const mit = zeige(root, "phase.json", ["A1", "--rolle", "bau", "--testausgabe", "testausgabe.txt"]);
  assert.equal(mit.status, EXIT_GRUEN, mit.stderr);
  assert.equal(mit.stdout, bauPrompt(kontext, TESTAUSGABE));
  assert.ok(!mit.stdout.includes(TESTAUSGABE_PLATZHALTER));
  assert.deepEqual(dateienIn(root), vorher);
});

test("zeige-prompt: ein Testumbau zeigt als Test den Prompt des Testumbau-Agenten", (context) => {
  const auftrag = funktion({ art: "testumbau", bereich: "test/", erwarteteDateien: ["test/text.test.js"], abnahme: "test/text.test.js", prueft: UMBAU_AUSWEG });
  for (const feld of ["erwarteterFehler", "szenarien"]) delete auftrag[feld];
  const { phase, root } = pitchPhase(context, auftrag);
  const gezeigt = zeige(root, "phase.json", ["A1", "--rolle", "test"]);
  assert.equal(gezeigt.status, EXIT_GRUEN, gezeigt.stderr);
  assert.equal(gezeigt.stdout, testumbauPrompt(phase, auftrag, root));
});

test("zeige-prompt: eine unbekannte Auftrags-ID, eine unbekannte Rolle oder eine Rolle, die der Lauf nicht startet, endet ohne Prompt mit einer Zeile, was fehlt", (context) => {
  const { root } = pitchPhase(context, funktion());
  const umbau = pitchPhase(context, funktion({ art: "umbau", erwarteteDateien: ["src/text.js"], abnahme: "test/text.test.js", prueft: UMBAU_AUSWEG, szenarien: undefined, erwarteterFehler: undefined })).root;
  const faelle = [
    { ordner: root, argumente: ["A9", "--rolle", "test"], meldung: /keinen Auftrag A9/ },
    { ordner: root, argumente: ["A1", "--rolle", "pruefer"], meldung: /zeige-prompt <phasendatei> <auftrag> --rolle <test\|bau>/ },
    { ordner: root, argumente: ["A1"], meldung: /zeige-prompt <phasendatei> <auftrag> --rolle <test\|bau>/ },
    { ordner: umbau, argumente: ["A1", "--rolle", "test"], meldung: /A1 .*keinen Test-Agenten/ },
  ];
  for (const { ordner, argumente, meldung } of faelle) {
    const gezeigt = zeige(ordner, "phase.json", argumente);
    assert.notEqual(gezeigt.status, EXIT_GRUEN, argumente.join(" "));
    assert.equal(gezeigt.stdout, "", argumente.join(" "));
    assert.match(gezeigt.stderr, meldung, argumente.join(" "));
  }
});
