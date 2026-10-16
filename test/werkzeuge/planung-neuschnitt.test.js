import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, ORDNER, ROUTE, alsJson, aufrufe, auftrag, bericht, exit, phaseFuer, plane } from "./planung-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const START = join(REPO_ROOT, "tools/auftrag/planung/neuschnitt-start.mjs");
const DATEI = `${ORDNER}/phase.json`;
const GESCHEITERT = "a2";
const NUMMERN = ["S2", "S3", "S6", "T1"];
const ANLASS = "Der Abnahmetest von a2 wurde nach dem Bau nicht grün.";
const VERLAUF_ZEILEN = ["test: a2 rot wie erwartet", "bau: a2 nach drei Versuchen gescheitert"];
const KOPF = ["", "## Neuschnitt", "", ANLASS, "", "## Verlauf", "", ...VERLAUF_ZEILEN].join("\n");
const AENDERUNG = "a2 wird in einen Auftrag mit eigener Abnahme geschnitten.";
const PITCH_AENDERN = "Pitch ändern: S2 und S3 widersprechen sich\nEmpfehlung: S3 an S2 anpassen";
const PASST_NICHT = "Zerlegung passt nicht: a2 lässt sich nicht kleiner schneiden";

function neuerSchnitt(oben = {}) {
  return {
    annahmen: [],
    fehlendeSzenarien: [],
    ownerAufgaben: [],
    gemeinsameNamen: [],
    auftraege: [auftrag("a2-n1", ROUTE, { prueft: NUMMERN, abnahme: "test/nummern/eigene-nummer-bestaetigung.test.js", abhaengigVon: [{ id: "a1", grund: "braucht den gespeicherten Code" }] })],
    ...oben,
  };
}

function grundAntworten() {
  return {
    "erkunder|## Nachfrage": [bericht(NUMMERN)],
    "pruefer-planung|## Wegprüfung": [GRUEN_PRUEFLISTE],
    "planer|": [alsJson({ schnitt: neuerSchnitt(), aenderung: AENDERUNG })],
    "pruefer-planung|## Prüfung": [GRUEN_PRUEFLISTE],
  };
}

function neuschnitt(context, { ueberschrieben = {}, eingabe = {} } = {}) {
  const ablage = probeDirectory(context, {});
  const argumente = (wurzel) => {
    writeFileSync(join(wurzel, DATEI), `${JSON.stringify(phaseFuer(wurzel), null, 2)}\n`);
    const daten = { root: wurzel, ordner: ORDNER, datei: DATEI, auftragId: GESCHEITERT, fertig: ["a1"], anlass: ANLASS, kopf: KOPF, verlauf: VERLAUF_ZEILEN, hinweise: [], ...eingabe };
    writeFileSync(join(ablage, "eingabe.json"), JSON.stringify(daten));
    return [ablage];
  };
  const lauf = plane(context, { werkzeug: START, grund: grundAntworten(), ueberschrieben, argumente });
  const datei = join(ablage, "ergebnis.json");
  return { ...lauf, ablage, ergebnis: existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null };
}

function planerAntwort(text) {
  return { "planer|": [text] };
}

test("Neuschnitt: eine Eingabe ohne Verlauf endet mit Exit 2 und startet keinen Agenten", (context) => {
  const lauf = neuschnitt(context, { eingabe: { kopf: "\n## Neuschnitt\n\nohne Verlauf" } });
  exit(lauf, 2);
  assert.match(lauf.ergebnis.grund, /## Verlauf/);
  assert.deepEqual(lauf.ergebnis.sitzungen, []);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
});

test("Neuschnitt: eine Eingabe ohne ein Pflichtfeld endet mit Exit 2 und nennt das Feld", (context) => {
  const lauf = neuschnitt(context, { eingabe: { verlauf: "keine Liste" } });
  exit(lauf, 2);
  assert.equal(lauf.ergebnis.grund, "in der Eingabe fehlt verlauf");
});

test("Neuschnitt: ein Auftrag, der nicht in der Phasendatei steht, endet mit Exit 2", (context) => {
  const lauf = neuschnitt(context, { eingabe: { auftragId: "a7" } });
  exit(lauf, 2);
  assert.equal(lauf.ergebnis.grund, `a7 steht nicht in ${DATEI}`);
});

test("Neuschnitt: eine fehlende Phasendatei endet mit Exit 2", (context) => {
  const lauf = neuschnitt(context, { eingabe: { datei: `${ORDNER}/fehlt.json` } });
  exit(lauf, 2);
  assert.equal(lauf.ergebnis.grund, `die Phasendatei ${ORDNER}/fehlt.json gibt es nicht`);
});

test("Neuschnitt: Pitch ändern endet mit Exit 3 und beiden Zeilen der Antwort", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(PITCH_AENDERN) });
  exit(lauf, 3);
  assert.equal(lauf.ergebnis.antwort, PITCH_AENDERN);
  assert.equal(lauf.ergebnis.grund, undefined);
});

test("Neuschnitt: Zerlegung passt nicht endet ohne Prüfung der Fundstellen mit Exit 3", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(PASST_NICHT) });
  exit(lauf, 3);
  assert.equal(lauf.ergebnis.antwort, PASST_NICHT);
  assert.equal(aufrufe(lauf, "planer").length, 1);
});

test("Neuschnitt: Nachfragen des Planers enden mit Exit 4 und gehen an keinen Erkunder", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ nachfragen: [{ nummern: ["S2"], frage: "Wo steht der Code?" }] })) });
  exit(lauf, 4);
  assert.equal(lauf.ergebnis.grund, "Nachfragen gibt es beim Neuschnitt nicht");
  assert.equal(aufrufe(lauf, "planer").length, 1);
  assert.deepEqual(aufrufe(lauf, "erkunder", "## Nachfrage").filter(({ eingabe }) => eingabe.includes("Wo steht der Code?")), []);
});

test("Neuschnitt: eine Aufgabe für den Owner endet mit Exit 4 und steht im Grund", (context) => {
  const aufgabe = { aufgabe: "CODEOWNERS ergänzen", fundstelle: ".github/CODEOWNERS:1", auftrag: "a2-n1" };
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ schnitt: neuerSchnitt({ ownerAufgaben: [aufgabe] }) })) });
  exit(lauf, 4);
  assert.equal(lauf.ergebnis.grund, `ownerAufgaben: ${JSON.stringify(aufgabe)}`);
});

test("Neuschnitt: ein fehlendes Szenario endet mit Exit 4 und steht im Grund", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ schnitt: neuerSchnitt({ fehlendeSzenarien: ["Ein Kunde ohne Nummer"] }) })) });
  exit(lauf, 4);
  assert.equal(lauf.ergebnis.grund, 'fehlendeSzenarien: "Ein Kunde ohne Nummer"');
});
