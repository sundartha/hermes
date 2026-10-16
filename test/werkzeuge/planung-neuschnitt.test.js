import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { ENTWURF_HINWEIS, ENTWURF_ROUTE, ENTWURF_TEXT, GRUEN_PRUEFLISTE, GRUPPEN, HINWEIS, ORDNER, ROUTE, alsJson, aufrufe, auftrag, bericht, exit, phaseFuer, plane, schnittliste } from "./planung-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const START = join(REPO_ROOT, "tools/auftrag/planung/neuschnitt-start.mjs");
const DATEI = `${ORDNER}/phase.json`;
const GESCHEITERT = "a2";
const NUMMERN = ["S2", "S3", "S6", "T1"];
const ANLASS = "Der Abnahmetest von a2 wurde nach dem Bau nicht grün.";
const VERLAUF_ZEILEN = ["test: a2 rot wie erwartet", "bau: a2 nach drei Versuchen gescheitert"];
const KOPF = ["", "## Neuschnitt", "", ANLASS, "", "## Verlauf", "", ...VERLAUF_ZEILEN].join("\n");
const PLANER_NACHRICHTEN_IM_NEUSCHNITT = 1;
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

function neuschnitt(context, { ueberschrieben = {}, eingabe = {}, eingabeText, umbau, dateien = {}, aendere = (phase) => phase } = {}) {
  const ablage = probeDirectory(context, {});
  let vorher = null;
  const argumente = (wurzel) => {
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
      writeFileSync(join(wurzel, pfad), inhalt);
    }
    vorher = aendere(phaseFuer(wurzel, umbau));
    writeFileSync(join(wurzel, DATEI), `${JSON.stringify(vorher, null, 2)}\n`);
    const daten = { root: wurzel, ordner: ORDNER, datei: DATEI, auftragId: GESCHEITERT, fertig: ["a1"], anlass: ANLASS, kopf: KOPF, verlauf: VERLAUF_ZEILEN, hinweise: [], ...eingabe };
    const text = eingabeText === undefined ? JSON.stringify(daten) : eingabeText;
    if (text !== null) writeFileSync(join(ablage, "eingabe.json"), text);
    return [ablage];
  };
  const lauf = plane(context, { werkzeug: START, grund: grundAntworten(), ueberschrieben, argumente });
  const datei = join(ablage, "ergebnis.json");
  const phase = JSON.parse(readFileSync(join(lauf.wurzel, DATEI), "utf8"));
  return { ...lauf, ablage, vorher, phase, ergebnis: existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null };
}

const [UMBAU] = schnittliste().auftraege;
const NEUER_UMBAU = { ...UMBAU, id: "a0-n1", ziel: "Zieh die Prüfung kleiner heraus" };
const ROUTEN_TEST = "test/routen.test.js";

function umbauSchnitt(umbau) {
  return alsJson({ schnitt: neuerSchnitt({ auftraege: [umbau] }), aenderung: AENDERUNG });
}

const ZURUECKGEWIESEN = `trifft nicht zu, weil a2-n1 nur die Bestätigung prüft (${ROUTE}:5)`;
const PRUEFERBEFUND = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2-n1": "a2-n1 braucht den Code aus a1" } };
const KORREKTUR = alsJson({ schnitt: neuerSchnitt(), antworten: [{ schluessel: "allein-gruen:a2-n1", antwort: ZURUECKGEWIESEN }], aenderung: "a2 wird mit Begründung neu geschnitten." });

function prueflisteDer(aufruf) {
  const [, zeilen] = aufruf.eingabe.split("### Zeilen deiner Prüfliste");
  return zeilen.split("\n").filter((zeile) => zeile.startsWith("- "));
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

test("Neuschnitt: eine fehlende oder kaputte eingabe.json endet mit Exit 2 und ergebnis.json", (context) => {
  const fehlt = neuschnitt(context, { eingabeText: null });
  exit(fehlt, 2);
  assert.deepEqual(fehlt.ergebnis, { exitCode: 2, grund: "eingabe.json fehlt in der Ablage", sitzungen: [] });
  const kaputt = neuschnitt(context, { eingabeText: "{ kein JSON" });
  exit(kaputt, 2);
  assert.match(kaputt.ergebnis.grund, /^eingabe\.json ist kein JSON: /);
});

test("Neuschnitt: eine kaputte Phasendatei endet mit Exit 2 und ergebnis.json", (context) => {
  const datei = `${ORDNER}/kaputt.json`;
  const lauf = neuschnitt(context, { dateien: { [datei]: "{ kein JSON" }, eingabe: { datei } });
  exit(lauf, 2);
  assert.match(lauf.ergebnis.grund, new RegExp(`^die Phasendatei ${datei} ist kein JSON: `));
  assert.deepEqual(aufrufe(lauf, "planer"), []);
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
  assert.equal(aufrufe(lauf, "planer").length, PLANER_NACHRICHTEN_IM_NEUSCHNITT);
});

test("Neuschnitt: Nachfragen des Planers enden mit Exit 4 und gehen an keinen Erkunder", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ nachfragen: [{ nummern: ["S2"], frage: "Wo steht der Code?" }] })) });
  exit(lauf, 4);
  assert.equal(lauf.ergebnis.grund, "Nachfragen gibt es beim Neuschnitt nicht");
  assert.equal(aufrufe(lauf, "planer").length, PLANER_NACHRICHTEN_IM_NEUSCHNITT);
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

test("Neuschnitt: ein Umbau endet ohne Erkunder grün, Planer und Prüfer sehen die Datei des alten Auftrags", (context) => {
  const lauf = neuschnitt(context, { umbau: {}, eingabe: { auftragId: UMBAU.id }, ueberschrieben: planerAntwort(umbauSchnitt(NEUER_UMBAU)) });
  exit(lauf, 0);
  assert.equal(lauf.ergebnis.antwort, AENDERUNG);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  const [, ersatzbericht] = aufrufe(lauf, "planer")[0].eingabe.split("### Erkundungsbericht");
  assert.ok(ersatzbericht.includes(`"datei": "${HINWEIS}"`), ersatzbericht);
  const [pruefer] = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  const neuschnittTeil = pruefer.eingabe.slice(pruefer.eingabe.indexOf("### Neuschnitt"), pruefer.eingabe.indexOf("### Schnittliste"));
  assert.ok(neuschnittTeil.includes("### Funktionsliste") && neuschnittTeil.includes(`"datei": "${HINWEIS}"`), neuschnittTeil);
  const { auftraege } = lauf.phase;
  assert.deepEqual(auftraege.map(({ id }) => id), ["a0-n1", "a1", "a2", "a3"]);
  assert.deepEqual(auftraege[3].abhaengigVon, ["a2", "a0-n1"]);
});

test("Neuschnitt: ein Testumbau endet ohne Erkunder grün mit einem neuen Umbau", (context) => {
  const testumbau = { art: "testumbau", bereich: "test/anrufe/", erwarteteDateien: [UMBAU.abnahme] };
  const lauf = neuschnitt(context, { umbau: testumbau, eingabe: { auftragId: UMBAU.id }, ueberschrieben: planerAntwort(umbauSchnitt(NEUER_UMBAU)) });
  exit(lauf, 0);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  const [ersatz] = lauf.phase.auftraege;
  assert.deepEqual([ersatz.id, ersatz.art], ["a0-n1", "umbau"]);
});

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
  assert.equal(aufrufe(lauf, "planer").length, PLANER_NACHRICHTEN_IM_NEUSCHNITT);
  assert.deepEqual(JSON.parse(readFileSync(join(lauf.ablage, "schnitt.json"), "utf8")), schnitt);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
});

test("Neuschnitt: der Prüfer sieht Anlass und Phasendatei und prüft die neuen Aufträge ohne durchstich:a1", (context) => {
  const lauf = neuschnitt(context);
  exit(lauf, 0);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(pruefungen.length, 1);
  assert.ok(pruefungen[0].eingabe.startsWith(`## Prüfung\n\n### Neuschnitt\n\n${ANLASS}\n\nDie Schnittliste enthält nur die neuen Aufträge, die a2 ersetzen.`), pruefungen[0].eingabe);
  assert.ok(pruefungen[0].eingabe.includes(`Phasendatei ${DATEI}:`), pruefungen[0].eingabe);
  const zeilen = prueflisteDer(pruefungen[0]);
  assert.ok(zeilen.includes("- allein-gruen:a2-n1"), zeilen.join("\n"));
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("- durchstich:")), []);
});

test("Neuschnitt: ein Prüferbefund geht genau einmal an den Planer, danach prüft ein frischer Prüfer die ganze Liste", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: { "pruefer-planung|## Prüfung": [PRUEFERBEFUND, GRUEN_PRUEFLISTE], "planer|## Befunde": [KORREKTUR] } });
  exit(lauf, 0);
  assert.equal(lauf.ergebnis.antwort, "a2 wird mit Begründung neu geschnitten.");
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(pruefungen.length, 2);
  assert.notEqual(pruefungen[0].sitzung, pruefungen[1].sitzung);
  assert.equal(pruefungen[1].resume, false);
  assert.deepEqual(prueflisteDer(pruefungen[1]), prueflisteDer(pruefungen[0]));
});

test("Neuschnitt: ein Befund des frischen Prüfers nach der Korrektur endet mit Exit 4", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: { "pruefer-planung|## Prüfung": [PRUEFERBEFUND, PRUEFERBEFUND], "planer|## Befunde": [KORREKTUR] } });
  exit(lauf, 4);
  assert.match(lauf.ergebnis.grund, /allein-gruen:a2-n1: a2-n1 braucht den Code aus a1/);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
});

test("Neuschnitt: Pitch ändern in der Korrekturrunde endet mit Exit 3 und beiden Zeilen der Antwort", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: { "pruefer-planung|## Prüfung": [PRUEFERBEFUND], "planer|## Befunde": [PITCH_AENDERN] } });
  exit(lauf, 3);
  assert.equal(lauf.ergebnis.antwort, PITCH_AENDERN);
});

function durchstichLauf(context, auftraege) {
  const nummern = ["S1", "S7", "T2"];
  const ueberschrieben = { "erkunder|## Nachfrage": [bericht(nummern)], ...planerAntwort(alsJson({ schnitt: neuerSchnitt({ auftraege }), aenderung: AENDERUNG })) };
  return neuschnitt(context, { eingabe: { auftragId: "a1", fertig: [] }, ueberschrieben });
}

test("Neuschnitt: beim Neuschnitt von a1 gilt die Regel Durchstich für den ersten neuen Auftrag der Art funktion", (context) => {
  const erster = auftrag("a1-n1", ROUTE, { prueft: ["S1", "S7", "T2"], abnahme: "test/nummern/eigene-nummer-hinterlegung.test.js", abhaengigVon: [] });
  const lauf = durchstichLauf(context, [erster]);
  exit(lauf, 0);
  const zeilen = prueflisteDer(aufrufe(lauf, "pruefer-planung", "## Prüfung")[0]);
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("- durchstich:")), ["- durchstich:a1-n1"]);
});

test("Neuschnitt: ein Umbau als Durchstich beim Neuschnitt von a1 ist ein Befund", (context) => {
  const lauf = durchstichLauf(context, [{ ...UMBAU, id: "a1-n1" }]);
  exit(lauf, 4);
  assert.match(lauf.ergebnis.grund, /a1-n1 ist umbau, der Durchstich ist eine funktion/);
});

test("Neuschnitt: der neue Auftrag ersetzt den alten an seiner Stelle und in fremden abhaengigVon, ein geteilter Bereich bleibt ohne Entwurf-Schreiber", (context) => {
  const lauf = neuschnitt(context);
  exit(lauf, 0);
  assert.equal(lauf.ergebnis.grund, undefined);
  const [, ersatz, folgender] = lauf.phase.auftraege;
  const [, alt, frueher] = lauf.vorher.auftraege;
  assert.deepEqual(lauf.phase.auftraege.map(({ id }) => id), ["a1", "a2-n1", "a3"]);
  assert.deepEqual(folgender, { ...frueher, abhaengigVon: ["a2-n1"] });
  assert.deepEqual(ersatz.szenarien, alt.szenarien);
  assert.deepEqual(lauf.phase.entwurf, lauf.vorher.entwurf);
  assert.deepEqual(aufrufe(lauf, "entwurf"), []);
  assert.equal(existsSync(join(lauf.wurzel, ".fortschritt")), false);
});

test("Neuschnitt: ein Bereich, den bisher nur der alte Auftrag nutzte, bekommt einen neuen Entwurf", (context) => {
  const ersatz = auftrag("a3-n1", HINWEIS, { prueft: GRUPPEN[2].nummern, abnahme: "test/anrufe/hinweis-neu.test.js", abhaengigVon: [{ id: "a2", grund: "liest den Status bestaetigt" }] });
  const ueberschrieben = { "erkunder|## Nachfrage": [bericht(GRUPPEN[2].nummern)], ...planerAntwort(alsJson({ schnitt: neuerSchnitt({ auftraege: [ersatz] }) })), "entwurf|## Entwurf": [ENTWURF_HINWEIS] };
  const lauf = neuschnitt(context, { eingabe: { auftragId: "a3" }, ueberschrieben });
  exit(lauf, 0);
  assert.equal(aufrufe(lauf, "entwurf").length, 1);
  assert.match(lauf.phase.entwurf[HINWEIS], /^Aufträge: a3-n1: Ziel a3-n1$/m);
  assert.equal(lauf.phase.entwurf[ROUTE], lauf.vorher.entwurf[ROUTE]);
});

test("Neuschnitt: ein neuer Bereich bekommt einen Entwurf", (context) => {
  const bereich = "src/routes/";
  const ersatz = auftrag("a2-n1", bereich, { prueft: NUMMERN, abnahme: "test/nummern/eigene-nummer-bestaetigung.test.js", abhaengigVon: [{ id: "a1", grund: "braucht den gespeicherten Code" }], erwarteteDateien: [ROUTE, "src/routes/api-confirm.js", "test/nummern/eigene-nummer-bestaetigung.test.js"] });
  const lauf = neuschnitt(context, { ueberschrieben: { ...planerAntwort(alsJson({ schnitt: neuerSchnitt({ auftraege: [ersatz] }) })), "entwurf|## Entwurf": [ENTWURF_ROUTE] } });
  exit(lauf, 0);
  const entwurf = lauf.phase.entwurf[bereich];
  const [ersteZeile] = ENTWURF_TEXT[ROUTE].split("\n");
  assert.ok(entwurf.startsWith(ersteZeile), entwurf);
  const [schreiber] = aufrufe(lauf, "entwurf");
  assert.ok(schreiber.eingabe.includes(`### Bereich\n\n${bereich}\n`), schreiber.eingabe);
});

test("Neuschnitt: Befunde der neuen Phase enden mit Exit 4, die Phasendatei bleibt unverändert", (context) => {
  const faelle = [
    [(phase) => ({ ...phase, phase: "P-002-andere" }), /phase muss P-001-eigene-nummer heißen wie der Ordner, nicht "P-002-andere"/],
    [(phase) => ({ ...phase, auftraege: phase.auftraege.map((eintrag) => (eintrag.id === "a1" ? { ...eintrag, art: "unbekannt" } : eintrag)) }), /art muss eine von /],
  ];
  for (const [aendere, befund] of faelle) {
    const lauf = neuschnitt(context, { aendere });
    exit(lauf, 4);
    assert.match(lauf.ergebnis.grund, befund);
    assert.deepEqual(lauf.phase, lauf.vorher);
  }
});

test("Neuschnitt: der Bericht liegt in der Ablage und gleicht ergebnis.json, der Planer steht in sitzungen zuletzt", (context) => {
  const lauf = neuschnitt(context);
  exit(lauf, 0);
  const bericht = JSON.parse(readFileSync(join(lauf.ablage, "planung.json"), "utf8"));
  assert.deepEqual(lauf.ergebnis.planung, bericht);
  assert.equal(bericht.exit, 0);
  assert.ok(lauf.stdout.includes(`Bericht: ${join(lauf.ablage, "planung.json")}`), lauf.stdout);
  const { sitzungen } = lauf.ergebnis;
  const rollen = sitzungen.map(({ rolle }) => rolle);
  assert.deepEqual(rollen.toSorted(), ["erkunder", "planer", "pruefer-planung", "pruefer-planung"]);
  assert.deepEqual(sitzungen.at(-1), { rolle: "planer", sitzung: aufrufe(lauf, "planer")[0].sitzung });
});

test("Neuschnitt: eine Rolle, die eine Datei ändert, bricht mit Exit 1 und dem Abbruchtext des Teams ab", (context) => {
  const schnitt = { text: alsJson({ schnitt: neuerSchnitt(), aenderung: AENDERUNG }), schreibe: "src/geaendert.txt" };
  const lauf = neuschnitt(context, { ueberschrieben: { "planer|": [schnitt] } });
  exit(lauf, 1);
  assert.equal(lauf.ergebnis.grund, "planer haben src/geaendert.txt geändert");
  assert.equal(lauf.ergebnis.planung.exit, 1);
  assert.deepEqual(lauf.phase, lauf.vorher);
});

test("Neuschnitt: eine Teilliste in der ersten Antwort endet mit Exit 4", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ teilliste: { auftraege: [] } })) });
  exit(lauf, 4);
  assert.equal(lauf.ergebnis.grund, "Regel Teilliste: teilliste gibt es erst nach einer Schnittliste");
  assert.equal(aufrufe(lauf, "planer").length, PLANER_NACHRICHTEN_IM_NEUSCHNITT);
});

test("Neuschnitt: eine Antwort ohne Schnittliste endet mit Exit 4", (context) => {
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ aenderung: AENDERUNG })) });
  exit(lauf, 4);
  assert.match(lauf.ergebnis.grund, /^schnitt fehlt: /);
  assert.equal(aufrufe(lauf, "planer").length, PLANER_NACHRICHTEN_IM_NEUSCHNITT);
});

test("Neuschnitt: die Abnahme eines vorhandenen Auftrags ist ein Befund", (context) => {
  const [ersatz] = neuerSchnitt().auftraege;
  const abnahme = "test/nummern/eigene-nummer-hinterlegen.test.js";
  const schnitt = neuerSchnitt({ auftraege: [{ ...ersatz, abnahme, erwarteteDateien: [ROUTE, abnahme] }] });
  const lauf = neuschnitt(context, { ueberschrieben: planerAntwort(alsJson({ schnitt })) });
  exit(lauf, 4);
  assert.match(lauf.ergebnis.grund, /abnahme test\/nummern\/eigene-nummer-hinterlegen\.test\.js hat schon der vorhandene Auftrag a1/);
  assert.equal(aufrufe(lauf, "planer").length, PLANER_NACHRICHTEN_IM_NEUSCHNITT);
});
