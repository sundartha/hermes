import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeForSpeech } from "../../src/speech-shape.js";

const ZIFFERN_IM_LANGEN_TEXT = 500;
const ZAHLEN_MIT_TRENNER = 250;
const GRENZE_MILLISEKUNDEN = 1000;
const MELDUNG_SPANNE_ZUM_KOMMA = "Spanne vor Satzende wird zum Komma";

const dauerInMillisekunden = (aufgabe) => {
  const start = performance.now();
  aufgabe();
  return performance.now() - start;
};

test("Spanne vor Satzende mit folgender Zahl bleibt Spanne", () => {
  assert.equal(
    shapeForSpeech("Geöffnet 9 - 18. 24 Stunden erreichbar ist die Hotline"),
    "Geöffnet 9-18. 24 Stunden erreichbar ist die Hotline.",
    MELDUNG_SPANNE_ZUM_KOMMA,
  );
});

test("Spanne vor Satzende mit Uhrzeit oder Doppelpunkt bleibt Spanne", () => {
  assert.equal(
    shapeForSpeech("Termin 9:30 - 18:00. 2 Plätze sind frei"),
    "Termin 9:30-18:00. 2 Plätze sind frei.",
    MELDUNG_SPANNE_ZUM_KOMMA,
  );
  assert.equal(
    shapeForSpeech("Kosten 10 - 20: 3 Varianten"),
    "Kosten 10-20: 3 Varianten.",
    MELDUNG_SPANNE_ZUM_KOMMA,
  );
});

test("Spanne bleibt Spanne, wenn auf die rechte Zahl ein Strich ohne Leerraum und erst später eine Zahl folgt", () => {
  assert.equal(
    shapeForSpeech("Geöffnet 9 - 18-24 3 Tage"),
    "Geöffnet 9-18-24 3 Tage.",
    MELDUNG_SPANNE_ZUM_KOMMA,
  );
});

test("einzeln gesprochene Ziffern mit Strich bleiben Komma", () => {
  assert.equal(
    shapeForSpeech("Ihre Nummer ist 0 1 5 1 - 2 3 4 5 6 7"),
    "Ihre Nummer ist 0 1 5 1, 2 3 4 5 6 7.",
  );
});

test("jeder Strich einer Kette bleibt Komma", () => {
  assert.equal(
    shapeForSpeech("Kartennummer: 4111 - 1111 - 1111 - 1111"),
    "Kartennummer: 4111, 1111, 1111, 1111.",
  );
});

test("lange Ziffernfolgen vor Strich-Uhr werden unter einer Sekunde geformt", () => {
  const ziffern = "1".repeat(ZIFFERN_IM_LANGEN_TEXT);
  const mitPunkt = "1.".repeat(ZAHLEN_MIT_TRENNER);
  const mitDoppelpunkt = "1:".repeat(ZAHLEN_MIT_TRENNER);
  for (const zahl of [ziffern, mitPunkt, mitDoppelpunkt]) {
    const dauer = dauerInMillisekunden(() => shapeForSpeech(`${zahl} - Uhr`));
    assert.ok(dauer < GRENZE_MILLISEKUNDEN, `Formung dauerte ${dauer} ms`);
  }
});
