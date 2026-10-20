import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, LAUF_FRIST_MS, ORDNER, WEGPRUEFUNGEN, alsJson, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, planeAntworten, planungsBericht } from "./planung-plane-probe.js";

const EXIT_DECKEL = 5;
const MIO = 1_000_000;
const PLANER = 100_000;
const ERKUNDER = MIO;
const WEGPRUEFER = 340_000;
const ERKUNDER_LAUF = ERKUNDER + WEGPRUEFER;
const TOKEN = { planer: PLANER, erkunder: ERKUNDER, "pruefer-planung": WEGPRUEFER, entwurf: PLANER };
const ERSTE_WELLE = 3;
const ZWEITE_WELLE = 12;
const NACHFRAGE_NUMMERN = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "T1", "T2", "B1", "S1", "S2"];
const FREIGABE_ZEILE = /^Planung freigegeben: .*\n/m;
const NACHFRAGEN = NACHFRAGE_NUMMERN.map((nummer) => ({ nummern: [nummer], frage: `Wo endet der Weg von ${nummer}?` }));

function zwoelfNachfragen() {
  const antworten = {};
  for (const nummer of NACHFRAGE_NUMMERN) (antworten[`erkunder|## Nachfrage|${nummer}`] ??= []).push(bericht([nummer]));
  return {
    ...antworten,
    "planer|## Zuschnitt": [alsJson({ nachfragen: NACHFRAGEN }), alsJson({ schnitt: schnittliste() })],
    "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN + ZWEITE_WELLE }, () => GRUEN_PRUEFLISTE),
  };
}

function planeMitToken(context, wurzel, { argumente = [], ueberschrieben = {} } = {}) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, ...argumente], token: TOKEN });
}

function planungsDatei({ wurzel }, name) {
  return join(wurzel, ORDNER, "planung", name);
}

function pitchFreigabe(wurzel, zeile) {
  const datei = join(wurzel, ORDNER, "pitch.md");
  writeFileSync(datei, readFileSync(datei, "utf8").replace(FREIGABE_ZEILE, zeile));
  return wurzel;
}

test("plane ohne --deckel: liegen gemessene Kosten und Vorschau der zweiten Welle über der im Pitch freigegebenen Menge, endet plane vor ihr mit Exit 5, ohne einen ihrer Erkunder zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, pitchFreigabe(planOrdner(context), `Planung freigegeben: ${15 * MIO} Token\n`), { ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, ERSTE_WELLE);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 0);
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);
  const gemessen = 2 * PLANER + ERSTE_WELLE * ERKUNDER_LAUF;
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: 15 * MIO, gemessen, vorschau: ZWEITE_WELLE * ERKUNDER_LAUF });
});

test("plane --deckel geht vor die im Pitch freigegebene Menge: derselbe Lauf startet alle 12 Erkunder der zweiten Welle und plant grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = pitchFreigabe(planOrdner(context), `Planung freigegeben: ${15 * MIO} Token\n`);
  const lauf = planeMitToken(context, wurzel, { argumente: ["--deckel", String(1000 * MIO)], ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
});

for (const [fall, zeile] of [
  ["ohne Zeile „Planung freigegeben“", ""],
  ["mit einer Menge, die keine ganze Zahl ist", "Planung freigegeben: 15 Mio. Token\n"],
]) {
  test(`plane ohne --deckel, Pitch ${fall}: plane endet mit Exit 2, nennt die Zeile und startet keinen Agenten`, { timeout: LAUF_FRIST_MS }, (context) => {
    const lauf = planeMitToken(context, pitchFreigabe(planOrdner(context), zeile));

    exit(lauf, EXIT_AUFRUF);
    assert.match(lauf.stderr, /Planung freigegeben: <Zahl> Token/);
    assert.equal(aufrufe(lauf, "planer").length, 0);
    assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
  });
}

test("plane --deckel: vor der ersten Welle gilt der Mittelwert je Erkunder-Lauf aus planung.json des vorigen Laufs", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  const erster = planeMitToken(context, wurzel, { argumente: ["--deckel", String(1000 * MIO)] });
  exit(erster, EXIT_GRUEN);
  rmSync(join(wurzel, ORDNER, "phase.json"));
  rmSync(join(wurzel, ORDNER, "planung"), { recursive: true });

  const zweiter = planeMitToken(context, wurzel, { argumente: ["--deckel", String(4 * MIO)] });

  exit(zweiter, EXIT_DECKEL);
  assert.equal(aufrufe(zweiter, "erkunder").length, 0);
  assert.deepEqual(planungsBericht(zweiter).deckel, { deckel: 4 * MIO, gemessen: PLANER, vorschau: ERSTE_WELLE * ERKUNDER_LAUF });
});
