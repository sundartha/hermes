import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";

const WERKZEUG_GEHEIMNIS = "spur-am-server-geheimnis";
const ANRUF = "call_spur_am_server";
const GESPRAECH = "conv_spur_am_server";
const ERFOLG = 200;
const NICHT_ZUGESTELLT = "not_delivered";
const SPUR_ZEILE = new RegExp(`\\[audit\\] consult_timeout .*call=${ANRUF} `);

const RUECKFRAGE_MIT_KURZER_STAFFEL = Object.freeze({
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_GEHEIMNIS,
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  EL_CONSULT_DELIVERY_MS: "300",
  EL_CONSULT_ACK_MS: "300",
  EL_CONSULT_ANSWER_MS: "600",
});

const laufenderAnruf = () =>
  seedState({
    calls: [
      seedCall({
        id: ANRUF,
        direction: "outbound",
        status: "active",
        elevenlabsConversationId: GESPRAECH,
        maxDurationS: 300,
      }),
    ],
  });

test("eine nie zugestellte Rueckfrage endet am echten Server mit not_delivered und hinterlaesst die Abbruch-Spur im Audit", async () => {
  const srv = await startServer({ env: RUECKFRAGE_MIT_KURZER_STAFFEL, seed: laufenderAnruf() });
  try {
    const antwort = await fetch(`${srv.localUrl}/webhooks/elevenlabs/consult`, {
      method: "POST",
      headers: { "x-hermes-tool-token": WERKZEUG_GEHEIMNIS, "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: GESPRAECH, question: "Passt Donnerstag?" }),
    });

    assert.equal(antwort.status, ERFOLG);
    assert.equal((await antwort.json()).reason, NICHT_ZUGESTELLT);
    await waitForLog(srv, SPUR_ZEILE);
  } finally {
    await srv.stop();
  }
});
