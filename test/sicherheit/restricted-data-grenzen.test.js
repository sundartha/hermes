import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RESTRICTED_PEM_BLOCK,
  RESTRICTED_TOKEN_IN_KARTE,
  RESTRICTED_TOKEN_MIT_ANHANG,
  RESTRICTED_TOKEN_MIT_KENNWORT,
  RESTRICTED_TOKEN_NACH_KENNUNG,
  RESTRICTED_TOKEN_ZWISCHEN,
} from "../gemeinsam/erfundene-geheimnisse.js";
import { findRestrictedData, firstRestrictedField, maskRestrictedText } from "../../src/restricted-data.js";

const KARTE = "4111 1111 1111 1111";
const TOKEN_ZWISCHEN = RESTRICTED_TOKEN_ZWISCHEN;
const KENNUNG_MIT_TOKEN = `123456 ${RESTRICTED_TOKEN_NACH_KENNUNG}`;
const PEM = RESTRICTED_PEM_BLOCK;
const TOKEN_IN_KARTE = RESTRICTED_TOKEN_IN_KARTE;
const TOKEN_MIT_KENNWORT = RESTRICTED_TOKEN_MIT_KENNWORT;
const TOKEN_MIT_ANHANG = RESTRICTED_TOKEN_MIT_ANHANG;
const KENNUNG_VOR_BLOCK = "123456";

const TREFFER_TABELLE = [
  [
    "Token liegt hinter einer Karte, ein zweiter Token liegt in der Kennung dahinter",
    `${KARTE} ${TOKEN_ZWISCHEN} ssn: ${KENNUNG_MIT_TOKEN}`,
    [
      ["payment_card", KARTE],
      ["credential_secret", TOKEN_ZWISCHEN],
      ["government_id", KENNUNG_MIT_TOKEN],
    ],
  ],
  [
    "Karte beginnt genau am Ende des Blocks und bleibt",
    `${PEM}${KARTE}`,
    [
      ["credential_secret", PEM],
      ["payment_card", KARTE],
    ],
  ],
  [
    "Token beginnt innerhalb einer Karte und wird verworfen",
    TOKEN_IN_KARTE,
    [["payment_card", "4111111111111111"]],
  ],
  [
    "zwei Kandidaten überlappen einander, nur der erste bleibt",
    `password=${TOKEN_MIT_KENNWORT}!`,
    [["credential_secret", TOKEN_MIT_KENNWORT]],
  ],
  [
    "Schlüsselblock beginnt genau am Ende einer Kennung und bleibt",
    `ssn: ${KENNUNG_VOR_BLOCK}${PEM}`,
    [
      ["government_id", KENNUNG_VOR_BLOCK],
      ["credential_secret", PEM],
    ],
  ],
  [
    "zwei Schlüsselblöcke grenzen aneinander und bleiben beide",
    `${PEM}${PEM}`,
    [
      ["credential_secret", PEM],
      ["credential_secret", PEM],
    ],
  ],
  ["Token am genauen Textende", TOKEN_ZWISCHEN, [["credential_secret", TOKEN_ZWISCHEN]]],
  [
    "Token reicht über die feste Musterlänge hinaus",
    TOKEN_MIT_ANHANG,
    [["credential_secret", TOKEN_MIT_ANHANG]],
  ],
];

for (const [name, text, erwartet] of TREFFER_TABELLE) {
  test(`restricted-data-grenzen: Treffer, ${name}`, () => {
    const treffer = findRestrictedData(text);
    assert.deepEqual(
      treffer.map((hit) => [hit.category, text.slice(hit.start, hit.end)]),
      erwartet,
    );
    assert.deepEqual(
      treffer.map((hit) => hit.end <= text.length),
      erwartet.map(() => true),
    );
  });
}

const KARTEN_TABELLE = [
  ["erste Ziffer 6 (obere Grenze)", "6011 1111 1111 1117", true],
  ["erste Ziffer 5", "5500 0000 0000 0004", true],
  ["erste Ziffer 7 (über der Grenze)", "7111 0000 0000 0001", false],
  ["letzte Gruppe mit 3 Ziffern", "4111 0000 0000 001", true],
  ["letzte Gruppe mit 5 Ziffern", "4111 0000 0000 00001", false],
  ["drei Gruppen 4-5-5, nur die erste passt", "4111 00000 00008", false],
  ["Luhn-gültige Ziffernfolge mit nicht passender Gruppenform", "4111 1111111 11111", false],
];

for (const [name, karte, erkannt] of KARTEN_TABELLE) {
  test(`restricted-data-grenzen: Kartenform, ${name}`, () => {
    const text = `Kartennummer: ${karte}`;
    assert.deepEqual(
      findRestrictedData(text).map((hit) => [hit.category, text.slice(hit.start, hit.end)]),
      erkannt ? [["payment_card", karte]] : [],
    );
  });
}

const MASKEN_TABELLE = [
  [
    "mehrere akzeptierte Spans",
    `${KARTE} ${TOKEN_ZWISCHEN} ssn: ${KENNUNG_MIT_TOKEN}`,
    "****1111 [restricted-credential] ssn: [restricted-government-id]",
  ],
  ["Karte direkt hinter dem Schlüsselblock", `${PEM}${KARTE}`, "[restricted-credential]****1111"],
  ["Schlüsselblock direkt hinter einer Kennung", `ssn: ${KENNUNG_VOR_BLOCK}${PEM}`, "ssn: [restricted-government-id][restricted-credential]"],
  ["zwei aneinandergrenzende Schlüsselblöcke", `${PEM}${PEM}`, "[restricted-credential][restricted-credential]"],
  ["Token in der Karte", `x ${TOKEN_IN_KARTE}`, "x sk-****1111abcd"],
  ["Kennwort mit Token", `password=${TOKEN_MIT_KENNWORT}!`, "password=[restricted-credential]!"],
  ["Token mit Anhang über die feste Musterlänge hinaus", TOKEN_MIT_ANHANG, "[restricted-credential]"],
];

for (const [name, text, erwartet] of MASKEN_TABELLE) {
  test(`restricted-data-grenzen: Maskierung, ${name}`, () => {
    assert.equal(maskRestrictedText(text), erwartet);
  });
}

const FELD_TABELLE = [
  ["Roh-String als Wurzelwert", KARTE, { category: "payment_card", field: "(root)" }],
  ["Feld im Objekt", { notiz: KARTE }, { category: "payment_card", field: "notiz" }],
  ["Wert ohne Sperrdaten", "Guten Tag", null],
];

for (const [name, wert, erwartet] of FELD_TABELLE) {
  test(`restricted-data-grenzen: Feld, ${name}`, () => {
    assert.deepEqual(firstRestrictedField(wert, []), erwartet);
  });
}
