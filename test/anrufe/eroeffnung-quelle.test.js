import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, TELNYX_TEST_OWNER_NUMBER, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { ANTHROPIC_SCHLUESSEL_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { starteAttrappe } from "./attrappen-server.js";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const FAELLE = [
  {
    sprache: "de",
    ziel: "+4915112345678",
    auftrag: "Termin vereinbaren",
    anlass: "es geht um Folgendes: Termin vereinbaren.",
    anschluss: "Es geht um Folgendes: Termin vereinbaren. Bitte sprechen Sie.",
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
    anschluss: "Here's what I'm calling about: arrange an appointment. Please go ahead.",
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
    anschluss: "Voici l'objet de mon appel : prendre rendez-vous. Je vous écoute.",
    mitVorname:
      "Bonjour, voici l'objet de mon appel : prendre rendez-vous – je suis Hermes, l'assistant IA de Jonas Beispiel, et je résume cette conversation pour Jonas.",
    ohneVorname:
      "Bonjour, voici l'objet de mon appel : prendre rendez-vous – je suis Hermes, l'assistant IA de Jonas Beispiel, et je résume cette conversation pour mon mandant.",
  },
];

async function anrufstart({ sprache, ziel, auftrag }, firstName) {
  const srv = await startServer({
    env: { ...EL_WEG },
    seed: seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, ...(firstName ? { firstName } : {}) }],
    }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ziel, objective: auftrag, language: sprache }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    assert.ok(srv.vorspannAttrappe.pfade.includes("/v2/calls"));
    return await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
  } finally {
    await srv.stop();
  }
}

for (const fall of FAELLE) {
  test(`Eroeffnung an Dritte (${fall.sprache}): Anlass, Hermes mit Auftraggeber, Zusammenfassung fuer den Vornamen`, async () => {
    const daten = await anrufstart(fall, "");
    assert.equal(daten.dynamic_variables.eroeffnung_gesagt, fall.mitVorname);
    assert.equal(daten.dynamic_variables.opening_line, fall.anlass);
    assert.equal(daten.conversation_config_override.agent.first_message, fall.anschluss);
  });

  test(`Eroeffnung an Dritte (${fall.sprache}): ein Vorname mit Platzhalter wird nicht gesprochen, der Satz faellt auf den Auftraggeber zurueck`, async () => {
    const daten = await anrufstart(fall, "{{x}}");
    assert.equal(daten.dynamic_variables.eroeffnung_gesagt, fall.ohneVorname);
  });
}

test("Eroeffnung an Dritte: mehrere Schlusszeichen des Anlasses werden vor dem Gedankenstrich alle entfernt", async () => {
  const daten = await anrufstart({ sprache: "de", ziel: "+4915112345678", auftrag: "Termin vereinbaren!!" }, "");
  assert.equal(
    daten.dynamic_variables.eroeffnung_gesagt,
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
  const srv = await startServer({
    env: {
      ...EL_WEG,
      ELEVENLABS_OPENING_LINE_LLM_ENABLED: "true",
      ANTHROPIC_BASE_URL: modell.url,
      ANTHROPIC_API_KEY: ANTHROPIC_SCHLUESSEL_BEISPIEL,
      LLM_BREAKER_THRESHOLD: "100",
    },
    seed: seedState({
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
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    const { dynamic_variables: variablen } = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
    assert.equal(
      variablen.eroeffnung_gesagt,
      "Hallo, ich rufe an, um einen Termin zu vereinbaren – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.",
    );
  } finally {
    await srv.stop();
    await modell.close();
  }
});
