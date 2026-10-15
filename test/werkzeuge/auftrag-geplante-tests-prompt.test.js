import assert from "node:assert/strict";
import { test } from "node:test";

import { testPrompt } from "../../tools/auftrag/agenten.mjs";
import { probeDirectory } from "./probe-repo.js";

const GEPLANT = "test/geplant.test.js";
const GEPLANTE_HILFE = "test/hilfe/geplant.test.js";
const GEPLANT_NEU = "test/neu.test.js";
const UNGEPLANT = "test/ungeplant.test.js";
const ABNAHME = "test/abnahme.test.js";
const PRODUKT = "src/x.js";
const ENTWURF = "Der Bereich bekommt eine neue Regel.";
const NUR_AUFTRAG_UND_ENTWURF = ["## Auftrag", `## Entwurf für ${PRODUKT}`];
const TESTPFAD = /test\/[\w/.-]+\.test\.js/g;

function repo(context) {
  return probeDirectory(context, {
    [GEPLANT]: 'test("alt", () => {});\n',
    [GEPLANTE_HILFE]: 'test("alt", () => {});\n',
    [UNGEPLANT]: 'test("alt", () => {});\n',
    [PRODUKT]: "export const x = 1;\n",
  });
}

function prompt(root, erwarteteDateien) {
  const auftrag = { id: "a1", bereich: PRODUKT, abnahme: ABNAHME, erwarteteDateien };
  const phase = { entwurf: { [PRODUKT]: ENTWURF } };
  const text = testPrompt(phase, auftrag, root);
  const ausserhalbDesAuftrags = text.replace(JSON.stringify(auftrag, null, 2), "");
  return {
    ueberschriften: text.split("\n").filter((zeile) => zeile.startsWith("## ")),
    genannteTests: new Set(ausserhalbDesAuftrags.match(TESTPFAD) ?? []),
  };
}

test("Test-Prompt: nennt die geplanten Testdateien, die es schon gibt, und keine neuen oder ungeplanten", (context) => {
  const root = repo(context);
  const { ueberschriften, genannteTests } = prompt(root, [PRODUKT, GEPLANT, GEPLANTE_HILFE, GEPLANT_NEU]);
  assert.deepEqual(genannteTests, new Set([GEPLANT, GEPLANTE_HILFE]));
  assert.deepEqual(ueberschriften.slice(0, NUR_AUFTRAG_UND_ENTWURF.length), NUR_AUFTRAG_UND_ENTWURF);
});

test("Test-Prompt: ohne geplante bestehende Testdatei bleibt er bei Auftrag und Entwurf", (context) => {
  const root = repo(context);
  for (const erwarteteDateien of [[], [PRODUKT], [PRODUKT, GEPLANT_NEU]]) {
    const { ueberschriften, genannteTests } = prompt(root, erwarteteDateien);
    assert.deepEqual(ueberschriften, NUR_AUFTRAG_UND_ENTWURF, JSON.stringify(erwarteteDateien));
    assert.deepEqual(genannteTests, new Set(), JSON.stringify(erwarteteDateien));
  }
});
