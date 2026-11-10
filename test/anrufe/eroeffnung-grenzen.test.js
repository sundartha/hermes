import assert from "node:assert/strict";
import test from "node:test";

import { startOutboundCall } from "../../src/elevenlabs/convai.js";
import { pinCall, sendeAnrufstartKoerper } from "../helpers/elevenlabs-anrufstart-attrappe.mjs";

const { makeElevenLabsOutbound } = await import("../../src/elevenlabs/outbound.js");
const { consultAllowedForCall } = await import("../../src/consult/gate.js");

const FR_ZIEL = "+33612345678";
const KONTO = Object.freeze({ apiKey: "k", apiBase: "http://127.0.0.1:1" });
const GATE_MELDUNG = /Anrufstart abgebrochen \(call=c3\): dynamic_variables\.eroeffnung oder opening_line fehlt/;
const KI_ERSTSATZ = "Hallo, es geht um einen Termin – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.";

const datenFuer = async (abweichung) =>
  (await sendeAnrufstartKoerper({ makeElevenLabsOutbound, consultAllowedForCall, call: { ...pinCall(), ...abweichung } }))
    .conversation_initiation_client_data;

test("Eroeffnung: Anruf an den Besitzer traegt die Besitzer-Eroeffnung, die auch als erste Nachricht gesprochen wird", async () => {
  const daten = await datenFuer({ calleeIsOwner: true });
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Hallo Pin, hier ist dein KI-Assistent. Es geht um Folgendes: Termin vereinbaren. Wie sieht es damit aus?",
  );
  assert.equal(daten.conversation_config_override.agent.first_message, daten.dynamic_variables.eroeffnung);
});

test("Eroeffnung: weicht die Anrufsprache von der Offenlegungssprache ab, ist die Variable die gesprochene erste Nachricht", async () => {
  const daten = await datenFuer({ to: FR_ZIEL });
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Bonjour, ceci est un assistant IA mandaté par Pin Testowner. Cette conversation sera résumée pour mon mandant. Es geht um Folgendes: Termin vereinbaren.",
  );
  assert.equal(daten.conversation_config_override.agent.first_message, daten.dynamic_variables.eroeffnung);
});

test("Eroeffnung: nur der Schlusspunkt des Anlasses faellt weg, Punkte mitten im Anlass bleiben", async () => {
  const daten = await datenFuer({ goal: "Termin am 3. Mai klären..." });
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Hallo, es geht um Folgendes: Termin am 3. Mai klären – ich bin Hermes, der KI-Assistent von Pin Testowner, und ich fasse das Gespräch für Pin zusammen.",
  );
});

function gateStart(body, extra = {}) {
  let netzaufrufe = 0;
  const fetchImpl = async () => {
    netzaufrufe += 1;
    return { ok: true, status: 200, json: async () => ({ conversation_id: "conv_gate_3" }) };
  };
  const lauf = startOutboundCall({ fetchImpl, account: KONTO, body, callId: "c3", disclosureLanguage: "de", ...extra });
  return { lauf, netzaufrufe: () => netzaufrufe };
}

test("Eroeffnung-Gate: ohne uebergebene Variablen bricht der Anruf mit der Gate-Meldung ab", async () => {
  const { lauf, netzaufrufe } = gateStart({
    conversation_initiation_client_data: { conversation_config_override: { agent: { language: "de" } } },
  });
  await assert.rejects(lauf, GATE_MELDUNG);
  assert.equal(netzaufrufe(), 0);
});

test("Eroeffnung-Gate: mit Variablen und gleicher Sprache geht der Anruf raus", async () => {
  const { lauf, netzaufrufe } = gateStart({
    conversation_initiation_client_data: {
      dynamic_variables: { eroeffnung: KI_ERSTSATZ, opening_line: "es geht um einen Termin." },
      conversation_config_override: { agent: { language: "de" } },
    },
  });
  assert.equal((await lauf).conversationId, "conv_gate_3");
  assert.equal(netzaufrufe(), 1);
});

test("Eroeffnung-Gate: ohne Angabe zum Besitzer gilt der Angerufene als Dritter, auch bei Sprachabweichung", async () => {
  const { lauf, netzaufrufe } = gateStart(
    { conversation_initiation_client_data: { conversation_config_override: { agent: { language: "fr", first_message: "Bonjour." } } } },
    { calleeIsOwner: undefined },
  );
  await assert.rejects(lauf, /agent\.first_message enthaelt nicht den Offenlegungssatz/);
  assert.equal(netzaufrufe(), 0);
});
