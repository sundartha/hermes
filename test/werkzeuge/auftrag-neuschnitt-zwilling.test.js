import assert from "node:assert/strict";
import { test } from "node:test";

import { ersterVersuch, neuUmbau, phase, PHASENDATEI, RECHNEN_BESTAND, schneide, TEXT_BESTAND, umbau } from "./neuschnitt-probe.js";

const RECHNEN = "src/rechnen.js";
const RECHNEN_TS = "src/rechnen.ts";
const NEU_TS = "src/neu.ts";
const UMBAU_TEST = "Regel Umbau-Test:";
const DATEIKARTE = "### Dateikarte\n\n```json\n";

function umbauTestZeilen(context, erwarteteDateien, abnahme) {
  const dateien = { [PHASENDATEI]: phase([umbau("a1")]) };
  const planer = [schneide([neuUmbau("a1-n1", { bereich: "src/", erwarteteDateien, abnahme })])];
  const { befunde = [] } = ersterVersuch(context, { planer }, { dateien });
  return befunde.flatMap((befund) => befund.split("\n")).filter((zeile) => zeile.startsWith(UMBAU_TEST));
}

function keineDatei(datei, abnahme) {
  return `${UMBAU_TEST} a1-n1: abnahme ${abnahme} gehört laut Dateikarte zu keiner Datei des Umbaus (${datei})`;
}

test("ein Umbau-Neuschnitt, der nur die neue .ts nennt, erreicht die Tests der bestehenden .js", (context) => {
  assert.deepEqual(umbauTestZeilen(context, [RECHNEN_TS], RECHNEN_BESTAND), []);
});

test("ein Umbau-Neuschnitt, dessen Abnahme über den Zwilling keine Datei des Umbaus erreicht, bleibt ein Befund", (context) => {
  assert.deepEqual(umbauTestZeilen(context, [RECHNEN_TS], TEXT_BESTAND), [keineDatei(RECHNEN_TS, TEXT_BESTAND)]);
});

test("ein Umbau-Neuschnitt mit einer .ts ohne bestehende .js bleibt ein Befund", (context) => {
  assert.deepEqual(umbauTestZeilen(context, [NEU_TS], RECHNEN_BESTAND), [keineDatei(NEU_TS, RECHNEN_BESTAND)]);
});

test("ein Umbau-Neuschnitt, der die .js und die .ts nennt, hat keinen Befund Umbau-Test", (context) => {
  assert.deepEqual(umbauTestZeilen(context, [RECHNEN, RECHNEN_TS], RECHNEN_BESTAND), []);
});

test("der alte Umbau-Auftrag, der nur die neue .ts nennt, hat die bestehende .js in der Dateikarte des ersten Planer-Prompts", (context) => {
  const dateien = { [PHASENDATEI]: phase([umbau("a1", { bereich: RECHNEN, erwarteteDateien: [RECHNEN_TS], abnahme: RECHNEN_BESTAND })]) };
  const { datei } = ersterVersuch(context, { planer: [schneide([neuUmbau("a1-n1")])] }, { dateien });
  const [, ab] = datei("prompt-planer.txt").split(DATEIKARTE);
  assert.ok(ab, "der erste Planer-Prompt enthält keine Dateikarte");
  const karte = JSON.parse(ab.split("\n```")[0]);
  assert.deepEqual(karte.map(({ datei: pfad, tests }) => ({ datei: pfad, tests })), [{ datei: RECHNEN, tests: [RECHNEN_BESTAND] }]);
});
