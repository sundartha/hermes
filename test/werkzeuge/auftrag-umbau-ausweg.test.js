import assert from "node:assert/strict";
import { test } from "node:test";

import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import { umbauPhase } from "../../tools/auftrag/runden.mjs";
import { passingTest, probeDirectory } from "./probe-repo.js";

const AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const AUFTRAG = {
  id: "a1",
  art: "funktion",
  ziel: "Antworte auf POST /api/x mit ok",
  bereich: "src/x.js",
  erwarteteDateien: ["src/x.js", "test/x.test.js"],
  vorbild: "src/x.js",
  abnahme: "test/x.test.js",
  erwarteterFehler: "Expected values to be strictly equal",
  wasDarfNiePassieren: [],
  prueft: ["S1"],
  szenarien: { S1: "Gegeben ein Kunde\nWenn er `POST /api/x` sendet\nDann enthält die Antwort `ok`" },
};
const VORSCHLAG = JSON.stringify({
  ziel: "Lege text an",
  bereich: "src/text.js",
  erwarteteDateien: ["src/text.js"],
  vorbild: "src/x.js",
  abnahme: "test/ok.test.js",
  entwurf: "Text anlegen.",
});
const alsBlock = (json) => ["```json", json, "```"].join("\n");

function umbauIn(context, kennung) {
  const root = probeDirectory(context, { "src/x.js": "export const X = 1;\n", "test/ok.test.js": passingTest("ok") });
  const phase = { phase: kennung, entwurf: { [AUFTRAG.bereich]: "Entwurf." }, auftraege: [AUFTRAG] };
  const neu = umbauPhase(phase, AUFTRAG, alsBlock(VORSCHLAG));
  return { umbau: neu.auftraege[0], kennung: neu.phase, befunde: phasenBefunde(neu, root) };
}

test("auftrag-umbau-ausweg: der Umbau aus „Voraussetzung fehlt“ ist in einer Phase aus einem Pitch gültig und nennt den Ausweg", (context) => {
  const { umbau, kennung, befunde } = umbauIn(context, "P-001-probe");
  assert.deepEqual(befunde, []);
  assert.equal(kennung, "P-001-probe");
  assert.deepEqual([umbau.id, umbau.art, umbau.prueft, umbau.szenarien], ["a1-umbau", "umbau", AUSWEG, undefined]);
});

test("auftrag-umbau-ausweg: in Phasen ohne Pitch bleibt der Umbau gültig", (context) => {
  assert.deepEqual(umbauIn(context, "E-001-probe").befunde, []);
});

test("auftrag-umbau-ausweg: ein Vorschlag ohne bereich legt keinen Entwurfsabschnitt „undefined“ an", () => {
  const phase = { phase: "P-001-probe", entwurf: {}, auftraege: [AUFTRAG] };
  const neu = umbauPhase(phase, AUFTRAG, alsBlock(JSON.stringify({ ziel: "Lege text an", entwurf: "Text anlegen." })));
  assert.deepEqual(Object.keys(neu.entwurf), []);
});

test("auftrag-umbau-ausweg: ein Vorschlag zählt nur als abschließender json-Block und nie neben einer Zeile „Verhalten:“", () => {
  const phase = { phase: "P-001-probe", entwurf: {}, auftraege: [AUFTRAG] };
  const block = alsBlock(VORSCHLAG);
  const faelle = [
    [block, true],
    [`Mein Vorschlag:\n${block}\n`, true],
    [VORSCHLAG, false],
    [`${block}\nNoch ein Satz danach.`, false],
    [`Verhalten: Der Test hält das alte Verhalten fest.\n${block}`, false],
    ["Verhalten: Der Vorbau mit `config: {}` stört nicht.", false],
    ["Mit `{}` als Store reicht es.", false],
  ];
  assert.deepEqual(
    faelle.map(([antwort]) => umbauPhase(phase, AUFTRAG, antwort) !== null),
    faelle.map(([, erwartet]) => erwartet),
  );
});
