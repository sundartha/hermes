import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const MAX_WOERTER_BEGRUESSUNG = 8;

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_4394",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_4394",
  ELEVENLABS_API_KEY: "el-4394-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  OWNER_SELF_CALL_ENABLED: "true",
});

const FAELLE = [
  {
    sprache: "de",
    nummer: "+491713920012",
    auftrag: "Ich möchte dir die Ergebnisse der Analyse sagen.",
    begruessung: "Hey, hier ist Hermes, dein KI-Assistent.",
    erwartet: "Hey, hier ist Hermes, dein KI-Assistent. Ich möchte dir die Ergebnisse der Analyse sagen.",
  },
  {
    sprache: "de",
    nummer: "+491713920012",
    auftrag: "Ergebnisse der Analyse mitteilen",
    begruessung: "Hey, hier ist Hermes, dein KI-Assistent.",
    erwartet: "Hey, hier ist Hermes, dein KI-Assistent. Es geht um Folgendes: Ergebnisse der Analyse mitteilen.",
  },
  {
    sprache: "en",
    nummer: "+447700900123",
    auftrag: "I want to tell you the results of the analysis.",
    begruessung: "Hey, it's Hermes, your AI assistant.",
    erwartet: "Hey, it's Hermes, your AI assistant. I want to tell you the results of the analysis.",
  },
  {
    sprache: "fr",
    nummer: "+33612345678",
    auftrag: "je voudrais te dire les résultats de l'analyse.",
    begruessung: "Salut, c'est Hermes, ton assistant IA.",
    erwartet: "Salut, c'est Hermes, ton assistant IA. je voudrais te dire les résultats de l'analyse.",
  },
];

async function ausgehenderAnruf({ sprache, nummer, auftrag, vorname = OWNER_TEST_FIRST_NAME }) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url, OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    seed: seedState({
      settings: { language: sprache },
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, firstName: vorname, privateNumber: nummer },
      ],
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: nummer, objective: auftrag }),
    });
    assert.equal(res.status, HTTP_OK, await res.text());
    const [start] = anbieter.starts();
    return start.body.conversation_initiation_client_data;
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

for (const fall of FAELLE) {
  test(`4394-1: Anruf mit Auftrag an den Besitzer gibt kurze Begruessung und den Anlass, ohne Frage (${fall.sprache}: ${fall.auftrag})`, async () => {
    const daten = await ausgehenderAnruf(fall);
    const erster = daten.conversation_config_override.agent.first_message;
    assert.equal(erster, fall.erwartet);
    assert.equal(erster.includes("?"), false);
    assert.equal(daten.dynamic_variables.eroeffnung, erster);
  });
}

test("4394-2: die Begruessung vor dem Anlass ist hoechstens acht Woerter lang und nennt die KI", async () => {
  const [fall] = FAELLE;
  const daten = await ausgehenderAnruf(fall);
  const erster = daten.conversation_config_override.agent.first_message;
  assert.ok(erster.startsWith(`${fall.begruessung} `));
  assert.ok(fall.begruessung.split(/\s+/).length <= MAX_WOERTER_BEGRUESSUNG);
  assert.ok(fall.begruessung.includes("KI-Assistent"));
});

test("4394-3: ohne Vornamen entfaellt die Besitzer-Begruessung, der Anruf bleibt bei der Offenlegung", async () => {
  const [fall] = FAELLE;
  const daten = await ausgehenderAnruf({ ...fall, vorname: "{{vorname}}" });
  const erster = daten.conversation_config_override.agent.first_message ?? daten.dynamic_variables.eroeffnung;
  assert.equal(erster.startsWith("Hey"), false);
  assert.ok(erster.includes("KI-Assistent"), erster);
});
