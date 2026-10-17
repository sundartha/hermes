import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSICHT_HOECHSTENS } from "../../tools/auftrag/format.mjs";
import { Planung } from "../../tools/auftrag/planung/plane.mjs";
import { LAUF_FRIST_MS, ORDNER, aufrufe, exit, plane, planOrdner } from "./planung-probe.js";
import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, planeAntworten } from "./planung-plane-probe.js";

const ABSICHT = [
  "Anrufe sollen über die eigene Nummer laufen, damit der Angerufene weiß, wer anruft.",
  "### Nicht gewollt",
  "Eine zweite Nummernliste neben `nummern.json` – auch nicht „nur für Tests“.",
].join("\n");
const ABSICHT_ABSCHNITT = /^## Absicht\n[^#]*/m;
const ERKUNDER_GRUPPEN = 3;

function pitchMit(wurzel, absicht) {
  const datei = join(wurzel, ORDNER, "pitch.md");
  writeFileSync(datei, readFileSync(datei, "utf8").replace(ABSICHT_ABSCHNITT, absicht));
  return [ORDNER];
}

function planeMitPitch(context, absicht) {
  return plane(context, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: (wurzel) => ["plane", ...pitchMit(wurzel, absicht)] });
}

function vorkommen(text, teil) {
  return text.split(teil).length - 1;
}

test("plane: jeder Erkunder bekommt die Absicht aus pitch.md wörtlich als ersten Abschnitt seiner Nachricht", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitPitch(context, `## Absicht\n\n${ABSICHT}\n\n`);
  exit(lauf, EXIT_GRUEN);
  const nachrichten = aufrufe(lauf, "erkunder", "## Erkundung").map(({ eingabe }) => eingabe);
  assert.equal(nachrichten.length, ERKUNDER_GRUPPEN);
  for (const eingabe of nachrichten) {
    assert.equal(vorkommen(eingabe, `### Absicht\n\n${ABSICHT}\n`), 1, eingabe);
    assert.equal(eingabe.indexOf("### "), eingabe.indexOf("### Absicht\n"), eingabe);
  }
});

test("plane: ein Pitch ohne Abschnitt „Absicht“ endet mit Exit 2, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitPitch(context, "");
  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /pitch\.md hat keinen Abschnitt „## Absicht“/);
  assert.deepEqual([aufrufe(lauf, "planer").length, aufrufe(lauf, "erkunder").length], [0, 0]);
});

test("plane: eine leere Absicht endet mit Exit 2, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitPitch(context, "## Absicht\n\n");
  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /pitch\.md: Absicht ist leer/);
  assert.equal(aufrufe(lauf, "planer").length, 0);
});

test("plane: eine Absicht über 1000 Zeichen endet mit Exit 2, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitPitch(context, `## Absicht\n\n${"a".repeat(ABSICHT_HOECHSTENS + 1)}\n\n`);
  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /pitch\.md: Absicht hat 1001 Zeichen, höchstens 1000/);
  assert.equal(aufrufe(lauf, "planer").length, 0);
});

test("ohne Abschnitt „Absicht“ im Pitch (Phase von vor der Absicht) bekommt der Erkunder im Neuschnitt keinen leeren Abschnitt", (context) => {
  const wurzel = planOrdner(context);
  pitchMit(wurzel, "");
  const planung = new Planung(wurzel, join(wurzel, ORDNER));
  planung.gliederung = { gruppen: [] };
  planung.soll = new Map();
  const eingabe = planung.erkunderNachricht("Nachfrage", { nummern: [], fragen: [] });
  assert.equal(eingabe.includes("### Absicht"), false, eingabe);
  assert.ok(eingabe.startsWith("## Nachfrage\n\n### Deine Nummern"), eingabe);
});
