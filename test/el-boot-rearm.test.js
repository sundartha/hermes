import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { seedCall, seedState, startServer, waitForStoreState } from "./helpers.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  ERROR_ENVELOPES,
} from "./fixtures/elevenlabs-conversations.js";

const CONVERSATION_PATH = "/v1/convai/conversations/";
const HTTP_OK = 200;
const CALL_ID = "call_boot_rearm";

const CONV_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;
const PROVIDER_SUMMARY = CONVERSATION_DONE_WITH_ANALYSIS.analysis.transcript_summary;

async function startResultMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url });
    if (!req.url.startsWith(CONVERSATION_PATH)) {
      res.writeHead(ERROR_ENVELOPES.notFound.httpStatus, { "content-type": "application/json" });
      return res.end(JSON.stringify(ERROR_ENVELOPES.notFound.body));
    }
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(CONVERSATION_DONE_WITH_ANALYSIS));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const ANSWERED_SECONDS_AGO = 5;
const ANSWERED_AT = new Date(Date.now() - ANSWERED_SECONDS_AGO * MS_PER_SECOND).toISOString();

function activeElCallSeed() {
  return seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        provider: "telnyx",
        status: "active",
        answeredAt: ANSWERED_AT,
        startedAt: ANSWERED_AT,
        maxDurationS: 3600,
        elevenlabsConversationId: CONV_ID,
      }),
    ],
  });
}

test("EL-BOOT-REARM: ein aktiver EL-Call mit conversation_id wird nach dem Boot fertiggestellt (Transkript+Zusammenfassung, Status verlaesst 'active')", async () => {
  const mock = await startResultMock();
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: mock.url, ELEVENLABS_API_KEY: "test-key" },
    seed: activeElCallSeed(),
  });
  try {
    const stand = await waitForStoreState(
      srv,
      (state) => state.calls.find((eintrag) => eintrag.id === CALL_ID)?.status !== "active",
    );
    const call = stand.calls.find((eintrag) => eintrag.id === CALL_ID);

    assert.ok(
      mock.requests.some((anfrage) => anfrage.url.includes(CONV_ID)),
      "der Anbieter wurde nach dem Boot ueberhaupt nach dem Ergebnis gefragt - ohne Re-Arm bleibt die Attrappe unberuehrt",
    );
    assert.notEqual(call.status, "active", "der Boot-Re-Arm muss den liegen gebliebenen Anruf terminalisieren");
    assert.equal(
      call.summary,
      PROVIDER_SUMMARY,
      "die ECHTE Zusammenfassung des Anbieters muss ankommen, nicht nur irgendein Status-Wechsel (Max-Dauer-Cap allein wuerde das NICHT liefern)",
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});
