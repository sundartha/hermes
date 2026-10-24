import assert from "node:assert/strict";
import { test } from "node:test";

import { Fortschritt, RUECKSENDUNGEN } from "../../tools/auftrag/planung/fortschritt.mjs";

const SOLL = new Map([["S1", {}], ["S2", {}], ["S3", {}], ["S4", {}], ["B1", {}]]);

function auftrag(id, prueft, zusatz = {}) {
  return { id, art: "funktion", bereich: "src/routes/", prueft, ...zusatz };
}

const SCHNITT = { auftraege: [auftrag("a1", ["S1"]), auftrag("a2", ["S2"]), auftrag("a3", ["S3"]), auftrag("a14", ["S4", "B1"])] };
const UMBENANNT = { auftraege: [auftrag("a1", ["S1"]), auftrag("a2", ["S2"]), auftrag("a3", ["S3"]), auftrag("a15", ["B1", "S4"])] };

function runden(schleife, folge, schnitt = SCHNITT) {
  return folge.map((befunde) => schleife.endeNachRunde(befunde, schnitt, SOLL));
}

test("fortschritt: eine Rücksendung mit weniger und neuen Befunden geht weiter", () => {
  const schleife = new Fortschritt("zuschnitt");
  const ergebnis = runden(schleife, [
    ["Regel Abnahmetest: a1 hat keinen Test", "Regel Bereich: a2 liegt in zwei Ordnern", "Regel Form: es gibt keine Gliederung"],
    ["Regel Abnahmetest: a3 hat keinen Test", "Regel Eingang: a14 nennt keinen Eingang"],
  ]);
  assert.deepEqual(ergebnis, [null, null]);
  assert.deepEqual(schleife.bericht().runden.map(({ zahl }) => zahl), [3, 2]);
  assert.equal(schleife.bericht().ende, null);
});

test("fortschritt: ein Befund, der nach einer späteren Runde wiederkommt, beendet die Schleife", () => {
  const schleife = new Fortschritt("korrektur");
  const wiederkehrender = "Regel Abnahmetest: a1 hat keinen Test";
  const [erste, zweite, dritte] = runden(schleife, [
    [wiederkehrender, "Regel Bereich: a2 liegt in zwei Ordnern", "Regel Eingang: a3 nennt keinen Eingang"],
    ["Regel Nie-Sätze: a14 hat keinen Nie-Satz", "Regel Form: es gibt keine Gliederung"],
    [wiederkehrender],
  ]);
  assert.equal(erste, null);
  assert.equal(zweite, null);
  assert.match(dritte.grund, /^korrektur: Befunde blieben nach 2 Rücksendungen offen, wiederkehrend: /u);
  assert.match(schleife.bericht().ende, /^wiederkehrend/u);
  assert.deepEqual(schleife.bericht().runden.map(({ zahl }) => zahl), [3, 2, 1]);
});

test("fortschritt: gleich viele Befunde beenden die Schleife", () => {
  const schleife = new Fortschritt("zuschnitt");
  const [erste, zweite] = runden(schleife, [
    ["Regel Abnahmetest: a1 hat keinen Test", "Regel Bereich: a2 liegt in zwei Ordnern"],
    ["Regel Eingang: a3 nennt keinen Eingang", "Regel Nie-Sätze: a14 hat keinen Nie-Satz"],
  ]);
  assert.equal(erste, null);
  assert.equal(zweite.grund, "zuschnitt: Befunde blieben nach 1 Rücksendungen offen, die Zahl der Befunde sank nicht (2 → 2)");
});

test("fortschritt: ein umbenannter Auftrag bleibt derselbe Befund", () => {
  const schleife = new Fortschritt("korrektur");
  assert.equal(schleife.endeNachRunde(["Regel Abnahmetest: a14 hat keinen Test", "Regel Bereich: a2 liegt in zwei Ordnern"], SCHNITT, SOLL), null);
  const ende = schleife.endeNachRunde(["Regel Abnahmetest: a15 hat keinen Test"], UMBENANNT, SOLL);
  assert.match(ende.grund, /wiederkehrend/u);
});

test("fortschritt: dieselbe Regel und derselbe Auftrag mit anderer Datei ist derselbe Befund", () => {
  const schleife = new Fortschritt("korrektur");
  assert.equal(schleife.endeNachRunde(["Regel Änderungsdateien: a2 ändert src/x.js außerhalb des Bereichs", "Regel Form: es gibt keine Gliederung"], SCHNITT, SOLL), null);
  const ende = schleife.endeNachRunde(["Regel Änderungsdateien: a2 ändert src/y.js außerhalb des Bereichs"], SCHNITT, SOLL);
  assert.match(ende.grund, /wiederkehrend/u);
});

test("fortschritt: dieselbe Regel und derselbe Auftrag mit anderer Nummer ist derselbe Befund", () => {
  const schleife = new Fortschritt("korrektur");
  assert.equal(schleife.endeNachRunde(["Regel Abnahmetest: a14 prüft S4 ohne Test", "Regel Form: es gibt keine Gliederung"], SCHNITT, SOLL), null);
  const ende = schleife.endeNachRunde(["Regel Abnahmetest: a14 prüft B1 ohne Test"], SCHNITT, SOLL);
  assert.match(ende.grund, /wiederkehrend/u);
});

test("fortschritt: eine andere Regel oder ein anderer Auftrag ist ein neuer Befund", () => {
  const schleife = new Fortschritt("korrektur");
  assert.equal(schleife.endeNachRunde(["Regel Änderungsdateien: a2 ändert src/x.js", "Regel Form: es gibt keine Gliederung", "Regel Eingang: a1 nennt keinen Eingang"], SCHNITT, SOLL), null);
  assert.equal(schleife.endeNachRunde(["Regel Änderungsdateien: a3 ändert src/x.js", "Regel Bereich: a2 liegt in zwei Ordnern"], SCHNITT, SOLL), null);
});

test("fortschritt: ohne Schnittliste besteht der Schlüssel aus Regel und Nummern", () => {
  const schleife = new Fortschritt("gliederung");
  assert.equal(schleife.endeNachRunde(["S4 steht in 2 Gruppen statt in genau einer", "B1 steht in 0 Gruppen statt in genau einer"], null, SOLL), null);
  assert.match(schleife.endeNachRunde(["S4 steht in 3 Gruppen statt in genau einer"], null, SOLL).grund, /wiederkehrend/u);
  const ohneNummer = new Fortschritt("gliederung");
  assert.equal(ohneNummer.endeNachRunde(["gruppen fehlt: eine Liste von Erkundungsgruppen", "Gruppe 1: eingang fehlt"], null, SOLL), null);
  assert.equal(ohneNummer.endeNachRunde(["Gruppe 2: eingang fehlt"], null, SOLL), null);
});

test("fortschritt: Befunde des Prüfers zum selben Schlüssel kehren wieder, auch mit anderem Text", () => {
  const schleife = new Fortschritt("pruefung");
  const befund = (schluessel, text) => ({ schluessel, ergebnis: "befund", befund: text, fundstelle: "src/a.js:1" });
  assert.equal(schleife.endeNachRunde([befund("allein-gruen:a2", "a2 braucht a1"), befund("weg:S1", "Weg falsch")], SCHNITT, SOLL), null);
  assert.match(schleife.endeNachRunde([befund("allein-gruen:a2", "a2 liest den Status aus a1")], SCHNITT, SOLL).grund, /wiederkehrend/u);
});

test("fortschritt: Antwortbefunde zweier verschiedener Prüferregeln zum selben Auftrag kehren nicht wieder", () => {
  const ohneAntwort = (schluessel) => `${schluessel}: Befund des Prüfers ohne Antwort des Planers`;
  const schleife = new Fortschritt("korrektur");
  assert.equal(schleife.endeNachRunde([ohneAntwort("allein-gruen:a2"), ohneAntwort("weg:S1")], SCHNITT, SOLL), null);
  assert.equal(schleife.endeNachRunde([ohneAntwort("nie-saetze:a2")], SCHNITT, SOLL), null);
  const dieselbe = new Fortschritt("korrektur");
  assert.equal(dieselbe.endeNachRunde([ohneAntwort("allein-gruen:a2"), ohneAntwort("weg:S1")], SCHNITT, SOLL), null);
  assert.match(dieselbe.endeNachRunde(["allein-gruen:a2: „korrigiert“, aber der Auftrag a2 ist unverändert"], SCHNITT, SOLL).grund, /wiederkehrend/u);
});

test("fortschritt: zwei verschiedene Befunde ohne Regel zum selben Auftrag kehren nicht wieder", () => {
  const schleife = new Fortschritt("korrektur");
  assert.equal(schleife.endeNachRunde(["a14: funktion ohne Nummer in prueft", "a2: erwarteteDateien nennt keine Produktdatei"], SCHNITT, SOLL), null);
  assert.equal(schleife.endeNachRunde(["a14: erwarteteDateien nennt keine Produktdatei"], SCHNITT, SOLL), null);
  const dieselbe = new Fortschritt("korrektur");
  assert.equal(dieselbe.endeNachRunde(["a14: Änderungsdatei src/x.js von S4 fehlt", "a2: erwarteteDateien nennt keine Produktdatei"], SCHNITT, SOLL), null);
  assert.match(dieselbe.endeNachRunde(["a14: Änderungsdatei src/y.js von B1 fehlt"], SCHNITT, SOLL).grund, /wiederkehrend/u);
});

test("fortschritt: nach der Grenze an Rücksendungen endet die Schleife, auch wenn die Befunde sinken", () => {
  const schleife = new Fortschritt("zuschnitt");
  const ergebnis = runden(schleife, [
    ["Regel Abnahmetest: a1 hat keinen Test", "Regel Eingang: a1 nennt keinen Eingang", "Regel Bereich: a2 liegt in zwei Ordnern", "Regel Form: es gibt keine Gliederung"],
    ["Regel Abnahmetest: a2 hat keinen Test", "Regel Eingang: a2 nennt keinen Eingang", "Regel Bereich: a3 liegt in zwei Ordnern"],
    ["Regel Abnahmetest: a3 hat keinen Test", "Regel Eingang: a3 nennt keinen Eingang"],
    ["Regel Abnahmetest: a14 hat keinen Test"],
  ]);
  assert.deepEqual(ergebnis.slice(0, 3), [null, null, null]);
  assert.equal(ergebnis[3].grund, "zuschnitt: Befunde blieben nach 3 Rücksendungen offen, nach 3 Rücksendungen");
  assert.equal(new Fortschritt("neuschnitt", 0).endeNachRunde(["Regel Form: es gibt keine Gliederung"], SCHNITT, SOLL).grund, "neuschnitt: Befunde blieben nach 0 Rücksendungen offen, nach 0 Rücksendungen");
});

test("fortschritt: ein Befund derselben Regel zum selben Auftrag, der nur Sätze zitiert, die keine Runde davor zitierte, ist neu; zitiert er einen schon genannten Satz wieder, kehrt er wieder", () => {
  const pitch = ["## Fallen", "- Das Zeichen ist genau „…“ (U+2026, ein Zeichen), nicht drei Punkte.", "", "## Nicht-Ziele", "- Nicht Teil dieser Änderung: `clampAtWordBoundary` zu ändern.", "- Nicht Teil dieser Änderung: die Grenzen 100, 200, 600 Zeichen und 3 Anrufe zu ändern."].join("\n");
  const schleife = new Fortschritt("pruefung", RUECKSENDUNGEN, [pitch]);
  const gegenfrage = (text) => ({ schluessel: "gegenfrage:alle", ergebnis: "befund", befund: text, fundstelle: "pitch.md" });
  const zeichen = "„Das Zeichen ist genau „…“ (U+2026, ein Zeichen), nicht drei Punkte.“";
  const hilfe = "„Nicht Teil dieser Änderung: `clampAtWordBoundary` zu ändern.“";
  const grenzen = "„Nicht Teil dieser Änderung: die Grenzen 100, 200, 600 Zeichen und 3 Anrufe zu ändern.“";
  assert.equal(schleife.endeNachRunde([gegenfrage(`Bei a1 fehlen in wasDarfNiePassieren: (1) pitch.md, ## Fallen: ${zeichen} (2) pitch.md, ## Nicht-Ziele: ${hilfe}`), { schluessel: "weg:S1", ergebnis: "befund", befund: "Weg falsch" }], SCHNITT, SOLL), null);
  assert.equal(schleife.endeNachRunde([gegenfrage(`Die Sätze der vorigen Prüfung stehen jetzt bei a1. Es fehlt noch pitch.md, ## Nicht-Ziele: ${grenzen}`)], SCHNITT, SOLL), null);
  assert.match(schleife.endeNachRunde([gegenfrage(`Bei a1 fehlt weiter ${grenzen}`)], SCHNITT, SOLL).grund, /wiederkehrend/u);
});

test("fortschritt: ersetzt der Planer einen Nie-Satz, der in keiner Quelle steht, durch einen anderen solchen Satz, kehrt der Befund derselben Regel zum selben Auftrag wieder", () => {
  const schleife = new Fortschritt("zuschnitt", RUECKSENDUNGEN, ["## Fallen\n- Der Code wird nur gehasht gespeichert."]);
  const falsch = (satz) => `Regel Nie-Sätze: a1 wasDarfNiePassieren: „${satz}“ steht nicht wörtlich als ganzer Satz oder ganze Zeile in pitch.md, ## Fallen`;
  assert.equal(schleife.endeNachRunde([falsch("Der Code wird nie im Klartext gespeichert."), "Regel Form: es gibt keine Gliederung"], SCHNITT, SOLL), null);
  assert.match(schleife.endeNachRunde([falsch("Der Code bleibt immer gehasht.")], SCHNITT, SOLL).grund, /wiederkehrend/u);
});
