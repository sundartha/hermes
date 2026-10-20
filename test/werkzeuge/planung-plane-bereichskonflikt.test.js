import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUPPEN, LAUF_FRIST_MS, ORDNER, alsJson, angaben, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { commitAll } from "./probe-repo.js";
import { AUFTRAG, EXIT_GRUEN, planeAntworten } from "./planung-plane-probe.js";

const PRODUKT = "src/a.js";
const SKRIPT = "scripts/b.sh";
const QUELLEN = { [PRODUKT]: "export function richteEin(wert) {\n  return wert;\n}\n", [SKRIPT]: "#!/bin/sh\necho start\n" };

function wurzelMitKonflikt(context) {
  const wurzel = planOrdner(context);
  for (const [pfad, inhalt] of Object.entries(QUELLEN)) {
    mkdirSync(join(wurzel, pfad, ".."), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  commitAll(wurzel, "Konfliktdateien");
  return wurzel;
}

const KONFLIKT_AENDERUNGEN = [
  { datei: PRODUKT, funktion: "richteEin", von: 1, bis: 3, neueZeilen: 2 },
  { datei: SKRIPT, art: "zeilen", von: 2, bis: 2, neueZeilen: 1 },
];
const KONFLIKT_ABSCHNITT = /### Bereichskonflikte\n([\s\S]*?)(?:\n### |$)/u;

function konfliktAbschnitt({ eingabe }) {
  return KONFLIKT_ABSCHNITT.exec(eingabe)?.[1] ?? "";
}

test("plane: ein Bereichskonflikt steht in der ersten Zuschnittnachricht, und solange er offen ist, startet nur eine Nachfrage zu seiner Nummer einen Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = wurzelMitKonflikt(context);
  const lauf = planeIn(context, wurzel, {
    werkzeug: AUFTRAG,
    grund: planeAntworten(),
    argumente: ["plane", ORDNER],
    ueberschrieben: {
      "erkunder|## Erkundung|S1": [bericht(GRUPPEN[0].nummern, { S1: { aenderungen: KONFLIKT_AENDERUNGEN } })],
      "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo setzt nimmAnruf den Hinweis?" }] }), alsJson({ schnitt: schnittliste() })],
      "planer|## Befunde": [alsJson({ nachfragen: [{ nummern: ["S1"], frage: "Geht S1 ohne scripts/b.sh?" }] })],
      "erkunder|## Nachfrage|S1": [alsJson({ nummern: { S1: angaben("S1") }, hinweise: [] })],
    },
  });

  const [erster, zweiter] = aufrufe(lauf, "planer", "## Zuschnitt");
  const konflikt = konfliktAbschnitt(erster);
  assert.ok(konflikt.includes("S1") && konflikt.includes(PRODUKT) && konflikt.includes(SKRIPT), `(a) erste Zuschnittnachricht ohne Bereichskonflikte zu S1:\n${erster.eingabe}`);

  const nachfragen = aufrufe(lauf, "erkunder", "## Nachfrage");
  const [befunde] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(!nachfragen.some(({ eingabe }) => eingabe.includes("#### S4 (")), "(b) die Nachfrage zu S4 hat einen Erkunder gestartet");
  assert.ok(befunde?.eingabe.includes("Nachfrage 1") && befunde.eingabe.includes("Bereichskonflikt"), `(b) die Nachfrage zu S4 kam nicht als Befund zurück:\n${befunde?.eingabe}`);

  assert.equal(nachfragen.length, 1, "(c) die Nachfrage zu S1 hat nicht genau einen Erkunder gestartet");
  assert.ok(nachfragen[0].eingabe.includes("#### S1 ("));
  assert.equal(konfliktAbschnitt(zweiter), "", "nach der Nachfrage zu S1 ist der Konflikt aufgelöst");
  exit(lauf, EXIT_GRUEN);
});
