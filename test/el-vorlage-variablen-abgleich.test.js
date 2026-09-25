// ---- Pin: Vorlagen-Platzhalter gegen tatsaechlich gesendete dynamic_variables --------
// Owner-Auftrag 15.08.2026 (Phase 2), woertlich: "Die neun dynamic_variables werden gegen
// src/ verglichen, nicht nur Vorlage gegen Testdefinitionen. Ein umbenannter Name bliebe
// heute gruen - beim echten Anbieter bricht das Gespraech stumm ab. Genau das ist am
// 14.08. passiert."
//
// BELEGT in tasks/spike2-messung.jsonl (NICHT spike1b-messung.jsonl - die Datei traegt
// keinen Fund dazu, s. Rueckgabe-Bericht dieser Aufgabe), Zeile 7 und 12:
//   Zeile 7  "termination_reason":"Missing required dynamic variables in first message:
//            {'owner_name'}","fehlercode":1008
//   Zeile 12 "Fehlt die Variable, beendet ElevenLabs das Gespraech unmittelbar nach dem
//            Abheben mit Code 1008 - der Angerufene hoert Stille. Die Variable MUSS in
//            conversation_initiation_client_data.dynamic_variables stehen; auf oberster
//            Ebene wird sie ohne Fehlermeldung verworfen."
// Ein Platzhalter, den der Prompt der Vorlage benutzt, aber den outbound.js nicht
// mitschickt, ist GENAU dieser Fall - reproduzierbar ohne echten Anruf (CLAUDE.md
// "Wurzel statt Symptom").
//
// ZWEI MENGEN, ECHT GEWONNEN, KEINE VON HAND GEPFLEGTE LISTE (Auftragsgrenze):
//   Seite A  {{name}}-Vorkommen aus dem TEXT der echten Agenten-Vorlage
//            (agent.conversation_config.agent.prompt.prompt + .first_message - dieselben
//            zwei Quellen, die die Vorlage selbst unter _besitz.felder fuer den Eintrag
//            "dynamic_variables" nennt) - per Regex aus der Datei extrahiert. Dazu die
//            beiden Quellen, die KEIN {{name}} tragen und trotzdem eine dynamische
//            Variable verbrauchen: der Anrufbeantworter-Text (DE1) und die
//            dynamic_variable-Verweise der WERKZEUGE (SEC-P4).
//   Seite B  die Schluessel des dynamic_variables-Objekts, das
//            src/elevenlabs/outbound.js (makeElevenLabsOutbound().originateCall)
//            WIRKLICH ueber den einzigen Netzzugriff dieses Wegs an den Anbieter
//            schickt - abgegriffen ueber eine Attrappen-fetch (globalThis.fetch
//            monkey-gepatcht, KEIN Netzzugriff, KEIN echter Anruf). FAKE_ORIGINATE_
//            ELEVENLABS scheidet hier aus: der Schalter ueberspringt den ganzen
//            Aufruf-Ausdruck inklusive dynamicVariables(...) (s. outbound.js
//            originateCall, ternary), es gaebe also nichts abzugreifen.
// Beide Mengen muessen deckungsgleich sein: ein Name in A ohne Gegenstueck in B ist der
// Close-1008-Fall; ein Name in B ohne Gegenstueck in A ist toter Ballast.
import assert from "node:assert/strict";
import test from "node:test";

import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";

import { consultAllowedForCall } from "../src/consult/gate.js";

import { sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";
// Seite A (die Extraktion aus dem Vorlagentext) liegt seit IEL-B6 in einem geteilten Helfer:
// die Init-Antwort des Inbound-Wegs wird gegen dieselbe Menge gehalten.
import { templatePlaceholderNames } from "./helpers/el-vorlage-variablen.mjs";

// Zwoelf seit Thema A+B (2026-08-19): {{opening_line}} kam als elfter Name dazu - die bei
// Auftragsannahme validierte Grund-Zeile, die {{objective}} im GESPROCHENEN Teil
// (first_message/voicemail_message) ersetzt, waehrend {{objective}} im Prompt bleibt -
// und {{lookup_available}} als zwoelfter (Torzustand der Recherche, Thema B).
// Dreizehn seit OC-P2: {{callee_relation}} kam als dreizehnter Name dazu - die
// Prompt-Sektion fuer den Fall, dass das Ziel die eigene hinterlegte Nummer des anrufenden
// Tenants ist; sie geht fuer JEDES andere Ziel als leerer String hinaus.
// Vierzehn seit DE1: {{voicemail_line}} kam als vierzehnter Name dazu - der GANZE
// Anrufbeantworter-Text, in der Sprache des Anrufs komponiert (der Text am Agenten
// laesst sich weder je Sprache noch je Anruf uebersteuern, 2026-09-04 gemessen).
// Fuenfzehn seit SEC-P4: tenant_token kam als fuenfzehnter Name dazu - die
// Mandanten-Dimension des Werkzeug-Tokens. Sie steht in KEINEM Text, sondern nur im
// Anfragekoerper der Werkzeuge; ohne die vierte Quelle (helpers/el-vorlage-variablen.mjs) waere sie hier unsichtbar
// gewesen und der Abgleich haette sie als toten Ballast gemeldet.
// Sechzehn seit IEL-B3: {{inbound_situation}} kam als sechzehnter Name dazu - die
// Prompt-Sektion fuer einen eingehenden Anruf am selben Agenten; sie geht fuer JEDEN
// ausgehenden Anruf als leerer String hinaus (Muster callee_relation).
const EXPECTED_VARIABLE_COUNT = 16;

// ---- Seite B: das ECHTE dynamic_variables-Objekt, per Attrappen-fetch abgegriffen -----
// Store, Config, Auftrag und der Abgriff liegen in helpers/elevenlabs-anrufstart-attrappe
// - GETEILT mit test/elevenlabs-torzustand.test.js, das denselben Anrufstart faehrt und
// den WERT einer dieser Variablen misst. Zwei eigene Attrappen wuerden gegeneinander
// driften, und dann hoerte genau eine der beiden Suiten still auf zu messen.
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
