import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pinCall, pinStore, sendeAnrufstartKoerper } from "../helpers/elevenlabs-anrufstart-attrappe.mjs";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
const { makeElevenLabsOutbound } = await import("../../src/elevenlabs/outbound.js");
const { consultAllowedForCall } = await import("../../src/consult/gate.js");

const ZIEL = { de: "+491737250000", fr: "+33612345678", en: "+447700900123" };
const ERWARTET = {
  de: "Hey, hier ist Hermes, dein KI-Assistent. Wie kann ich dir helfen?",
  en: "Hey, it's Hermes, your AI assistant. How can I help you?",
  fr: "Salut, c'est Hermes, ton assistant IA. Comment je peux t'aider ?",
};

async function koerper(sprache) {
  const call = { ...pinCall(), to: ZIEL[sprache], calleeIsOwner: true, goal: "Tisch fuer vier Personen reservieren" };
  const store = pinStore({ profil: { allowConsult: true } });
  return sendeAnrufstartKoerper({ makeElevenLabsOutbound, consultAllowedForCall, store, call });
}

describe("4065-1: Anruf an den Besitzer beginnt kurz", () => {
  for (const sprache of Object.keys(ZIEL)) {
    it(`first_message ist Begruessung plus eine Frage, ohne Anlass-Zeile (${sprache})`, async () => {
      const rumpf = (await koerper(sprache)).conversation_initiation_client_data;
      const text = rumpf.conversation_config_override.agent.first_message;
      assert.equal(text, ERWARTET[sprache]);
      assert.equal(text.split("?").length - 1, 1);
      assert.equal(rumpf.dynamic_variables.eroeffnung, ERWARTET[sprache]);
    });
  }
});
