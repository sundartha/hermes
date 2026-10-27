import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeChunkForSpeech, shapeForSpeech } from "../../src/speech-shape.js";

const ZIFFERN_IM_LANGEN_TEXT = 500;
const ZAHLEN_MIT_TRENNER = 250;
const GRENZE_MILLISEKUNDEN = 1000;

const sprachausgabe = (antwort, erwartet) => {
  assert.equal(shapeForSpeech(antwort), erwartet, erwartet);
};

const dauerInMillisekunden = (aufgabe) => {
  const start = performance.now();
  aufgabe();
  return performance.now() - start;
};

test("Zahl - Zahl wird zur Spanne ohne Leerraum", () => {
  sprachausgabe("Geöffnet 9 - 18 Uhr", "Geöffnet 9-18 Uhr.");
  sprachausgabe("9 - 18 Uhr", "9-18 Uhr.");
  sprachausgabe("Kosten 10 - 20", "Kosten 10-20.");
});

test("Uhrzeiten mit Doppelpunkt oder Punkt bleiben eine Spanne", () => {
  sprachausgabe("Termin 9:30 - 18:00", "Termin 9:30-18:00.");
  sprachausgabe("Offen 18.00 - 20.30 Uhr", "Offen 18.00-20.30 Uhr.");
});

test("Strich mit beliebig viel Leerraum drumherum bildet die Spanne", () => {
  sprachausgabe("Geöffnet 9   -   18 Uhr", "Geöffnet 9-18 Uhr.");
  sprachausgabe("Geöffnet 9\t-\t18 Uhr", "Geöffnet 9-18 Uhr.");
});

test("zwei Spannen im selben Satz bleiben beide Spannen", () => {
  sprachausgabe("Offen 9 - 12 und 14 - 18 Uhr", "Offen 9-12 und 14-18 Uhr.");
});

test("Streaming-Häppchen formt Zahl - Zahl zur Spanne", () => {
  const erwartet = "Kosten 10-20 Euro.";
  assert.equal(shapeChunkForSpeech("Kosten 10 - 20 Euro."), erwartet, erwartet);
});

test("Spanne ohne Leerraum geht unverändert durch", () => {
  sprachausgabe("Termin 14-15 Uhr", "Termin 14-15 Uhr.");
});

test("Wort - Zahl bleibt ein Komma", () => {
  sprachausgabe("Termin am Montag - 18 Uhr", "Termin am Montag, 18 Uhr.");
});

test("Zahl - Wort und Zahl mit Einheit bleiben ein Komma", () => {
  sprachausgabe("Ab 18 - Montag", "Ab 18, Montag.");
  sprachausgabe("Von 9 Uhr - 18 Uhr", "Von 9 Uhr, 18 Uhr.");
});

test("Punkt hinter der Zahl gehört nicht zur Zahl, daher keine Spanne", () => {
  sprachausgabe("Seite 9. - 18", "Seite 9., 18.");
});

test("Zahl, die durch Leerraum an eine weitere Zahl grenzt, behält das Komma", () => {
  sprachausgabe("Ihre Nummer ist 0 1 5 1 - 2 3 4 5 6 7", "Ihre Nummer ist 0 1 5 1, 2 3 4 5 6 7.");
  sprachausgabe("Nummer 1 2 - 34", "Nummer 1 2, 34.");
  sprachausgabe("Nummer 12 - 3 4", "Nummer 12, 3 4.");
});

test("Vorwahl mit Strich wird zur Spanne", () => {
  sprachausgabe("Rufen Sie 030 - 123456 an", "Rufen Sie 030-123456 an.");
});

test("Kette aus Zahlen mit Strich wird überall zum Komma", () => {
  sprachausgabe(
    "Ich wiederhole Ihre Kartennummer: 4111 - 1111 - 1111 - 1111",
    "Ich wiederhole Ihre Kartennummer: 4111, 1111, 1111, 1111.",
  );
  sprachausgabe("Seite 1 - 2 - 3", "Seite 1, 2, 3.");
});

test("Kette mit unterschiedlich langem Leerraum wird überall zum Komma", () => {
  sprachausgabe(
    "Kartennummer: 4111 - 1111  -  1111 - 1111",
    "Kartennummer: 4111, 1111, 1111, 1111.",
  );
  sprachausgabe("Seite 1\t-\t2\t-\t3", "Seite 1, 2, 3.");
});

test("Kette mit einem Wort an einem Ende lässt die Zahlenpaare Spanne", () => {
  sprachausgabe("Von Montag - 2 - 3", "Von Montag, 2-3.");
  sprachausgabe("Es gilt 2 - 3 - Montag", "Es gilt 2-3, Montag.");
});

test("Listenzeichen am Zeilenanfang bildet keine Spanne mit der Zahl davor", () => {
  sprachausgabe("Zimmer 9\n- 18 Gäste", "Zimmer 9 18 Gäste.");
  sprachausgabe("- 9 - 18 Uhr", "9-18 Uhr.");
});

test("Wort - Wort bleibt ein Komma", () => {
  sprachausgabe("Hallo - Welt", "Hallo, Welt.");
});

test("Unterstrich in einer Adresse bleibt stehen", () => {
  sprachausgabe("Schreiben an max_weber@beispiel.de", "Schreiben an max_weber@beispiel.de.");
});

test("Unterstrich zwischen Buchstaben mit Umlaut und ß bleibt stehen", () => {
  sprachausgabe("Sagen Sie grüß_gott", "Sagen Sie grüß_gott.");
});

test("Unterstrich zwischen Buchstabe und Ziffer bleibt stehen", () => {
  sprachausgabe("Kennung abc_123", "Kennung abc_123.");
  sprachausgabe("Kennung 123_abc", "Kennung 123_abc.");
});

test("Unterstrich zwischen zwei Ziffern fällt weg", () => {
  sprachausgabe("Nummer 4111_1111", "Nummer 41111111.");
});

test("Unterstrich am Wortrand fällt weg", () => {
  sprachausgabe("_Wichtig_: bitte kommen", "Wichtig: bitte kommen.");
  sprachausgabe("Das ist _kursiv_ gemeint", "Das ist kursiv gemeint.");
});

test("Unterstrich neben einem Unterstrich fällt weg", () => {
  sprachausgabe("Das ist __fett__ gemeint", "Das ist fett gemeint.");
  sprachausgabe("Kennung ab__cd", "Kennung abcd.");
});

test("Unterstrich vor oder hinter Leerraum fällt weg", () => {
  sprachausgabe("Wort_ danach", "Wort danach.");
  sprachausgabe("davor _Wort", "davor Wort.");
});

test("SG-27 500 Ziffern ohne Trenner vor Strich werden in unter einer Sekunde geformt", () => {
  const ziffern = "1234567890".repeat(ZIFFERN_IM_LANGEN_TEXT / 10);
  let ergebnis;
  const dauer = dauerInMillisekunden(() => {
    ergebnis = shapeForSpeech(`Nummer ${ziffern} - Uhr`);
  });
  assert.equal(ergebnis, `Nummer ${ziffern}, Uhr.`);
  assert.ok(dauer < GRENZE_MILLISEKUNDEN, `Formung dauerte ${dauer} ms`);
});

test("SG-27 250 Ziffern mit Punkt oder Doppelpunkt dazwischen: unter einer Sekunde", () => {
  const trenner = [".", ":"];
  const zahl = Array.from({ length: ZAHLEN_MIT_TRENNER }, (_, index) => String((index + 1) % 10))
    .map((ziffer, index) => (index === 0 ? ziffer : trenner[index % 2] + ziffer))
    .join("");
  let ergebnis;
  const dauer = dauerInMillisekunden(() => {
    ergebnis = shapeForSpeech(`Nummer ${zahl} - Uhr`);
  });
  assert.equal(ergebnis, `Nummer ${zahl}, Uhr.`);
  assert.ok(dauer < GRENZE_MILLISEKUNDEN, `Formung dauerte ${dauer} ms`);
});
