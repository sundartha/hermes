import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeForSpeech, shapeChunkForSpeech } from "../../src/speech-shape.js";

test("Unterstrich mitten in einer Mailadresse bleibt in der Sprachausgabe stehen", () => {
  assert.equal(shapeForSpeech("Mail an max_weber@beispiel.de"), "Mail an max_weber@beispiel.de.");
});

test("Unterstrich zwischen Umlaut-Buchstaben und Ziffer bleibt im gestreamten Häppchen stehen", () => {
  assert.equal(shapeChunkForSpeech("Kennung grüß_gott_2"), "Kennung grüß_gott_2");
});

test("Gedankenstrich mit Leerraum wird weiter zum Komma", () => {
  assert.equal(shapeForSpeech("Alles klar - ich buche"), "Alles klar, ich buche.");
});

test("Unterstriche am Wortrand als Markdown-Betonung fallen weg", () => {
  assert.equal(shapeForSpeech("_Wichtig_: morgen"), "Wichtig: morgen.");
});

test("Doppelte Unterstriche am Wortrand als Markdown-Fett fallen weg", () => {
  assert.equal(shapeForSpeech("__fett__ bitte"), "fett bitte.");
});

test("Listenzeichen am Zeilenanfang fallen weg, 9 und 18 bilden keine Spanne", () => {
  assert.equal(shapeForSpeech("Uhrzeiten:\n  - 9\n  - 18"), "Uhrzeiten: 9 18.");
});

test("Unterstriche zwischen Ziffern in einer Kartennummer fallen weg", () => {
  assert.equal(shapeForSpeech("Karte 4111_1111_1111_1111"), "Karte 4111111111111111.");
});

test("Kartennummer mit Unterstrichen wird auch im gestreamten Häppchen zusammengezogen", () => {
  assert.equal(shapeChunkForSpeech("Karte 4111_1111_1111_1111"), "Karte 4111111111111111");
});
