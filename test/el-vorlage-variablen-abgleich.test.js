import assert from "node:assert/strict";
import test from "node:test";

import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";

import { consultAllowedForCall } from "../src/consult/gate.js";

import { sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";
import { templatePlaceholderNames } from "./helpers/el-vorlage-variablen.mjs";

const EXPECTED_VARIABLE_COUNT = 16;

const sentDynamicVariables = () => sendeAnrufstart({ makeElevenLabsOutbound, consultAllowedForCall });

function fehlendeUndUeberzaehlige(seiteA, seiteB) {
  const fehlend = [...seiteA].filter((name) => !seiteB.has(name));
  const ueberzaehlig = [...seiteB].filter((name) => !seiteA.has(name));
  return { fehlend, ueberzaehlig };
}

test("EL-VORLAGE-VARIABLEN: verbrauchte Vorlagen-Variablen und gesendete dynamic_variables sind deckungsgleich (sechzehn Namen)", async () => {
  const seiteA = templatePlaceholderNames();
  const gesendet = await sentDynamicVariables();
  const seiteB = new Set(Object.keys(gesendet));

  assert.equal(
    seiteA.size,
    EXPECTED_VARIABLE_COUNT,
    `Vorlage verbraucht ${seiteA.size} Variablen statt der erwarteten ${EXPECTED_VARIABLE_COUNT}: ${[...seiteA].sort().join(", ")}`,
  );
  assert.equal(
    seiteB.size,
    EXPECTED_VARIABLE_COUNT,
    `outbound.js sendet ${seiteB.size} dynamic_variables statt der erwarteten ${EXPECTED_VARIABLE_COUNT}: ${[...seiteB].sort().join(", ")}`,
  );

  const { fehlend, ueberzaehlig } = fehlendeUndUeberzaehlige(seiteA, seiteB);
  assert.deepEqual(
    fehlend,
    [],
    `Vorlage verbraucht ${fehlend.join(", ")} - outbound.js schickt das NICHT mit. ` +
      "Das ist der Close-1008-Fall (tasks/spike2-messung.jsonl:12): der Platzhalter " +
      "bleibt unaufgeloest, der Anbieter bricht das Gespraech vor dem ersten Wort ab.",
  );
  assert.deepEqual(
    ueberzaehlig,
    [],
    `outbound.js sendet ${ueberzaehlig.join(", ")} zusaetzlich - die Vorlage benutzt das ` +
      "nirgends. Toter Ballast, keine Platzhalter-Aufloesung haengt daran.",
  );
});
