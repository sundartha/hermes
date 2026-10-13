import assert from "node:assert/strict";
import { test } from "node:test";

import {
  antwortenBefunde,
  entwurfBefunde,
  fundstelleBefund,
  gliederungBefunde,
  merkeStellen,
  neueStellen,
  prueflisteBefunde,
  prueflisteSoll,
} from "../../tools/auftrag/planung/antworten.mjs";
import { probeDirectory } from "./probe-repo.js";

const DESIGN = "# Design\n\n## Lösung\n\nText\n\n### Werkzeugvertrag\n\nVertrag\n\n## Fehlerfälle\n\nFälle\n";
const PITCH = "# Pitch\n\n## Problem\n\nText\n\n## Problem\n\nNoch einmal\n\n## Ergebnis\n\nErgebnis\n";
const DOKUMENTE = { "design.md": DESIGN, "pitch.md": PITCH, "sicherheit.md": "# Sicherheit\n\n## 2. Angriffswege\n" };
const SOLL = new Map([["S1", {}], ["S2", {}], ["B1", {}], ["T1", {}]]);

function gruppe(nummern, zusatz = {}) {
  return { nummern, eingang: "POST /api/x", ueberschriften: ["## Lösung"], fragen: ["Wo?"], ...zusatz };
}

const GLIEDERUNG = { gruppen: [gruppe(["S1", "T1"]), gruppe(["S2", "B1"], { ueberschriften: ["### Werkzeugvertrag", "## Fehlerfälle"], fragen: [] })] };

function kontext(context) {
  return { root: probeDirectory(context, { "src/a.js": "eins\nzwei\ndrei\n" }), dokumente: DOKUMENTE };
}

function zeile(schluessel, ergebnis = "erfüllt", zusatz = {}) {
  return { schluessel, ergebnis, fundstelle: "src/a.js:2", ...zusatz };
}

function auftrag(id, zusatz = {}) {
  return { id, art: "funktion", ziel: `Ziel ${id}`, bereich: "src/", prueft: [], ...zusatz };
}

const SCHNITT = { auftraege: [auftrag("a1", { prueft: ["S1", "T1"] }), auftrag("a2", { prueft: ["S2", "B1"] })] };
const PRUEFER = [{ schluessel: "allein-gruen:a2", ergebnis: "befund", befund: "a2 braucht a1", fundstelle: "src/a.js:1" }];

function bericht(nummern) {
  return { nummern: Object.fromEntries(Object.entries(nummern).map(([nummer, stellen]) => [nummer, { weg: stellen.map(([datei, funktion]) => ({ rolle: "logik", datei, funktion })), aenderungen: "keine Änderung, weil nichts" }])) };
}

test("gliederung: jede Nummer in genau einer Gruppe mit gefundenen Überschriften ist ohne Befund", () => {
  assert.deepEqual(gliederungBefunde(GLIEDERUNG, SOLL, DESIGN), []);
});

test("gliederung: eine Nummer in zwei Gruppen ist ein Befund", () => {
  const doppelt = { gruppen: [...GLIEDERUNG.gruppen, gruppe(["S1"])] };
  assert.deepEqual(gliederungBefunde(doppelt, SOLL, DESIGN), ["S1 steht in 2 Gruppen statt in genau einer"]);
});

test("gliederung: eine fehlende und eine fremde Nummer sind Befunde", () => {
  const ohne = { gruppen: [gruppe(["S1", "T1", "S9"]), gruppe(["S2"])] };
  assert.deepEqual(gliederungBefunde(ohne, SOLL, DESIGN), ["B1 steht in 0 Gruppen statt in genau einer", "S9 ist keine Nummer der Liste"]);
});

test("gliederung: eine Überschrift, die nicht im Design Doc steht, ist ein Befund", () => {
  const fremd = { gruppen: [gruppe(["S1", "T1"], { ueberschriften: ["## Gibt es nicht"] }), GLIEDERUNG.gruppen[1]] };
  assert.deepEqual(gliederungBefunde(fremd, SOLL, DESIGN), ["Gruppe 1: Überschrift „## Gibt es nicht“ steht nicht im Design Doc"]);
});

test("gliederung: fehlender Eingang, Fragen ohne Liste und fehlende Gruppen sind Befunde", () => {
  const kaputt = { gruppen: [gruppe(["S1", "T1"], { eingang: "", fragen: "Wo?" }), GLIEDERUNG.gruppen[1]] };
  assert.deepEqual(gliederungBefunde(kaputt, SOLL, DESIGN), ["Gruppe 1: eingang fehlt", "Gruppe 1: fragen muss eine Liste von Texten sein"]);
  assert.deepEqual(gliederungBefunde({ gruppen: [] }, SOLL, DESIGN), ["gruppen fehlt: eine Liste von Erkundungsgruppen"]);
});

test("gliederung: ohne Design Doc sind Überschriften ein Befund, eine leere Liste nicht", () => {
  const ohneDesign = { gruppen: [gruppe(["S1", "T1", "S2", "B1"], { ueberschriften: [] })] };
  assert.deepEqual(gliederungBefunde(ohneDesign, SOLL, undefined), []);
  assert.deepEqual(gliederungBefunde(GLIEDERUNG, SOLL, undefined).length, 2);
});

test("fundstelle: Datei mit Zeile im Repo und eine einmalige Überschrift eines Dokuments sind gültig", (context) => {
  const ort = kontext(context);
  assert.equal(fundstelleBefund("src/a.js:3", ort), null);
  assert.equal(fundstelleBefund("design.md, ### Werkzeugvertrag", ort), null);
  assert.equal(fundstelleBefund("pitch.md, ## Ergebnis", ort), null);
});

test("fundstelle: fehlende Datei, zu große Zeile, Pfad mit .. und falsche Form sind Befunde", (context) => {
  const ort = kontext(context);
  assert.equal(fundstelleBefund("src/b.js:1", ort), "Fundstelle „src/b.js:1“: src/b.js ist keine Datei im Repo");
  assert.equal(fundstelleBefund("src/a.js:9", ort), "Fundstelle „src/a.js:9“: src/a.js hat keine Zeile 9");
  assert.equal(fundstelleBefund("../a.js:1", ort), "Fundstelle „../a.js:1“: ../a.js ist keine Datei im Repo");
  assert.equal(fundstelleBefund("irgendwo", ort), "Fundstelle „irgendwo“ ist weder <Datei>:<Zeile> noch <pitch.md|design.md|sicherheit.md>, <Überschrift>");
  assert.equal(fundstelleBefund("", ort), "Fundstelle fehlt");
});

test("fundstelle: eine Überschrift, die fehlt oder doppelt steht, ist ein Befund", (context) => {
  const ort = kontext(context);
  assert.equal(fundstelleBefund("design.md, ## Gibt es nicht", ort), "Fundstelle „design.md, ## Gibt es nicht“: die Überschrift steht nicht genau einmal in design.md");
  assert.equal(fundstelleBefund("pitch.md, ## Problem", ort), "Fundstelle „pitch.md, ## Problem“: die Überschrift steht nicht genau einmal in pitch.md");
});

test("prüfliste: die Soll-Zeilen nennen jede Regel und jedes Ziel genau einmal", () => {
  const schnitt = { auftraege: [auftrag("a1", { prueft: ["S1"], bereichsgrund: "zwei Ordner", falscheAngaben: [{ nummer: "S1", datei: "src/x.js" }] }), auftrag("u1", { art: "umbau" })] };
  const annahmen = [{ nummer: "S2", angabe: "vorbild", text: "nicht gefunden, weil" }, { nummer: "S2", angabe: "vorbild", text: "doppelt" }, { auftrag: "a1", text: "ohne Angabe" }];
  assert.deepEqual(prueflisteSoll(schnitt, SOLL, annahmen), [
    "durchstich:a1",
    "weg:S1",
    "weg:S2",
    "weg:B1",
    "weg:T1",
    "umbau:u1",
    "b-nummer:B1",
    "nie-saetze:a1",
    "allein-gruen:a1",
    "nicht-zusammengelegt:a1",
    "nie-saetze:u1",
    "allein-gruen:u1",
    "nicht-zusammengelegt:u1",
    "bereichsgrund:a1",
    "ausweg:S2:vorbild",
    "falsche-angabe:a1:S1:src/x.js",
    "gegenfrage:alle",
  ]);
});

test("prüfliste: jede Soll-Zeile genau einmal mit gültiger Fundstelle ist ohne Befund", (context) => {
  const liste = [zeile("durchstich:a1"), zeile("gegenfrage:alle", "befund", { befund: "Nicht-Ziel fehlt", fundstelle: "design.md, ## Lösung" })];
  assert.deepEqual(prueflisteBefunde(liste, ["durchstich:a1", "gegenfrage:alle"], kontext(context)), []);
});

test("prüfliste: ein fehlender Schlüssel ist ein Befund", (context) => {
  assert.deepEqual(prueflisteBefunde([zeile("durchstich:a1")], ["durchstich:a1", "gegenfrage:alle"], kontext(context)), ["gegenfrage:alle: fehlt in der Prüfliste"]);
});

test("prüfliste: ein doppelter und ein fremder Schlüssel sind Befunde", (context) => {
  const liste = [zeile("durchstich:a1"), zeile("durchstich:a1"), zeile("weg:S9")];
  assert.deepEqual(prueflisteBefunde(liste, ["durchstich:a1"], kontext(context)), ["weg:S9: gehört nicht zur Liste der Prüfzeilen", "durchstich:a1: steht 2-mal in der Prüfliste"]);
});

test("prüfliste: falsches Ergebnis, ungültige Fundstelle und Befund ohne Text sind Befunde", (context) => {
  const liste = [zeile("durchstich:a1", "vielleicht"), zeile("weg:S1", "erfüllt", { fundstelle: "src/a.js:99" }), zeile("weg:S2", "befund")];
  assert.deepEqual(prueflisteBefunde(liste, ["durchstich:a1", "weg:S1", "weg:S2"], kontext(context)), [
    "durchstich:a1: ergebnis muss „erfüllt“ oder „befund“ sein",
    "weg:S1: Fundstelle „src/a.js:99“: src/a.js hat keine Zeile 99",
    "weg:S2: „befund“ ohne Text unter befund",
  ]);
  assert.deepEqual(prueflisteBefunde(undefined, ["durchstich:a1"], kontext(context)), ["pruefliste fehlt: je Prüfzeile ein Objekt"]);
});

test("antworten: eine Zurückweisung mit Grund und eine Korrektur, die den Auftrag ändert, sind ohne Befund", () => {
  const neu = { auftraege: [SCHNITT.auftraege[0], { ...SCHNITT.auftraege[1], abhaengigVon: [{ id: "a1", grund: "braucht a1" }] }] };
  assert.deepEqual(antwortenBefunde(PRUEFER, [{ schluessel: "allein-gruen:a2", antwort: "korrigiert: a2 hängt von a1 ab" }], { alt: SCHNITT, neu }), []);
  assert.deepEqual(antwortenBefunde(PRUEFER, [{ schluessel: "allein-gruen:a2", antwort: "trifft nicht zu, weil a2 nichts aus a1 liest" }], { alt: SCHNITT, neu: SCHNITT }), []);
});

test("antworten: ein Prüferbefund ohne Antwort des Planers ist ein Befund", () => {
  assert.deepEqual(antwortenBefunde(PRUEFER, [], { alt: SCHNITT, neu: SCHNITT }), ["allein-gruen:a2: Befund des Prüfers ohne Antwort des Planers"]);
});

test("antworten: „korrigiert“ ohne Änderung des Auftrags ist ein Befund", () => {
  const anderer = { auftraege: [{ ...SCHNITT.auftraege[0], ziel: "anders" }, SCHNITT.auftraege[1]] };
  assert.deepEqual(antwortenBefunde(PRUEFER, [{ schluessel: "allein-gruen:a2", antwort: "korrigiert: erledigt" }], { alt: SCHNITT, neu: anderer }), ["allein-gruen:a2: „korrigiert“, aber der Auftrag a2 ist unverändert"]);
});

test("antworten: bei einem Schlüssel ohne Auftrag zählt jede Änderung der Schnittliste", () => {
  const befunde = [{ schluessel: "weg:S1", ergebnis: "befund", befund: "Weg falsch", fundstelle: "src/a.js:1" }];
  const antworten = [{ schluessel: "weg:S1", antwort: "korrigiert: Annahme ergänzt" }];
  assert.deepEqual(antwortenBefunde(befunde, antworten, { alt: SCHNITT, neu: SCHNITT }), ["weg:S1: „korrigiert“, aber die Schnittliste ist unverändert"]);
  assert.deepEqual(antwortenBefunde(befunde, antworten, { alt: SCHNITT, neu: { ...SCHNITT, annahmen: [{ text: "neu" }] } }), []);
});

test("antworten: Zurückweisung ohne Grund, fremde und doppelte Antworten und ein anderer Text sind Befunde", () => {
  assert.deepEqual(antwortenBefunde(PRUEFER, [{ schluessel: "allein-gruen:a2", antwort: "trifft nicht zu, weil" }], { alt: SCHNITT, neu: SCHNITT }), ["allein-gruen:a2: „trifft nicht zu, weil …“ ohne Grund"]);
  assert.deepEqual(antwortenBefunde(PRUEFER, [{ schluessel: "allein-gruen:a2", antwort: "passt schon" }, { schluessel: "weg:S1", antwort: "korrigiert: x" }], { alt: SCHNITT, neu: SCHNITT }), [
    "allein-gruen:a2: Antwort ist weder „korrigiert: …“ noch „trifft nicht zu, weil …“",
    "weg:S1: Antwort ohne Befund des Prüfers",
  ]);
  const zweimal = [{ schluessel: "allein-gruen:a2", antwort: "trifft nicht zu, weil eins" }, { schluessel: "allein-gruen:a2", antwort: "trifft nicht zu, weil zwei" }];
  assert.deepEqual(antwortenBefunde(PRUEFER, zweimal, { alt: SCHNITT, neu: SCHNITT }), ["allein-gruen:a2: mehr als eine Antwort"]);
});

test("neue Stellen: Paare, die für diese Nummern noch in keinem Bericht vorkamen, sind neu", () => {
  const gesehen = new Set();
  merkeStellen(gesehen, bericht({ S1: [["src/a.js", "eins"]] }));
  assert.deepEqual(neueStellen(gesehen, bericht({ S1: [["src/a.js", "eins"], ["src/b.js", "zwei"]] }), ["S1"]), ["S1\0src/b.js\0zwei"]);
  assert.deepEqual(neueStellen(gesehen, bericht({ S2: [["src/a.js", "eins"]] }), ["S2"]), ["S2\0src/a.js\0eins"]);
});

test("neue Stellen: ein Paar aus einem früheren als dem letzten Bericht ist nicht neu", () => {
  const gesehen = new Set();
  merkeStellen(gesehen, bericht({ S1: [["src/a.js", "eins"]] }));
  merkeStellen(gesehen, bericht({ S1: [["src/b.js", "zwei"]] }));
  assert.deepEqual(neueStellen(gesehen, bericht({ S1: [["src/a.js", "eins"]] }), ["S1"]), []);
});

test("neue Stellen: nur die gefragten Nummern zählen, und Auswege ohne Datei sind keine Stelle", () => {
  const ohneDatei = { nummern: { S1: { weg: [{ rolle: "eingang", ausweg: "nicht gefunden, weil" }], aenderungen: "keine Änderung, weil nichts" } } };
  assert.deepEqual(neueStellen(new Set(), ohneDatei, ["S1"]), []);
  assert.deepEqual(neueStellen(new Set(), bericht({ S2: [["src/a.js", "eins"]] }), ["S1"]), []);
});

test("entwurf: Grundlage vorn, Fehlerfälle hinten und jeder gemeinsame Name sind ohne Befund", () => {
  assert.deepEqual(entwurfBefunde("Grundlage: design.md\nnutzt bestaetigt\nFehlerfälle: keine", ["bestaetigt"]), []);
});

test("entwurf: fehlender Name, falsche Ränder und berechnete Zeilen sind Befunde", () => {
  assert.deepEqual(entwurfBefunde("Text\nAufträge: a1\nEnde", ["bestaetigt"]), [
    "die erste Zeile beginnt nicht mit „Grundlage:“",
    "die letzte Zeile beginnt nicht mit „Fehlerfälle:“",
    "die Zeilen „Aufträge:“ und „Reihenfolge:“ setzt das Skript",
    "gemeinsamer Name bestaetigt fehlt wörtlich",
  ]);
  assert.deepEqual(entwurfBefunde(undefined, []), ["entwurf fehlt: der Abschnitt als Text"]);
});
