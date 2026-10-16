import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, HINWEIS, ORDNER, ROUTE, alsJson, aufrufe, auftrag, bericht, exit, phaseFuer, plane, schnittliste } from "./planung-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const START = join(REPO_ROOT, "tools/auftrag/planung/neuschnitt-start.mjs");
const DATEI = `${ORDNER}/phase.json`;
const GESCHEITERT = "a2";
const NUMMERN = ["S2", "S3", "S6", "T1"];
const ANLASS = "Der Abnahmetest von a2 wurde nach dem Bau nicht grün.";
const VERLAUF_ZEILEN = ["test: a2 rot wie erwartet", "bau: a2 nach drei Versuchen gescheitert"];
const KOPF = ["", "## Neuschnitt", "", ANLASS, "", "## Verlauf", "", ...VERLAUF_ZEILEN].join("\n");
const STELLE_VERLAUF = KOPF.indexOf("\n## Verlauf\n");
const PLANER_ABSCHNITTE = ["Dokumente", "Phasendatei", "Nummern", "Erkundungsbericht", "Berichte der ersten Planung", "Annahmen der Erkunder", "Offene Punkte", "Funktionsliste", "Dateikarte", ".claude/skills/pitch/phase-vorlage.md"];
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

function neuschnitt(context, { ueberschrieben = {}, eingabe = {}, umbau, dateien = {} } = {}) {
  const ablage = probeDirectory(context, {});
  const argumente = (wurzel) => {
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
      writeFileSync(join(wurzel, pfad), inhalt);
    }
    writeFileSync(join(wurzel, DATEI), `${JSON.stringify(phaseFuer(wurzel, umbau), null, 2)}\n`);
    const daten = { root: wurzel, ordner: ORDNER, datei: DATEI, auftragId: GESCHEITERT, fertig: ["a1"], anlass: ANLASS, kopf: KOPF, verlauf: VERLAUF_ZEILEN, hinweise: [], ...eingabe };
    writeFileSync(join(ablage, "eingabe.json"), JSON.stringify(daten));
    return [ablage];
  };
  const lauf = plane(context, { werkzeug: START, grund: grundAntworten(), ueberschrieben, argumente });
  const datei = join(ablage, "ergebnis.json");
  return { ...lauf, ablage, ergebnis: existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null };
}

const [UMBAU] = schnittliste().auftraege;
const NEUER_UMBAU = { ...UMBAU, id: "a0-n1", ziel: "Zieh die Prüfung kleiner heraus" };
const ROUTEN_TEST = "test/routen.test.js";

function umbauSchnitt(umbau) {
  return alsJson({ schnitt: neuerSchnitt({ auftraege: [umbau] }), aenderung: AENDERUNG });
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

for (const art of ["umbau", "testumbau"]) {
  test(`Neuschnitt: ein ${art} endet ohne Erkunder grün, der Planer sieht den Ersatzbericht mit der Datei des alten Auftrags`, (context) => {
    const lauf = neuschnitt(context, { umbau: { art }, eingabe: { auftragId: UMBAU.id }, ueberschrieben: planerAntwort(umbauSchnitt({ ...NEUER_UMBAU, art })) });
    exit(lauf, 0);
    assert.equal(lauf.ergebnis.antwort, AENDERUNG);
    assert.deepEqual(aufrufe(lauf, "erkunder"), []);
    const [, bericht] = aufrufe(lauf, "planer")[0].eingabe.split("### Erkundungsbericht");
    assert.ok(bericht.includes(`"datei": "${HINWEIS}"`), bericht);
  });
}

test("Neuschnitt: ein neuer Umbau, der eine andere vorhandene Datei nennt, endet grün", (context) => {
  const umbau = { ...NEUER_UMBAU, bereich: ROUTE, erwarteteDateien: [ROUTE, ROUTEN_TEST], abnahme: ROUTEN_TEST };
  const dateien = { [ROUTEN_TEST]: `import { registriere } from "../${ROUTE}";\n\nregistriere(null);\n` };
  const lauf = neuschnitt(context, { umbau: {}, dateien, eingabe: { auftragId: UMBAU.id }, ueberschrieben: planerAntwort(umbauSchnitt(umbau)) });
  exit(lauf, 0);
});

test("Neuschnitt: eine Datei ohne Quelltext in erwarteteDateien des alten Umbaus stört nicht", (context) => {
  const umbau = { erwarteteDateien: [...UMBAU.erwarteteDateien, "CLAUDE.md"] };
  const lauf = neuschnitt(context, { umbau, eingabe: { auftragId: UMBAU.id }, ueberschrieben: planerAntwort(umbauSchnitt(NEUER_UMBAU)) });
  exit(lauf, 0);
  const [, bericht] = aufrufe(lauf, "planer")[0].eingabe.split("### Erkundungsbericht");
  assert.ok(bericht.includes('"datei": "CLAUDE.md"'), bericht);
});

test("Neuschnitt: der Erkunder bekommt Anlass, Verlauf und das ganze Design Doc, der Planer die Abschnitte vor dem Verlauf", (context) => {
  const lauf = neuschnitt(context);
  exit(lauf, 0);
  assert.equal(lauf.ergebnis.antwort, AENDERUNG);
  const [erkunder] = aufrufe(lauf, "erkunder", "## Nachfrage");
  assert.ok(erkunder.eingabe.includes(`### Anlass\n\n${ANLASS}\n`), erkunder.eingabe);
  assert.ok(erkunder.eingabe.includes(`### Verlauf\n\n${VERLAUF_ZEILEN.join("\n")}\n`), erkunder.eingabe);
  assert.ok(erkunder.eingabe.includes("## Lösung") && erkunder.eingabe.includes("## Fehlerfälle"), erkunder.eingabe);
  assert.ok(erkunder.eingabe.includes("#### S2 (") && !erkunder.eingabe.includes("#### S1 ("), erkunder.eingabe);
  const [{ eingabe: planer }] = aufrufe(lauf, "planer");
  assert.ok(planer.startsWith(KOPF.slice(0, STELLE_VERLAUF)), planer);
  assert.ok(planer.endsWith(KOPF.slice(STELLE_VERLAUF)), planer);
  const vorVerlauf = planer.slice(0, planer.length - KOPF.length + STELLE_VERLAUF);
  for (const titel of PLANER_ABSCHNITTE) assert.ok(vorVerlauf.includes(`\n### ${titel}\n`), titel);
  assert.ok(existsSync(join(lauf.ablage, "erkundung-g1.json")));
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
});

test("Neuschnitt: ein offener Befund der Wegprüfung endet mit Exit 4 vor dem Planer", (context) => {
  const ueberschrieben = { "pruefer-planung|## Wegprüfung": [{ ...GRUEN_PRUEFLISTE, befunde: { "weg:S2": "der Weg endet nicht im Speicher" } }], "erkunder|## Befunde": [alsJson({}), alsJson({})] };
  const lauf = neuschnitt(context, { ueberschrieben });
  exit(lauf, 4);
  assert.match(lauf.ergebnis.grund, /Weg S2: der Weg endet nicht im Speicher/);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
});

test("Neuschnitt: mit gliederung.json bekommt der Erkunder die Abschnitte seiner Gruppe, der Planer die Berichte der ersten Planung zu seinen Nummern", (context) => {
  const gliederung = { gruppen: [{ nummern: NUMMERN, eingang: "POST /api/self-service/private-number/confirm", ueberschriften: ["## Fehlerfälle"], fragen: [] }] };
  const dateien = {
    [`${ORDNER}/planung/gliederung.json`]: JSON.stringify(gliederung),
    [`${ORDNER}/planung/erkundung-g1.json`]: JSON.stringify({ gruppe: ["S1"], nummern: {}, hinweise: ["Bericht der ersten Gruppe"] }),
    [`${ORDNER}/planung/erkundung-g2.json`]: JSON.stringify({ gruppe: NUMMERN, nummern: {}, hinweise: ["Bericht der zweiten Gruppe"] }),
  };
  const lauf = neuschnitt(context, { dateien });
  exit(lauf, 0);
  const [erkunder] = aufrufe(lauf, "erkunder", "## Nachfrage");
  assert.ok(erkunder.eingabe.includes("## Fehlerfälle") && !erkunder.eingabe.includes("## Lösung"), erkunder.eingabe);
  const [{ eingabe: planer }] = aufrufe(lauf, "planer");
  assert.ok(planer.includes("Bericht der zweiten Gruppe") && !planer.includes("Bericht der ersten Gruppe"), planer);
});

test("Neuschnitt: ein Skriptbefund endet ohne zweite Planer-Nachricht mit Exit 4, die Zwischenstände liegen in der Ablage", (context) => {
  const [ersatz] = neuerSchnitt().auftraege;
  const schnitt = neuerSchnitt({ auftraege: [{ ...ersatz, abhaengigVon: [...ersatz.abhaengigVon, { id: "a9", grund: "braucht etwas, das es nicht gibt" }] }] });
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ schnitt })) });
  exit(lauf, 4);
  assert.match(lauf.ergebnis.grund, /abhaengigVon.*a9|a9.*abhaengigVon/);
  assert.equal(aufrufe(lauf, "planer").length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(lauf.ablage, "schnitt.json"), "utf8")), schnitt);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
});
