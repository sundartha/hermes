import assert from "node:assert/strict";
import { test } from "node:test";

import {
  antwortenBefunde,
  entwurfBefunde,
  fundstelleBefund,
  gliederungBefunde,
  merkeStellen,
  nachpruefSchluessel,
  neueStellen,
  planweiteSchluessel,
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

test("fundstelle: hinter dem letzten Zeilenumbruch beginnt keine Zeile, eine leere Datei hat keine", (context) => {
  const files = { "src/a.js": "eins\nzwei\ndrei\n", "src/b.js": "eins\nzwei", "src/leer.js": "" };
  const ort = { root: probeDirectory(context, files), dokumente: DOKUMENTE };
  const keineZeile = (datei, zeile) => `Fundstelle „${datei}:${zeile}“: ${datei} hat keine Zeile ${zeile}`;
  assert.equal(fundstelleBefund("src/a.js:3", ort), null);
  assert.equal(fundstelleBefund("src/a.js:4", ort), keineZeile("src/a.js", 4));
  assert.equal(fundstelleBefund("src/b.js:2", ort), null);
  assert.equal(fundstelleBefund("src/b.js:3", ort), keineZeile("src/b.js", 3));
  assert.equal(fundstelleBefund("src/leer.js:1", ort), keineZeile("src/leer.js", 1));
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

const KORRIGIERT_A2 = [{ schluessel: "allein-gruen:a2", antwort: "korrigiert: Annahme berichtigt" }];
const A2_UNVERAENDERT = ["allein-gruen:a2: „korrigiert“, aber der Auftrag a2 ist unverändert"];

function mitAnnahmen(...annahmen) {
  return { ...SCHNITT, annahmen };
}

test("antworten: eine geänderte Annahme mit der Kennung des Auftrags zählt bei einer Regel mit Auftrag als Korrektur", () => {
  const alt = mitAnnahmen({ auftrag: "a1", text: "bleibt" }, { auftrag: "a2", text: "Seed flach" });
  const neu = mitAnnahmen({ auftrag: "a1", text: "bleibt" }, { auftrag: "a2", text: "Seed verschachtelt" });
  assert.deepEqual(antwortenBefunde(PRUEFER, KORRIGIERT_A2, { alt, neu }), []);
});

test("antworten: eine geänderte Annahme eines anderen Auftrags zählt nicht als Korrektur", () => {
  const alt = mitAnnahmen({ auftrag: "a1", text: "Seed flach" }, { auftrag: "a2", text: "bleibt" });
  const neu = mitAnnahmen({ auftrag: "a1", text: "Seed verschachtelt" }, { auftrag: "a2", text: "bleibt" });
  assert.deepEqual(antwortenBefunde(PRUEFER, KORRIGIERT_A2, { alt, neu }), A2_UNVERAENDERT);
});

test("antworten: eine geänderte Annahme ohne Kennung zählt bei einer Regel mit Auftrag nicht als Korrektur", () => {
  const alt = mitAnnahmen({ text: "Seed flach" }, { auftrag: "a2", text: "bleibt" });
  const neu = mitAnnahmen({ text: "Seed verschachtelt" }, { auftrag: "a2", text: "bleibt" });
  assert.deepEqual(antwortenBefunde(PRUEFER, KORRIGIERT_A2, { alt, neu }), A2_UNVERAENDERT);
});

test("antworten: ohne Änderung an Auftrag und Annahme bleibt die Meldung wörtlich wie bisher", () => {
  const alt = mitAnnahmen({ auftrag: "a2", text: "bleibt" });
  const neu = { ...mitAnnahmen({ auftrag: "a2", text: "bleibt" }), ownerAufgaben: [{ aufgabe: "neu", fundstelle: "pitch.md, ## Ergebnis", auftrag: "a2" }] };
  assert.deepEqual(antwortenBefunde(PRUEFER, KORRIGIERT_A2, { alt, neu }), A2_UNVERAENDERT);
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

const NACHPRUEF_SOLL = new Map([["S1", {}], ["S2", {}], ["B1", {}]]);

function zeilenDes(...kennungen) {
  return kennungen.flatMap((id) => [`nie-saetze:${id}`, `allein-gruen:${id}`, `nicht-zusammengelegt:${id}`]);
}

function befundZu(schluessel) {
  return { schluessel, ergebnis: "befund", befund: "trifft nicht", fundstelle: "src/a.js:1" };
}

const VOR_DER_KORREKTUR = {
  annahmen: [],
  auftraege: [
    auftrag("a1", { prueft: ["S1"], erwarteteDateien: ["src/a.js"] }),
    auftrag("a2", { prueft: ["S2"], erwarteteDateien: ["src/b.js"], abhaengigVon: [{ id: "a1", grund: "liest a1" }] }),
    auftrag("a3", { prueft: ["B1"], erwarteteDateien: ["src/c.js"], abhaengigVon: [{ id: "a2", grund: "liest a2" }] }),
    auftrag("a4", { prueft: [], erwarteteDateien: ["src/d.js"] }),
  ],
};

test("nachprüfung: die Nachprüfung prüft genau die geänderten, neuen und berührten Aufträge und die Befundschlüssel", () => {
  const [a1, a2, a3, a4] = VOR_DER_KORREKTUR.auftraege;
  const nachher = { ...VOR_DER_KORREKTUR, auftraege: [{ ...a1, ziel: "anders" }, a2, a3, a4, auftrag("a5", { prueft: [], erwarteteDateien: ["src/e.js"] })] };
  const ergebnis = nachpruefSchluessel({ vorher: VOR_DER_KORREKTUR, nachher, befunde: [befundZu("weg:S2")], soll: NACHPRUEF_SOLL, annahmen: [] });
  assert.deepEqual(ergebnis.schluessel, ["durchstich:a1", "weg:S1", "weg:S2", "b-nummer:B1", ...zeilenDes("a1", "a2", "a5"), "gegenfrage:alle"]);
  assert.deepEqual([ergebnis.geaendert, ergebnis.neu, ergebnis.entfernt, ergebnis.entfallen], [["a1"], ["a5"], [], []]);
});

test("nachprüfung: ohne Änderung prüft die Nachprüfung nur die zurückgewiesenen Befunde", () => {
  const gleich = structuredClone(VOR_DER_KORREKTUR);
  const ergebnis = nachpruefSchluessel({ vorher: VOR_DER_KORREKTUR, nachher: gleich, befunde: [befundZu("allein-gruen:a2"), befundZu("weg:S1")], soll: NACHPRUEF_SOLL, annahmen: [] });
  assert.deepEqual(ergebnis.schluessel, ["weg:S1", "allein-gruen:a2"]);
});

test("nachprüfung: eine geänderte Reihenfolge oder Annahme prüft die Zeilen nach jeder Änderung", () => {
  const umgestellt = { ...VOR_DER_KORREKTUR, auftraege: VOR_DER_KORREKTUR.auftraege.toReversed() };
  const mitAnnahme = { ...VOR_DER_KORREKTUR, annahmen: [{ text: "neu" }] };
  for (const nachher of [umgestellt, mitAnnahme]) {
    assert.deepEqual(nachpruefSchluessel({ vorher: VOR_DER_KORREKTUR, nachher, befunde: [], soll: NACHPRUEF_SOLL, annahmen: [] }).schluessel, planweiteSchluessel(NACHPRUEF_SOLL));
  }
});

test("nachprüfung: die Zeilen nach jeder Änderung stammen aus der ersten Prüfliste und stehen in der Nachprüfung jeder Änderung", () => {
  const planweit = planweiteSchluessel(NACHPRUEF_SOLL);
  const nachher = { ...VOR_DER_KORREKTUR, auftraege: VOR_DER_KORREKTUR.auftraege.slice(1) };
  const { schluessel } = nachpruefSchluessel({ vorher: VOR_DER_KORREKTUR, nachher, befunde: [], soll: NACHPRUEF_SOLL, annahmen: [] });
  assert.ok(planweit.length > 0);
  for (const zeile of planweit) {
    assert.ok(prueflisteSoll(nachher, NACHPRUEF_SOLL, []).includes(zeile), zeile);
    assert.ok(schluessel.includes(zeile), zeile);
  }
});

test("nachprüfung: ein entfernter Auftrag bringt seinen Befund unter entfallen und die Aufträge mit seinen Dateien in die Nachprüfung", () => {
  const umbau = auftrag("a0", { art: "umbau", prueft: "keine", erwarteteDateien: ["src/a.js", "test/a.test.js"] });
  const vorher = { ...VOR_DER_KORREKTUR, auftraege: [umbau, ...VOR_DER_KORREKTUR.auftraege] };
  const ergebnis = nachpruefSchluessel({ vorher, nachher: VOR_DER_KORREKTUR, befunde: [befundZu("umbau:a0")], soll: NACHPRUEF_SOLL, annahmen: [] });
  assert.deepEqual(ergebnis.schluessel, ["durchstich:a1", "b-nummer:B1", "nicht-zusammengelegt:a1", "gegenfrage:alle"]);
  assert.deepEqual([ergebnis.entfernt, ergebnis.entfallen], [["a0"], ["umbau:a0"]]);
});

test("nachprüfung: ein entfernter Auftrag bringt den Weg jeder Nummer, die er geprüft hat, in die Nachprüfung", () => {
  const ohneA3 = { ...VOR_DER_KORREKTUR, auftraege: VOR_DER_KORREKTUR.auftraege.filter(({ id }) => id !== "a3") };
  const ergebnis = nachpruefSchluessel({ vorher: VOR_DER_KORREKTUR, nachher: ohneA3, befunde: [], soll: NACHPRUEF_SOLL, annahmen: [] });
  assert.deepEqual(ergebnis.schluessel, ["durchstich:a1", "weg:B1", "b-nummer:B1", "gegenfrage:alle"]);
  assert.deepEqual(ergebnis.entfernt, ["a3"]);
});

function nachpruefungMit(vorher, id, felder) {
  const nachher = { ...vorher, auftraege: vorher.auftraege.map((eintrag) => (eintrag.id === id ? { ...eintrag, ...felder } : eintrag)) };
  return nachpruefSchluessel({ vorher, nachher, befunde: [], soll: NACHPRUEF_SOLL, annahmen: [] }).schluessel.toSorted();
}

function planweitUnd(...zeilen) {
  return [...planweiteSchluessel(NACHPRUEF_SOLL), ...zeilen].toSorted();
}

const NIE_SATZ = [{ satz: "Ein Anruf geht nie ohne Offenlegung hinaus.", quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }];

test("nachprüfung: ändert sich nur wasDarfNiePassieren eines Auftrags, prüft die Nachprüfung nur die Zeilen, die daran hängen", () => {
  assert.deepEqual(nachpruefungMit(VOR_DER_KORREKTUR, "a3", { wasDarfNiePassieren: NIE_SATZ }), planweitUnd(...zeilenDes("a3")));
});

test("nachprüfung: ein Feld ohne belegte Zeilenzuordnung bringt alle Zeilen des Auftrags in die Nachprüfung", () => {
  assert.deepEqual(nachpruefungMit(VOR_DER_KORREKTUR, "a3", { wasDarfNiePassieren: NIE_SATZ, notiz: "neu" }), planweitUnd("weg:B1", ...zeilenDes("a3")));
});

const FELD_AUFTRAG = auftrag("u2", {
  art: "umbau",
  bereich: ["src/a.js", "scripts/b.sh"],
  bereichsgrund: "test/x.test.js koppelt beide Dateien",
  erwarteteDateien: ["src/a.js", "scripts/b.sh"],
  abnahme: "test/x.test.js",
  prueft: ["S1"],
  wasDarfNiePassieren: [],
  abhaengigVon: [],
  falscheAngaben: [{ nummer: "S1", datei: "src/x.js", grund: "liest nichts", fundstelle: "src/a.js:1" }],
  altfunktionen: [],
});
const FELD_SCHNITT = { annahmen: [], auftraege: [auftrag("a1", { prueft: ["S2"], erwarteteDateien: ["src/c.js"] }), FELD_AUFTRAG] };
const UMBAU = "umbau:u2";
const GANZER_AUFTRAG = ["nie-saetze:u2", "allein-gruen:u2", "nicht-zusammengelegt:u2", "bereichsgrund:u2"];
const FALSCHE_ANGABE = "falsche-angabe:u2:S1:src/x.js";
const INHALT = [UMBAU, ...GANZER_AUFTRAG];

const ZEILEN_JE_FELD_DER_SCHNITTLISTE = [
  ["art", { art: "testumbau" }, INHALT],
  ["ziel", { ziel: "anders" }, INHALT],
  ["bereich", { bereich: ["src/a.js", "scripts/c.sh"] }, INHALT],
  ["bereichsgrund", { bereichsgrund: "test/y.test.js koppelt beide Dateien" }, GANZER_AUFTRAG],
  ["erwarteteDateien", { erwarteteDateien: ["src/a.js"] }, INHALT],
  ["abnahme", { abnahme: "test/y.test.js" }, INHALT],
  ["erwarteterFehler", { erwarteterFehler: "erwartet 1" }, INHALT],
  ["prueft", { prueft: ["S1", "B1"] }, [...INHALT, "weg:S1", "weg:B1"]],
  ["wasDarfNiePassieren", { wasDarfNiePassieren: NIE_SATZ }, GANZER_AUFTRAG],
  ["abhaengigVon", { abhaengigVon: [{ id: "a1", grund: "liest a1" }] }, INHALT],
  ["eingang", { eingang: "erreicht" }, INHALT],
  ["falscheAngaben", { falscheAngaben: [{ ...FELD_AUFTRAG.falscheAngaben[0], grund: "anders" }] }, [...GANZER_AUFTRAG, FALSCHE_ANGABE, "weg:S1"]],
  ["altfunktionen", { altfunktionen: [{ datei: "src/a.js", funktion: "alt", von: 1, bis: 2 }] }, INHALT],
  ["schema", { schema: "vertraeglich" }, INHALT],
];

test("nachprüfung: jede Zeile, deren Eingabe sich geändert hat, steht in der Nachprüfung", () => {
  assert.equal(ZEILEN_JE_FELD_DER_SCHNITTLISTE.length, 14);
  for (const [feld, wert, zeilen] of ZEILEN_JE_FELD_DER_SCHNITTLISTE) {
    assert.deepEqual(nachpruefungMit(FELD_SCHNITT, "u2", wert), planweitUnd(...zeilen), feld);
  }
});
