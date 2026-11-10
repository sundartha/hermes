import assert from "node:assert/strict";
import test from "node:test";

import { EL_INBOUND_ACCESS_BOOT_ENV, OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { elInboundInitSpawnEnv, initBindungsKoerper, spawnSeedWartenderElCall } from "../_iel-inbound-harness.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const INIT_PFAD = "/webhooks/elevenlabs/init";
const INIT_TOKEN_KOPF = "x-hermes-init-token";
const AGENT_ID = "agent_3735_besitzer";
const BINDUNG = "0".repeat(32);

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_3735",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_3735",
  ELEVENLABS_API_KEY: "el-3735-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  OWNER_SELF_CALL_ENABLED: "true",
});

const FAELLE = [
  {
    sprache: "de",
    nummer: "+491713920012",
    auftrag: "Termin vereinbaren",
    kopf: "Hey, hier ist Hermes, dein KI-Assistent.",
    frage: "Wie kann ich dir helfen?",
    anlass: "Es geht um Folgendes: Termin vereinbaren. Wie sieht es damit aus?",
    drittSatz:
      "Hallo, es geht um Folgendes: Termin vereinbaren – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.",
  },
  {
    sprache: "en",
    nummer: "+447700900123",
    auftrag: "arrange an appointment",
    kopf: "Hey, it's Hermes, your AI assistant.",
    frage: "How can I help you?",
    anlass: "Here's what I'm calling about: arrange an appointment. How does that look on your side?",
    drittSatz:
      "Hello, here's what I'm calling about: arrange an appointment – I am Hermes, the AI assistant of Jonas Beispiel, and I will summarise this conversation for Jonas.",
  },
  {
    sprache: "fr",
    nummer: "+33612345678",
    auftrag: "prendre rendez-vous",
    kopf: "Salut, c'est Hermes, ton assistant IA.",
    frage: "Comment je peux t'aider ?",
    anlass: "Voici l'objet de mon appel : prendre rendez-vous. Qu'en est-il ?",
    drittSatz:
      "Bonjour, voici l'objet de mon appel : prendre rendez-vous – je suis Hermes, l'assistant IA de Jonas Beispiel, et je résume cette conversation pour Jonas.",
  },
];

async function ausgehenderAnruf({ sprache, nummer, auftrag }, allowlist) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url, OWNER_SELF_CALL_TENANT_IDS: allowlist },
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
    assert.equal(res.status, HTTP_OK, await res.text());
    const [start] = anbieter.starts();
    return start.body.conversation_initiation_client_data;
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

async function eingehenderAnruf({ sprache, callerIsOwner }) {
  const seed = spawnSeedWartenderElCall({ callId: "call_3735_in", bindungsToken: BINDUNG, answeredVorS: 2 });
  seed.calls[0].language = sprache;
  seed.calls[0].callerIsOwner = callerIsOwner;
  seed.tenants = [
    { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, firstName: OWNER_TEST_FIRST_NAME },
  ];
  const srv = await startServer({ env: elInboundInitSpawnEnv(AGENT_ID), seed });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}${INIT_PFAD}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INIT_TOKEN_KOPF]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN,
      },
      body: JSON.stringify(initBindungsKoerper({ bindung: BINDUNG, agentId: AGENT_ID, conversationId: "conv_3735" })),
    });
    const text = await res.text();
    assert.equal(res.status, HTTP_OK, text);
    const { agent } = JSON.parse(text).conversation_config_override;
    return agent.first_message;
  } finally {
    await srv.stop();
  }
}

for (const fall of FAELLE) {
  test(`Besitzer-Anruf ausgehend (${fall.sprache}): Hermes mit KI-Kennzeichnung, dann der Anlass, ohne Offenlegungs- und Transkriptions-Hinweis`, async () => {
    const daten = await ausgehenderAnruf(fall, BOOTSTRAP_TENANT_ID);
    const erster = daten.conversation_config_override.agent.first_message;
    assert.equal(erster, `${fall.kopf} ${fall.anlass}`);
    assert.equal(daten.dynamic_variables.eroeffnung, erster);
  });

  test(`Besitzer-Anruf ausgehend (${fall.sprache}): ohne Eintrag auf der Allowlist gilt der volle Dritt-Satz`, async () => {
    const daten = await ausgehenderAnruf(fall, "t_fremd");
    assert.equal(daten.conversation_config_override.agent.first_message, undefined);
    assert.equal(daten.dynamic_variables.eroeffnung, fall.drittSatz);
  });

  test(`Besitzer-Anruf eingehend (${fall.sprache}): Hermes, KI-Kennzeichnung und Frage, kein Transkriptions-Hinweis`, async () => {
    const erster = await eingehenderAnruf({ sprache: fall.sprache, callerIsOwner: true });
    assert.equal(erster, `${fall.kopf} ${fall.frage}`);
  });
}

test("Fremder Anrufer eingehend: der Hinweis auf Transkription und Zusammenfassung bleibt Pflicht", async () => {
  const erster = await eingehenderAnruf({ sprache: "de", callerIsOwner: false });
  assert.equal(
    erster,
    "Hallo, hier ist der KI-Assistent von Jonas Beispiel. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?",
  );
});
