import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KONTROLL_VERSUCHE,
  statusNachWiederholung,
} from "../gemeinsam/status-nach-wiederholung.mjs";

const HTTP_FOUND = 302;
const HTTP_UNAVAILABLE = 503;
const HTTP_BAD_REQUEST = 400;

function folge(stati) {
  const aufrufe = [];
  const abfrage = async () => {
    aufrufe.push(stati[Math.min(aufrufe.length, stati.length - 1)]);
    return aufrufe.at(-1);
  };
  return { abfrage, aufrufe };
}

const FAELLE = [
  ["Positiv-Kontrolle: sofort 302 wird nicht wiederholt", [HTTP_FOUND], HTTP_FOUND, 1],
  [
    "Positiv-Kontrolle: 503 und dann 302 gilt als umgeleitet",
    [HTTP_UNAVAILABLE, HTTP_FOUND],
    HTTP_FOUND,
    2,
  ],
  [
    "Positiv-Kontrolle: 503 fuenfmal bleibt 503 nach genau fuenf Versuchen",
    [HTTP_UNAVAILABLE],
    HTTP_UNAVAILABLE,
    KONTROLL_VERSUCHE,
  ],
  [
    "Positiv-Kontrolle: 503 viermal und dann 302 gilt noch als umgeleitet",
    [503, 503, 503, 503, HTTP_FOUND],
    HTTP_FOUND,
    5,
  ],
  [
    "Positiv-Kontrolle: ein anderer Status als 503 wird nicht wiederholt",
    [HTTP_BAD_REQUEST, HTTP_FOUND],
    HTTP_BAD_REQUEST,
    1,
  ],
];

for (const [name, stati, erwartet, versuche] of FAELLE) {
  test(name, async () => {
    const { abfrage, aufrufe } = folge(stati);
    assert.equal(await statusNachWiederholung(abfrage), erwartet);
    assert.equal(aufrufe.length, versuche);
  });
}
