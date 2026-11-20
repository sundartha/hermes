import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { ELEVENLABS_TOOL_TOKEN_ERSTE_RUECKFRAGE } from "../gemeinsam/erfundene-geheimnisse.js";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const MAX_DURATION_S = 3600;
const ANSWERED_AGO_MS = 5000;
const JETZT_MS = Date.parse("2026-01-01T00:00:00.000Z");
const ERSTE_RUECKFRAGE = 1;
const PARALLELE_SERVER = 2;

const WEBHOOK_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: ELEVENLABS_TOOL_TOKEN_ERSTE_RUECKFRAGE,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
  EL_CONSULT_DELIVERY_MS: "400",
  EL_CONSULT_ACK_MS: "400",
  EL_CONSULT_ANSWER_MS: "1500",
});

const callId = (n) => `call_erste_${n}`;
const conversationId = (n) => `conv_erste_${n}`;

const outboundSeed = (n) =>
  seedState({
    calls: [
      seedCall({
        id: callId(n),
        direction: "outbound",
        status: "active",
        maxDurationS: MAX_DURATION_S,
        answeredAt: new Date(JETZT_MS - ANSWERED_AGO_MS).toISOString(),
        elevenlabsConversationId: conversationId(n),
      }),
    ],
  });

const consultCount = (srv, n) => {
  const call = srv.readStore().calls.find((c) => c.id === callId(n));
  return Array.isArray(call.consults) ? call.consults.length : 0;
};

async function ersteRueckfrage(srv, n) {
  try {
    const res = await abrufMitFrist(`${srv.localUrl}${CONSULT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [TOOL_TOKEN_HEADER]: ELEVENLABS_TOOL_TOKEN_ERSTE_RUECKFRAGE,
      },
      body: JSON.stringify({ conversation_id: conversationId(n), question: QUESTION }),
    });
    return { ok: res.ok, status: res.status, koerper: await res.text() };
  } catch (err) {
    return { ok: false, status: "keine Antwort", koerper: String(err) };
  }
}

const beschreibung = (antwort, srv, n) =>
  `Status ${antwort.status}, Koerper ${antwort.koerper}, consultCount ${consultCount(srv, n)}`;

test("erste-rueckfrage-zuverlaessig: die erste Rueckfrage eines laufenden Outbound-Anrufs wird angenommen und angelegt", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: JETZT_MS });
  const srv = await startServer({ env: WEBHOOK_ENV, seed: outboundSeed(0) });
  try {
    const antwort = await ersteRueckfrage(srv, 0);
    assert.ok(antwort.ok, `erste Rueckfrage muss 2xx liefern: ${beschreibung(antwort, srv, 0)}`);
    assert.equal(consultCount(srv, 0), ERSTE_RUECKFRAGE, beschreibung(antwort, srv, 0));
  } finally {
    await srv.stop();
  }
});

test("erste-rueckfrage-zuverlaessig: zwei gleichzeitig gestartete Server nehmen je ihre erste Rueckfrage an", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: JETZT_MS });
  const nummern = Array.from({ length: PARALLELE_SERVER }, (_, n) => n);
  const server = await Promise.all(
    nummern.map((n) => startServer({ env: WEBHOOK_ENV, seed: outboundSeed(n) })),
  );
  try {
    const antworten = await Promise.all(nummern.map((n) => ersteRueckfrage(server[n], n)));
    for (const n of nummern) {
      assert.ok(antworten[n].ok, `Server ${n}: ${beschreibung(antworten[n], server[n], n)}`);
      assert.equal(
        consultCount(server[n], n),
        ERSTE_RUECKFRAGE,
        `Server ${n}: ${beschreibung(antworten[n], server[n], n)}`,
      );
    }
  } finally {
    await Promise.all(server.map((srv) => srv.stop()));
  }
});
