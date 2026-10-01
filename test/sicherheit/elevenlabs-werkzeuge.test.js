import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ELEVENLABS_CONSULT_PATH } from "../../src/routes/webhooks-elevenlabs.js";
import { seedCall, seedState, startServer } from "../helpers.js";

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const TOOL_TOKEN = "sg-werkzeug-token-nur-fuer-elevenlabs";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const LONG_ENOUGH_S = 300;
const QUESTION = "Darf ich den Termin am Freitag zusagen?";
const RUNNING_FOR_SG06 = { id: "call_sg06_laeuft", conversation: "conv_sg06_laeuft" };
const RUNNING_FOR_SG11 = { id: "call_sg11_laeuft", conversation: "conv_sg11_laeuft" };
const ENDED = { id: "call_sg11_beendet", conversation: "conv_sg11_beendet" };
const INVENTED_CONVERSATION = "conv_sg11_erfunden";

const elevenLabsCall = ({ id, conversation }, status) =>
  seedCall({ id, status, maxDurationS: LONG_ENOUGH_S, elevenlabsConversationId: conversation });

const hermes = {};

before(async () => {
  hermes.srv = await startServer({
    env: {
      ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
      CONSULT_ENABLED: "true",
      ASSISTANT_CONTEXT_ENABLED: "true",
      IN_CALL_CONSULT_ENABLED: "true",
      CONSULT_WAIT_MS: "200",
      CONSULT_OPEN_MS: "1500",
      EL_CONSULT_DELIVERY_MS: "300",
      EL_CONSULT_ACK_MS: "300",
      EL_CONSULT_ANSWER_MS: "1200",
    },
    seed: seedState({
      calls: [
        elevenLabsCall(RUNNING_FOR_SG06, "active"),
        elevenLabsCall(RUNNING_FOR_SG11, "active"),
        elevenLabsCall(ENDED, "completed"),
      ],
    }),
  });
});

after(async () => {
  await hermes.srv?.stop();
});

function askOwner(conversationId, token) {
  return fetch(`${hermes.srv.localUrl}${ELEVENLABS_CONSULT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === undefined ? {} : { [TOOL_TOKEN_HEADER]: token }),
    },
    body: JSON.stringify({ conversation_id: conversationId, question: QUESTION }),
  });
}

function consultsAt({ id }) {
  const { calls } = hermes.srv.readStore();
  return calls.find((stored) => stored.id === id).consults?.length ?? 0;
}

test("SG-06 ElevenLabs-Webhook ohne gültiges Werkzeug-Token wird abgelehnt", async () => {
  const guesses = [undefined, "", "geratenes-token", `${TOOL_TOKEN}x`, TOOL_TOKEN.toUpperCase()];

  for (const guess of guesses) {
    const res = await askOwner(RUNNING_FOR_SG06.conversation, guess);
    assert.equal(res.status, HTTP_FORBIDDEN, `Token ${JSON.stringify(guess)}`);
  }
  assert.equal(consultsAt(RUNNING_FOR_SG06), 0);

  const genuine = await askOwner(RUNNING_FOR_SG06.conversation, TOOL_TOKEN);
  assert.equal(genuine.ok, true);
  assert.equal(consultsAt(RUNNING_FOR_SG06), 1);
});

test("SG-11 Werkzeug-Webhook ohne laufenden gebundenen Anruf wird abgelehnt", async () => {
  for (const conversation of [ENDED.conversation, INVENTED_CONVERSATION]) {
    const res = await askOwner(conversation, TOOL_TOKEN);
    assert.equal(res.status, HTTP_NOT_FOUND, conversation);
  }
  assert.equal(consultsAt(ENDED), 0);

  const bound = await askOwner(RUNNING_FOR_SG11.conversation, TOOL_TOKEN);
  assert.equal(bound.ok, true);
  assert.equal(consultsAt(RUNNING_FOR_SG11), 1);
});
