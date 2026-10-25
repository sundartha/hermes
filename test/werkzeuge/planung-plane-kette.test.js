import assert from "node:assert/strict";
import { test } from "node:test";

import { LAUF_FRIST_MS, ORDNER, aufrufe, exit, planeIn } from "./planung-probe.js";
import { ANRUF_NUMMERN, EINGANG, KETTE, MITTE, WIRKUNG, mitWeg, wurzelMitKette } from "./planung-kette-probe.js";
import { AUFTRAG, EXIT_GRUEN, planeAntworten, wegpruefungen } from "./planung-plane-probe.js";

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
