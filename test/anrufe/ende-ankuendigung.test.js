import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const NUMMER = "+491713920012";
const ANBIETER_GRENZE_S = 600;
const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  OWNER_SELF_CALL_ENABLED: "true",
});

async function ausgehenderAnruf() {
  const srv = await startServer({
    env: { ...EL_WEG, OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    seed: seedState({
      settings: { language: "de" },
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, firstName: OWNER_TEST_FIRST_NAME, privateNumber: NUMMER },
      ],
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: NUMMER, objective: "Termin vereinbaren" }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    const { callId } = JSON.parse(antwort);
    const daten = await initInhaltFuer(srv, { callId });
    const anruf = srv.readStore().calls.find((eintrag) => eintrag.id === callId);
    return { daten, grenzeS: anruf.maxDurationS };
  } finally {
    await srv.stop();
  }
}

function vorlagenPrompt() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  return agent.prompt.prompt;
}

test("AK4-1: der Anrufstart nennt dem Agenten die Grenze des Anrufs in Sekunden (nach Kappung durch den Anbieter)", async () => {
  const { daten, grenzeS } = await ausgehenderAnruf();

  assert.ok(grenzeS > 0);
  assert.equal(daten.dynamic_variables.call_limit_s, String(Math.min(grenzeS, ANBIETER_GRENZE_S)));
});

test("AK4-2: der Prompt kuendigt das Ende vor der Grenze an und liest dafuer call_limit_s gegen die Gespraechsdauer des Anbieters", () => {
  const prompt = vorlagenPrompt();
  const abschnitt = prompt.split("\n\n").find((teil) => teil.startsWith("CALL TIME LIMIT:"));

  assert.ok(abschnitt, "Abschnitt CALL TIME LIMIT fehlt");
  assert.ok(abschnitt.includes("{{call_limit_s}}"));
  assert.ok(abschnitt.includes("{{system__call_duration_secs}}"));
  assert.match(abschnitt, /about 60 seconds/);
  assert.match(abschnitt, /follow CLOSING at once/);
  assert.ok(prompt.indexOf("CALL TIME LIMIT:") < prompt.indexOf("HOW YOU GET TO A RESULT:"));
});
