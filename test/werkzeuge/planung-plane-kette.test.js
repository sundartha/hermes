import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUPPEN, LAUF_FRIST_MS, ORDNER, aufrufe, bericht, exit, planOrdner, planeIn, stelle } from "./planung-probe.js";
import { commitAll } from "./probe-repo.js";
import { AUFTRAG, EXIT_GRUEN, planeAntworten, wegpruefungen } from "./planung-plane-probe.js";

const KETTE = "src/kette-probe.js";
const KETTE_QUELLE = `export function nimmAuftrag(nummer) {
  const werkzeug = "place_call";
  return pruefeAuftrag({ werkzeug, nummer });
}

function pruefeAuftrag(auftrag) {
  return speichereAuftrag(auftrag);
}

export function speichereAuftrag(auftrag) {
  return auftrag;
}
`;
const EINGANG = stelle("eingang", KETTE, { funktion: "nimmAuftrag", von: 1, bis: 4 });
const MITTE = stelle("logik", KETTE, { funktion: "pruefeAuftrag", von: 6, bis: 8 });
const WIRKUNG = stelle("wirkung", KETTE, { funktion: "speichereAuftrag", von: 10, bis: 12 });
const ANRUF_NUMMERN = GRUPPEN[1].nummern;

function mitWeg(weg) {
  return bericht(ANRUF_NUMMERN, Object.fromEntries(ANRUF_NUMMERN.map((nummer) => [nummer, { weg }])));
}

function wurzelMitKette(context) {
  const wurzel = planOrdner(context);
  writeFileSync(join(wurzel, KETTE), KETTE_QUELLE);
  commitAll(wurzel, "Kette");
  return wurzel;
}

test("plane: ein Erkunder-Bericht mit Lücke in der Aufrufkette bekommt den Befund mit den Zwischengliedern vor der Wegprüfung", { timeout: LAUF_FRIST_MS }, (context) => {
  const ueberschrieben = { "erkunder|## Erkundung|S4": [mitWeg([EINGANG, WIRKUNG])], "erkunder|## Befunde": [mitWeg([EINGANG, MITTE, WIRKUNG])] };
  const lauf = planeIn(context, wurzelMitKette(context), { werkzeug: AUFTRAG, grund: planeAntworten(), argumente: ["plane", ORDNER], ueberschrieben });
  exit(lauf, EXIT_GRUEN);
  const [rueckgabe, ...weitere] = aufrufe(lauf, "erkunder", "## Befunde");
  assert.equal(weitere.length, 0);
  for (const nummer of ANRUF_NUMMERN) {
    assert.ok(rueckgabe.eingabe.includes(`${nummer}: zwischen nimmAuftrag (${KETTE}) und speichereAuftrag (${KETTE}) liegen ungemeldet pruefeAuftrag (${KETTE}:6-8)`), rueckgabe.eingabe);
  }
  const [erste, ...spaetere] = wegpruefungen(lauf, "S4");
  assert.equal(spaetere.length, 0);
  assert.ok(erste.start >= rueckgabe.ende, `die Wegprüfung startet vor dem Befund: ${erste.start}, ${rueckgabe.ende}`);
  assert.ok(erste.eingabe.includes('"funktion": "pruefeAuftrag"'), erste.eingabe);
});
