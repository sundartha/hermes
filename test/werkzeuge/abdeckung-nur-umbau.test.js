import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const PRUEFER = join(REPO_ROOT, "tools/abdeckung-pruefen.mjs");
const AUFTRAG_TOOL = join(REPO_ROOT, "tools/auftrag.mjs");
const ORDNER = "P-002-umbau";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_SCHNITT_BEFUNDE = 4;
const AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const KEINE_NEUEN = "keine neuen, weil sich nach außen nichts Neues zeigt; das Prüfbare steht unter „Bleibt unverändert“";
const KEINS = "keins, weil die bestehenden Tests das Verhalten unverändert prüfen";
const OHNE_SZENARIO = "Abdeckung nicht bestimmbar: pitch.md hat kein Szenario „Szenario S<n>:“";
const NUR_UMBAU = /Pitch ohne Szenarien erlaubt nur Umbauten/;

function pitch(anforderungen, bleibt) {
  return ["# P-002 Umbau", "", "## Anforderungen", "", anforderungen, "", "## Bleibt unverändert", "", bleibt, "", "## Nicht-Ziele", "", "keine", ""].join("\n");
}

const SICHERHEIT = ["# P-002 Umbau: Sicherheitsprüfung", "", "## 2. Angriffswege", "", "keine Angriffswege gefunden", "", "## 3. Lückenprüfung", ""].join("\n");

function umbau(id, art = "umbau") {
  return { id, art, ziel: "Ziehe die Prüfung heraus", prueft: AUSWEG };
}

function funktion(id) {
  return { id, art: "funktion", ziel: "Antworte auf POST /api/x", bereich: "src/x.js", prueft: [] };
}

function pruefe(context, pitchtext, auftraege) {
  const wurzel = probeDirectory(context, {
    [`${ORDNER}/pitch.md`]: pitchtext,
    [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
    [`${ORDNER}/phase.json`]: JSON.stringify({ phase: ORDNER, auftraege }),
  });
  return runIn(wurzel, process.execPath, [PRUEFER, ORDNER]);
}

function schnitt(context, pitchtext, auftraege) {
  const wurzel = probeRepository(context, {
    "tools/bereiche.json": readFileSync(join(REPO_ROOT, "tools/bereiche.json"), "utf8"),
    "src/x.js": "export const x = 1;\n",
    "test/x.test.js": "import \"../src/x.js\";\n",
    [`${ORDNER}/pitch.md`]: pitchtext,
    [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
  });
  mkdirSync(join(wurzel, ORDNER, "planung"));
  writeFileSync(join(wurzel, ORDNER, "planung/schnitt.json"), JSON.stringify({ annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege }));
  return runIn(wurzel, process.execPath, [AUFTRAG_TOOL, "schnitt", ORDNER]);
}

test("abdeckung-nur-umbau: ohne Szenario und ohne die zwei Sätze bleibt die Abdeckung unbestimmbar", (context) => {
  for (const pitchtext of [pitch("(noch offen)", KEINS), pitch(KEINE_NEUEN, "(noch offen)"), pitch(`Vorab: ${KEINE_NEUEN}`, KEINS), pitch(KEINE_NEUEN, `Erst: ${KEINS}`)]) {
    const lauf = pruefe(context, pitchtext, [umbau("a1")]);
    assert.equal(lauf.status, EXIT_ROT);
    assert.equal(lauf.stderr, `${OHNE_SZENARIO}\n`);
  }
});

test("abdeckung-nur-umbau: mit beiden Sätzen ist ein Auftrag funktion ein Befund", (context) => {
  const lauf = pruefe(context, pitch(KEINE_NEUEN, KEINS), [umbau("a1"), funktion("a2")]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "Pitch ohne Szenarien erlaubt nur Umbauten: a2\n");
});

test("abdeckung-nur-umbau: mit beiden Sätzen und nur Umbauten ist die Phase grün", (context) => {
  const lauf = pruefe(context, pitch(KEINE_NEUEN, KEINS), [umbau("a1"), umbau("a2", "testumbau")]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.equal(lauf.stderr, "");
  assert.match(lauf.stdout, /^grün: 0 Nummern in P-002-umbau gehören je genau einem Auftrag\.$/m);
});

test("abdeckung-nur-umbau: ein Pitch mit Szenario B und den zwei Sätzen bleibt beim alten Befund", (context) => {
  const lauf = pruefe(context, pitch(KEINE_NEUEN, `${KEINS}\n\n### Szenario B1: Anruf\nGegeben ein Anruf\nWenn er endet\nDann bleibt das Transkript`), [umbau("a1")]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.ok(lauf.stderr.split("\n").includes(OHNE_SZENARIO), lauf.stderr);
  assert.doesNotMatch(lauf.stderr, NUR_UMBAU);
});

test("abdeckung-nur-umbau: der Schnitt meldet eine funktion in einem Pitch ohne Szenarien schon vor dem Zusammensetzen", (context) => {
  const lauf = schnitt(context, pitch(KEINE_NEUEN, KEINS), [funktion("a1"), umbau("a2")]);
  assert.equal(lauf.status, EXIT_SCHNITT_BEFUNDE, lauf.stderr + lauf.stdout);
  assert.match(lauf.stderr, /^Regel Nummern: Pitch ohne Szenarien erlaubt nur Umbauten: a1$/m);
  assert.doesNotMatch(lauf.stderr, /erlaubt nur Umbauten: a2/);
  assert.doesNotMatch(lauf.stderr, /Abdeckung nicht bestimmbar/);
});

test("abdeckung-nur-umbau: ein Schnitt nur aus Umbauten hat keinen Befund zu Umbauten", (context) => {
  const lauf = schnitt(context, pitch(KEINE_NEUEN, KEINS), [umbau("a1"), umbau("a2", "testumbau")]);
  assert.doesNotMatch(lauf.stderr, NUR_UMBAU);
  assert.doesNotMatch(lauf.stderr, /Abdeckung nicht bestimmbar/);
});
