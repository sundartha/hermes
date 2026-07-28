// AL-P8: netz- und spawn-freie Tests der Shim-Treiber-Bausteine (reine Funktionen +
// der lokale Telnyx-Fake gegen echtes node:http, aber ohne Server-Spawn/Anthropic-Call).
// Der Gate-Beweis end-to-end (403/200) steht getrennt in
// test/al-p8-bench-shim-gates.test.js (spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shimTurnRequest,
  completionSpeech,
  farewellScheduled,
  shimGateReasons,
} from "../scripts/convo-bench/driver-shim.mjs";
import { startTelnyxFake, callControlEventBody } from "../scripts/convo-bench/telnyx-fake.mjs";
import { eventEnvelope, parseSpeakEvent } from "../src/telephony/adapters/telnyx/speak-events.js";
import { parseCallControlEvent } from "../src/telephony/adapters/telnyx/call-control-events.js";
import { DRIVERS, DRIVER_IDS, DEFAULT_DRIVER_ID, scenarioSupportsDriver } from "../scripts/convo-bench/drivers.mjs";
import { TEXML_DRIVER_ID } from "../scripts/convo-bench/driver-texml.mjs";
import { SHIM_DRIVER_ID } from "../scripts/convo-bench/driver-shim.mjs";

test("AL-P8-13 shimTurnRequest setzt Bearer, extra_metadata.call_control_id und stream:true", () => {
  const req = shimTurnRequest({ baseUrl: "http://127.0.0.1:1234", secret: "s3cr3t", callControlId: "cc_1", text: "Hallo", model: "gpt-4o-mini" });
  assert.equal(req.url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(req.init.headers.authorization, "Bearer s3cr3t");
  const body = JSON.parse(req.init.body);
  assert.equal(body.stream, true);
  assert.equal(body.extra_metadata.call_control_id, "cc_1");
  assert.equal(body.messages[0].content, "Hallo");
});

test("AL-P8-14 shimTurnRequest baut den Bearer AUSSCHLIESSLICH aus dem uebergebenen secret", () => {
  const withRealSecret = shimTurnRequest({ baseUrl: "http://x", secret: "real", callControlId: "c", text: "t", model: "m" });
  const withWrongSecret = shimTurnRequest({ baseUrl: "http://x", secret: "wrong", callControlId: "c", text: "t", model: "m" });
  assert.equal(withRealSecret.init.headers.authorization, "Bearer real");
  assert.equal(withWrongSecret.init.headers.authorization, "Bearer wrong");
  assert.notEqual(withRealSecret.init.headers.authorization, withWrongSecret.init.headers.authorization);
});

test("AL-P8-15 completionSpeech konkateniert SSE-delta.content und ignoriert [DONE]", () => {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Hallo " } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Welt." } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
    `data: [DONE]\n\n`;
  const speech = completionSpeech(body, "text/event-stream");
  assert.equal(speech, "Hallo Welt.");
});

test("AL-P8-16 completionSpeech liest den stream:false-JSON-Modus", () => {
  const body = JSON.stringify({ object: "chat.completion", choices: [{ message: { role: "assistant", content: "Klartext-Antwort." } }] });
  const speech = completionSpeech(body, "application/json");
  assert.equal(speech, "Klartext-Antwort.");
});

test("AL-P8-17 farewellScheduled trifft nur die Zeile DIESES Calls", () => {
  const stdout =
    `[telnyx-shim] farewell_scheduled {"callId":"call_a","delayMs":500,"turnSeq":1}\n` +
    `[telnyx-shim] farewell_scheduled {"callId":"call_b","delayMs":700,"turnSeq":2}\n`;
  assert.equal(farewellScheduled(stdout, "call_a"), true);
  assert.equal(farewellScheduled(stdout, "call_b"), true);
  assert.equal(farewellScheduled(stdout, "call_c"), false);
});

test("AL-P8-18 shimGateReasons liefert die Gate-Gruende dieses Calls, nie Transkript oder Secret", () => {
  const stdout =
    `[telnyx-shim] gate {"reason":"loop_guard","callId":"call_a","turnSeq":3}\n` +
    `[telnyx-shim] gate {"reason":"budget_tenant","callId":"call_a","tenantId":"t1","turnSeq":4}\n` +
    `[telnyx-shim] gate {"reason":"call_unresolved","found":false,"status":null}\n` +
    `[telnyx-shim] gate {"reason":"rate_limited","callId":"call_b","turnSeq":1}\n`;
  const reasons = shimGateReasons(stdout, "call_a");
  assert.deepEqual(reasons, ["loop_guard", "budget_tenant"]);
  assert.deepEqual(shimGateReasons(stdout, "call_b"), ["rate_limited"]);
  assert.deepEqual(shimGateReasons(stdout, "call_unknown"), []);
});

test("AL-P8-19 callControlEventBody erzeugt die Telnyx-v2-Huelle, die parseCallControlEvent/parseSpeakEvent erwarten", () => {
  const answered = callControlEventBody({ eventType: "call.answered", callControlId: "cc_x" });
  assert.ok(eventEnvelope(answered));
  const parsedAnswered = parseCallControlEvent(answered);
  assert.equal(parsedAnswered.eventType, "answered");
  assert.equal(parsedAnswered.callControlId, "cc_x");

  const speakEnded = callControlEventBody({ eventType: "call.speak.ended", callControlId: "cc_x", status: "completed" });
  assert.equal(parseSpeakEvent(speakEnded).outcome, "ok");
  assert.equal(parseCallControlEvent(speakEnded).eventType, "speak_ended");

  const hangup = callControlEventBody({ eventType: "call.hangup", callControlId: "cc_x" });
  assert.equal(parseCallControlEvent(hangup).eventType, "hangup");
});

test("AL-P8-20 telnyx-fake protokolliert speak/ai_assistant_start/hangup je ccid und antwortet 404 auf unbekannte Pfade", async () => {
  const fake = await startTelnyxFake();
  try {
    const speakRes = await fetch(`${fake.url}/v2/calls/cc_1/actions/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "Hallo, hier spricht der Assistent." }),
    });
    assert.equal(speakRes.status, 200);
    assert.deepEqual(await speakRes.json(), { data: {} });

    await fetch(`${fake.url}/v2/calls/cc_1/actions/ai_assistant_start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistant: { id: "asst_x" } }),
    });
    await fetch(`${fake.url}/v2/calls/cc_1/actions/hangup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    assert.equal(fake.actions.length, 3);
    assert.deepEqual(fake.actions.map((a) => a.action), ["speak", "ai_assistant_start", "hangup"]);
    assert.equal(fake.actions[0].body.payload, "Hallo, hier spricht der Assistent.");

    const notFound = await fetch(`${fake.url}/v2/unknown/path`, { method: "POST" });
    assert.equal(notFound.status, 404);

    const speakAction = await fake.waitForAction({ callControlId: "cc_1", action: "speak" });
    assert.equal(speakAction.body.payload, "Hallo, hier spricht der Assistent.");
  } finally {
    await fake.close();
  }
});

test("AL-P8-21 DRIVER_IDS enthaelt texml und shim, Default ist shim", () => {
  assert.deepEqual(new Set(DRIVER_IDS), new Set([TEXML_DRIVER_ID, SHIM_DRIVER_ID]));
  assert.equal(DEFAULT_DRIVER_ID, SHIM_DRIVER_ID);
  assert.equal(DRIVERS[SHIM_DRIVER_ID].requiresProvider, "telnyx");
  assert.equal(DRIVERS[TEXML_DRIVER_ID].requiresProvider, null);
});

test("AL-P8-22 scenarioSupportsDriver: hold-warteschleife nur texml, alle anderen beide", () => {
  const holdWarteschleife = { drivers: ["texml"] };
  assert.equal(scenarioSupportsDriver(holdWarteschleife, "texml"), true);
  assert.equal(scenarioSupportsDriver(holdWarteschleife, "shim"), false);

  const ohneDriversFeld = {};
  assert.equal(scenarioSupportsDriver(ohneDriversFeld, "texml"), true);
  assert.equal(scenarioSupportsDriver(ohneDriversFeld, "shim"), true);
});
