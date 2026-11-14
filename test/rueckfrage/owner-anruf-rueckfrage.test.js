import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const WERKZEUG_GEHEIMNIS = "owner-anruf-rueckfrage-geheimnis";
const ERFOLG = 200;
const FRAGE = "Passt Donnerstag um 15 Uhr?";
const ANTWORT = "Donnerstag um 15 Uhr passt.";

const ENV = Object.freeze({
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_GEHEIMNIS,
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  EL_CONSULT_DELIVERY_MS: "1500",
  EL_CONSULT_ACK_MS: "600",
  EL_CONSULT_ANSWER_MS: "3000",
});

const jsonPost = (url, body, headers = {}) =>
  abrufMitFrist(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const anrufMit = (id, gespraech, calleeIsOwner) =>
  seedCall({
    id,
    direction: "outbound",
    status: "active",
    elevenlabsConversationId: gespraech,
    maxDurationS: 300,
    calleeIsOwner,
  });

async function rueckfrageBisZurAntwort(calleeIsOwner) {
  const id = `call_owner_rf_${calleeIsOwner}`;
  const gespraech = `conv_owner_rf_${calleeIsOwner}`;
  const srv = await startServer({ env: ENV, seed: seedState({ calls: [anrufMit(id, gespraech, calleeIsOwner)] }) });
  try {
    const gestellt = jsonPost(
      `${srv.localUrl}/webhooks/elevenlabs/consult`,
      { conversation_id: gespraech, question: FRAGE },
      { "x-hermes-tool-token": WERKZEUG_GEHEIMNIS },
    );
    const abgeholt = await abrufMitFrist(`${srv.localUrl}/api/calls/${id}/consult`);
    const ereignis = await abgeholt.json();
    const antwort = await jsonPost(`${srv.localUrl}/api/calls/${id}/consult/answer`, {
      event_id: ereignis.event_id ?? "c0",
      answers: [ANTWORT],
    });
    const webhookAntwort = await gestellt;
    return {
      abholStatus: abgeholt.status,
      ereignis,
      antwortStatus: antwort.status,
      webhookStatus: webhookAntwort.status,
      webhookKoerper: await webhookAntwort.json(),
    };
  } finally {
    await srv.stop();
  }
}

describe("Rueckfrage an Claude, auch wenn der Auftraggeber selbst abnimmt (#4395)", () => {
  for (const [name, calleeIsOwner] of [
    ["Anruf an die eigene Nummer", true],
    ["Anruf an einen Dritten", false],
  ]) {
    it(`${name}: die Antwort von Claude kommt als gesprochener Text im Webhook an`, async () => {
      const ergebnis = await rueckfrageBisZurAntwort(calleeIsOwner);

      assert.equal(ergebnis.abholStatus, ERFOLG);
      assert.deepEqual(ergebnis.ereignis.questions, [FRAGE]);
      assert.equal(ergebnis.antwortStatus, ERFOLG);
      assert.equal(ergebnis.webhookStatus, ERFOLG);
      assert.equal(ergebnis.webhookKoerper.answer, ANTWORT);
    });
  }
});
