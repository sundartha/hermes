import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, TELNYX_TEST_OWNER_NUMBER, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { ANTHROPIC_SCHLUESSEL_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { starteAttrappe } from "./attrappen-server.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_3735",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_3735",
  ELEVENLABS_API_KEY: "el-3735-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const FAELLE = [
  {
    sprache: "de",
    ziel: "+4915112345678",
    auftrag: "Termin vereinbaren",
    anlass: "es geht um Folgendes: Termin vereinbaren.",
    mitVorname:
      "Hallo, es geht um Folgendes: Termin vereinbaren – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.",
    ohneVorname:
      "Hallo, es geht um Folgendes: Termin vereinbaren – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für meinen Auftraggeber zusammen.",
  },
  {
    sprache: "en",
    ziel: "+447700900123",
    auftrag: "arrange an appointment",
    anlass: "here's what I'm calling about: arrange an appointment.",
    mitVorname:
      "Hello, here's what I'm calling about: arrange an appointment – I am Hermes, the AI assistant of Jonas Beispiel, and I will summarise this conversation for Jonas.",
    ohneVorname:
      "Hello, here's what I'm calling about: arrange an appointment – I am Hermes, the AI assistant of Jonas Beispiel, and I will summarise this conversation for the person I represent.",
  },
  {
    sprache: "fr",
    ziel: "+33612345678",
    auftrag: "prendre rendez-vous",
    anlass: "voici l'objet de mon appel : prendre rendez-vous.",
    mitVorname:
      "Bonjour, voici l'objet de mon appel : prendre rendez-vous – je suis Hermes, l'assistant IA de Jonas Beispiel, et je résume cette conversation pour Jonas.",
    ohneVorname:
      "Bonjour, voici l'objet de mon appel : prendre rendez-vous – je suis Hermes, l'assistant IA de Jonas Beispiel, et je résume cette conversation pour mon mandant.",
  },
];

async function anrufstart({ sprache, ziel, auftrag }, firstName) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url },
    seed: seedState({
      settings: { language: sprache },
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, ...(firstName ? { firstName } : {}) }],
    }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ziel, objective: auftrag }),
    });
    assert.equal(res.status, HTTP_OK, await res.text());
    assert.equal(anbieter.starts().length, 1);
    const [start] = anbieter.starts();
    return start.body.conversation_initiation_client_data;
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

for (const fall of FAELLE) {
  test(`Eroeffnung an Dritte (${fall.sprache}): Anlass, Hermes mit Auftraggeber, Zusammenfassung fuer den Vornamen`, async () => {
    const daten = await anrufstart(fall, "");
    assert.equal(daten.dynamic_variables.eroeffnung, fall.mitVorname);
    assert.equal(daten.dynamic_variables.opening_line, fall.anlass);
    assert.equal(daten.conversation_config_override.agent.first_message, undefined);
  });

  test(`Eroeffnung an Dritte (${fall.sprache}): ein Vorname mit Platzhalter wird nicht gesprochen, der Satz faellt auf den Auftraggeber zurueck`, async () => {
    const daten = await anrufstart(fall, "{{x}}");
    assert.equal(daten.dynamic_variables.eroeffnung, fall.ohneVorname);
  });
}

test("Eroeffnung an Dritte: mehrere Schlusszeichen des Anlasses werden vor dem Gedankenstrich alle entfernt", async () => {
  const daten = await anrufstart({ sprache: "de", ziel: "+4915112345678", auftrag: "Termin vereinbaren!!" }, "");
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Hallo, es geht um Folgendes: Termin vereinbaren – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.",
  );
});

async function starteSprachmodellAttrappe(zeile) {
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_3735",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "tool_use", id: "tu_3735", name: "eroeffnungszeile", input: { reason: zeile } }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 60, output_tokens: 25 },
        }),
      );
    });
  });
}

test("Eroeffnung an Dritte: eine vom Sprachmodell erzeugte Anlasszeile mit zwei Schlusspunkten verliert beide vor dem Gedankenstrich", async () => {
  const modell = await starteSprachmodellAttrappe("Ich rufe an, um einen Termin zu vereinbaren..");
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: {
      ...EL_WEG,
      ELEVENLABS_API_BASE: anbieter.url,
      ELEVENLABS_OPENING_LINE_LLM_ENABLED: "true",
      ANTHROPIC_BASE_URL: modell.url,
      ANTHROPIC_API_KEY: ANTHROPIC_SCHLUESSEL_BEISPIEL,
      LLM_BREAKER_THRESHOLD: "100",
    },
    seed: seedState({
      settings: { language: "de" },
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, firstName: "" }],
    }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "+4915112345678", objective: "Termin vereinbaren" }),
    });
    assert.equal(res.status, HTTP_OK, await res.text());
    const [start] = anbieter.starts();
    const { dynamic_variables: variablen } = start.body.conversation_initiation_client_data;
    assert.equal(
      variablen.eroeffnung,
      "Hallo, ich rufe an, um einen Termin zu vereinbaren – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.",
    );
  } finally {
    await srv.stop();
    await anbieter.schliessen();
    await modell.close();
  }
});
