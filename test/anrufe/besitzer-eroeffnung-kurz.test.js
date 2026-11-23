import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  OWNER_SELF_CALL_ENABLED: "true",
});

const FAELLE = [
  { sprache: "de", nummer: "+491713920012", auftrag: "Termin vereinbaren", erwartet: "Hey, hier ist Hermes, dein KI-Assistent. Es geht um Folgendes: Termin vereinbaren." },
  { sprache: "en", nummer: "+447700900123", auftrag: "arrange an appointment", erwartet: "Hey, it's Hermes, your AI assistant. Here's what I'm calling about: arrange an appointment." },
  { sprache: "fr", nummer: "+33612345678", auftrag: "prendre rendez-vous", erwartet: "Salut, c'est Hermes, ton assistant IA. Voici l'objet de mon appel : prendre rendez-vous." },
];

async function ausgehenderAnruf({ sprache, nummer, auftrag }) {
  const srv = await startServer({
    env: { ...EL_WEG, OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    seed: seedState({
      settings: { language: sprache },
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, firstName: OWNER_TEST_FIRST_NAME, privateNumber: nummer },
      ],
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: nummer, objective: auftrag }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    const { callId } = JSON.parse(antwort);
    return await initInhaltFuer(srv, { callId });
  } finally {
    await srv.stop();
  }
}

for (const fall of FAELLE) {
  test(`4065-1: Anruf an den Besitzer beginnt mit Begruessung und einer einzigen Frage (${fall.sprache})`, async () => {
    const daten = await ausgehenderAnruf(fall);
    const erster = daten.dynamic_variables.eroeffnung_gesagt;
    assert.match(daten.conversation_config_override.agent.first_message, /\. (Bitte sprechen Sie|Please go ahead|Je vous écoute)\.$/);
    assert.equal(erster, fall.erwartet);
    assert.equal(erster.includes("?"), false);
    assert.equal(daten.dynamic_variables.eroeffnung, "");
  });
}
