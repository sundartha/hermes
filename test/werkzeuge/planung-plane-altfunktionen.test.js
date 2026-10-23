import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { genannteStellen } from "../../tools/auftrag/planung/altfunktionen-vorab.mjs";
import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, phaseDatei, planeAntworten } from "./planung-plane-probe.js";
import { HINWEIS, LAUF_FRIST_MS, ORDNER, alsJson, aufrufe, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";

const EXIT_ALTFUNKTIONEN = 6;
const ALT_QUELLE = `export function nimmAnruf(nummer) {
  const werkzeug = "place_call";
  return { werkzeug, nummer };
}

export function setzeHinweis(nummer) {
  var text = nummer;
  return text;
}
`;
const OHNE_BEFUNDE = ALT_QUELLE.replace("var text", "const text");
const ALTFUNKTION = `${HINWEIS}:setzeHinweis`;
const ABSCHNITT = /^## Altfunktionen\n[\s\S]*?\n(?=## )/m;
const KEINE = "keine, weil die Änderung in src/callee-is-owner.js keine Funktion mit Lint-Befunden trifft";
const UMBAU = `- Umbau: \`${ALTFUNKTION}\``;
const NICHT_BERUEHRT = `- nicht berührt: \`${ALTFUNKTION}\`, weil die Änderung nur den Rückgabewert liest`;
const AUFGERAEUMT = schnittliste({ umbau: { altfunktionen: [{ datei: HINWEIS, funktion: "setzeHinweis", von: 6, bis: 9 }] } });

function planeMit(context, { altfunktionen, beleg = `${HINWEIS}:7`, quelle = ALT_QUELLE, antworten = {} }) {
  const wurzel = planOrdner(context);
  writeFileSync(join(wurzel, HINWEIS), quelle);
  appendFileSync(join(wurzel, ORDNER, "design.md"), `\nBeleg für den Hinweis: \`${beleg}\`\n`);
  const pitch = join(wurzel, ORDNER, "pitch.md");
  const abschnitt = altfunktionen === undefined ? "" : `## Altfunktionen\n${altfunktionen}\n\n`;
  writeFileSync(pitch, readFileSync(pitch, "utf8").replace(ABSCHNITT, abschnitt));
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: antworten, argumente: ["plane", ORDNER] });
}

function ohneAgent(lauf, erwartet) {
  exit(lauf, erwartet);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
}

test("plane hält mit Exit 6 vor dem ersten Agenten, wenn design.md eine Zeile einer Funktion mit Lint-Befunden nennt und der Pitch sie nicht unter „## Altfunktionen“ entscheidet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, { altfunktionen: KEINE });

  ohneAgent(lauf, EXIT_ALTFUNKTIONEN);
  assert.ok(lauf.stderr.includes(`Altfunktion ${ALTFUNKTION} (6-9, no-var 1), genannt in design.md:7, steht nicht unter „## Altfunktionen“ im Pitch`), lauf.stderr);
  assert.match(lauf.stderr, /^Wozu: /m);
  assert.match(lauf.stderr, /^Ausweg: /m);
});

test("plane startet die Agenten, wenn der Pitch die genannte Altfunktion als Umbau nennt, und plant den Umbau davor", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, { altfunktionen: UMBAU, antworten: { "planer|## Zuschnitt": [alsJson({ schnitt: AUFGERAEUMT })] } });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1);
  assert.ok(existsSync(phaseDatei(lauf)));
  const schnitt = JSON.parse(readFileSync(join(lauf.wurzel, ORDNER, "planung", "schnitt.json"), "utf8"));
  assert.deepEqual(schnitt.auftraege.find(({ id }) => id === "a0").altfunktionen, [{ datei: HINWEIS, funktion: "setzeHinweis", von: 6, bis: 9 }]);
});

test("plane startet die Agenten ohne Halt, wenn die genannte Zeile in einer Funktion ohne Lint-Befunde liegt", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, { altfunktionen: KEINE, beleg: `${HINWEIS}:2`, quelle: OHNE_BEFUNDE });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1);
});

test("„nicht berührt“ erlaubt nichts: meldet der Erkunder eine Änderung in der Altfunktion, verlangt der Schnitt trotzdem den Umbau davor", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, { altfunktionen: NICHT_BERUEHRT, antworten: { "planer|## Befunde": [alsJson({ schnitt: AUFGERAEUMT })] } });

  exit(lauf, EXIT_GRUEN);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung?.eingabe.includes(`a3: Altfunktion ${ALTFUNKTION} (6-9, no-var) steht bei keinem Umbau in seiner abhaengigVon-Kette unter altfunktionen`), ruecksendung?.eingabe);
});

test("plane endet mit Exit 2 ohne Agenten, wenn der Pitch keinen Abschnitt „## Altfunktionen“ hat, und nennt die verlangte Form", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, {});

  ohneAgent(lauf, EXIT_AUFRUF);
  assert.ok(lauf.stderr.includes("pitch.md hat keinen Abschnitt „## Altfunktionen“"), lauf.stderr);
  assert.ok(lauf.stderr.includes("„- Umbau: `<Datei>:<Funktion>`“"), lauf.stderr);
});

test("plane endet mit Exit 2 ohne Agenten, wenn „nicht berührt“ keinen Grund nennt", { timeout: LAUF_FRIST_MS }, (context) => {
  ohneAgent(planeMit(context, { altfunktionen: `- nicht berührt: \`${ALTFUNKTION}\`` }), EXIT_AUFRUF);
});

function formfehler(context, altfunktionen, meldung) {
  const lauf = planeMit(context, { altfunktionen });

  ohneAgent(lauf, EXIT_AUFRUF);
  assert.ok(lauf.stderr.includes(meldung), lauf.stderr);
  assert.ok(lauf.stderr.includes("„- Umbau: `<Datei>:<Funktion>`“"), lauf.stderr);
}

test("plane endet mit Exit 2 ohne Agenten, wenn der Abschnitt „## Altfunktionen“ leer ist, und nennt die verlangte Form", { timeout: LAUF_FRIST_MS }, (context) => {
  formfehler(context, "", "pitch.md, ## Altfunktionen: der Abschnitt ist leer");
});

test("plane endet mit Exit 2 ohne Agenten, wenn der Abschnitt „## Altfunktionen“ doppelt vorkommt, und nennt die verlangte Form", { timeout: LAUF_FRIST_MS }, (context) => {
  formfehler(context, `${UMBAU}\n\n## Altfunktionen\n${UMBAU}`, "pitch.md hat keinen Abschnitt „## Altfunktionen“ oder hat ihn mehrfach");
});

test("plane endet mit Exit 2 ohne Agenten, wenn eine Zeile unter „## Altfunktionen“ keine Backticks hat, und nennt die verlangte Form", { timeout: LAUF_FRIST_MS }, (context) => {
  formfehler(context, `- Umbau: ${ALTFUNKTION}`, `pitch.md, ## Altfunktionen: die Zeile „- Umbau: ${ALTFUNKTION}“ hat nicht die Form`);
});

test("plane endet mit Exit 2 ohne Agenten, wenn eine Zeile unter „## Altfunktionen“ eine unbekannte Art hat, und nennt die verlangte Form", { timeout: LAUF_FRIST_MS }, (context) => {
  formfehler(context, `- Vielleicht: \`${ALTFUNKTION}\``, `pitch.md, ## Altfunktionen: die Zeile „- Vielleicht: \`${ALTFUNKTION}\`“ hat nicht die Form`);
});

test("plane hält mit Exit 6 ohne Agenten, wenn ein Umbau-Eintrag eine Funktion ohne Lint-Befunde nennt", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, { altfunktionen: `- Umbau: \`${HINWEIS}:nimmAnruf\``, beleg: `${HINWEIS}:2` });

  ohneAgent(lauf, EXIT_ALTFUNKTIONEN);
  assert.ok(lauf.stderr.includes(`„Umbau: ${HINWEIS}:nimmAnruf“ unter „## Altfunktionen“ ist laut karte keine Funktion mit Lint-Befunden in ${HINWEIS}`), lauf.stderr);
});

const STELLEN = [
  ["`src/a.js:114`", [{ datei: "src/a.js", von: 114, bis: 114 }]],
  ["`src/i18n/mcp-texts.js:114`, `:221`, `:329-330`", [114, 221, 329].map((von) => ({ datei: "src/i18n/mcp-texts.js", von, bis: von === 329 ? 330 : von }))],
  ["src/routes/_tenant.js:36-33 und `./tools/x.mjs:5`", [{ datei: "src/routes/_tenant.js", von: 33, bis: 36 }, { datei: "tools/x.mjs", von: 5, bis: 5 }]],
  ["`src/a.js` ohne Zeile, Version 1.2:3", []],
];

test("genannteStellen liest Datei:Zeile, Bereiche und die Folgeform „, `:221`“ aus einem Dokument", () => {
  for (const [text, erwartet] of STELLEN) {
    assert.deepEqual(genannteStellen({ "design.md": text }), erwartet.map((stelle) => ({ ...stelle, quelle: "design.md" })), text);
  }
});
