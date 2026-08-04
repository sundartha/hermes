// GQ-P4: Teil A (telnyx-llm-shim.js + llm.js) - stummes Scheitern beenden.
// A1: Bezahl-/Guthaben-Fall als EIGENER Zustand erkennen (402 UND der Anthropic-400-Fall),
// mit eigenem Alarm-Kanal (A4). A2: N konsekutive Turn-Fehlschlaege -> hoerbarer,
// hoeflicher Abschied statt stummem Weiterlaufen. A3: MESSPUNKT - welcher der drei
// Sendewege lief und wie viele Zeichen ihn wirklich verlassen haben.
// Fake-Harness (kein Netz/Spawn, P12), Muster aus test/telnyx-llm-shim.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fakeRes,
  fakeStore,
  makeCall,
  makeHandler,
  validReq,
  sseContent,
  sseEndsWithDone,
  jsonCompletion,
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import { localeFor } from "../src/i18n/locales.js";

// Erfasst alle drei Console-Kanaele, restauriert immer (F.I.R.S.T.) - Muster aus
// test/telnyx-llm-shim.test.js (OBS-1-Block).
async function withConsoleCapture(run) {
  const lines = [];
  const orig = { warn: console.warn, log: console.log, error: console.error };
  const grab = (...a) => lines.push(a.map(String).join(" "));
  console.warn = grab;
  console.log = grab;
  console.error = grab;
  try {
    await run();
  } finally {
    Object.assign(console, orig);
  }
  return lines;
}

// Spy-Watchdog: zeichnet scheduleFarewellHangup-Aufrufe auf, sonst No-op (Muster
// test/helpers.js noopWatchdog). Fuer A2-Tests, die den Abschied-Aufruf selbst pruefen,
// nicht den realen Hangup (der ist Domaene von test/telnyx-shim-endcall.test.js).
function watchdogSpy() {
  const farewellCalls = [];
  return {
    farewellCalls,
    arm() {},
    observeTurn: () => ({ loopExceeded: false, turnSeq: 0 }),
    clear() {},
    scheduleFarewellHangup(callId, opts) {
      farewellCalls.push({ callId, ...opts });
      return { delayMs: 1234 };
    },
  };
}

function throwingAgentTurn(err) {
  return async () => {
    throw err;
  };
}

function okAgentTurn(speech = "Alles gut") {
  return async () => ({ speech, endCall: false });
}

// Wie fakeRes(), aber der ZWEITE write()-Aufruf wirft (der erste - der role-Delta-Chunk
// der SSE-Sequenz - schlaegt durch, headersSent kippt wie im echten Express). Bildet einen
// Socket nach, der mitten im Happy-Path-Schreiben wegbricht (Muster T1,
// test/telnyx-shim-endcall.test.js), NICHT einen Socket, der von Anfang an tot ist.
function resFailingOnSecondWrite() {
  const res = fakeRes();
  const originalWrite = res.write.bind(res);
  let writeCalls = 0;
  res.write = (s) => {
    writeCalls += 1;
    if (writeCalls === 1) return originalWrite(s);
    throw new Error("socket kaputt");
  };
  return res;
}

const anthropicCreditError = () =>
  Object.assign(new Error("400 Your credit balance is too low to access the Anthropic API. Please upgrade."), {
    status: 400,
    type: "invalid_request_error",
  });

const anthropicFormError = () =>
  Object.assign(new Error("400 messages: roles must alternate between \"user\" and \"assistant\"..."), {
    status: 400,
    type: "invalid_request_error",
  });

const telnyx402Error = () => Object.assign(new Error("payment required"), { status: 402 });

// === A1/A4: Bezahl-/Guthaben-Fall -> eigener Alarm-Kanal ===

test("GQ-P4/A1 Guthaben-Fehler als 402 verpackt -> ALARM_LLM_BILLING mit Handlungsanweisung", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn(telnyx402Error()) });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(validReq(makeCall()), res));

  const alarms = lines.filter((l) => l.includes("[telnyx-shim] ALARM_LLM_BILLING"));
  assert.equal(alarms.length, 1);
  assert.ok(alarms[0].includes('"callId":"call_x"'));
  assert.ok(alarms[0].includes("handlung"));
  assert.ok(!lines.join("\n").includes("shim-secret"), "kein Secret im Log");
  assert.ok(sseEndsWithDone(res));
});

test("GQ-P4/A1 Guthaben-Fehler als 400 verpackt (Anthropic) -> derselbe Zustand", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn(anthropicCreditError()) });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(validReq(makeCall()), res));

  const alarms = lines.filter((l) => l.includes("[telnyx-shim] ALARM_LLM_BILLING"));
  assert.equal(alarms.length, 1, "der 400-Guthaben-Fall wird jetzt erkannt (bisher verschluckt)");
  assert.ok(alarms[0].includes('"callId":"call_x"'));
});

test("GQ-P4/A1 Gegenbeispiel: beliebiger 400-Formfehler loest KEINEN Billing-Alarm aus", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn(anthropicFormError()) });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(validReq(makeCall()), res));

  const alarms = lines.filter((l) => l.includes("ALARM_LLM_BILLING"));
  assert.equal(alarms.length, 0);
  assert.ok(sseEndsWithDone(res), "weiterhin gueltige Degradation");
});

// === A2: konsekutive Fehlschlaege -> Abschied ===

test("GQ-P4/A2 ein einzelner Fehlschlag zwischen zwei erfolgreichen Turns beendet NICHT", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxMaxConsecutiveFailedTurns: 2 });
  const watchdog = watchdogSpy();

  let turnCount = 0;
  const sequence = ["ok", "fail", "ok", "fail"];
  const agentTurn = async () => {
    const kind = sequence[turnCount++];
    if (kind === "fail") throw new Error("kaputt");
    return { speech: "Alles gut", endCall: false };
  };

  const handler = makeHandler({ store, config, agentTurn, watchdog });
  const lines = [];
  for (let i = 0; i < sequence.length; i++) {
    const res = fakeRes();
    // eslint-disable-next-line no-await-in-loop -- Turns sind sequenziell, nicht parallel
    lines.push(...(await withConsoleCapture(() => handler(validReq(call), res))));
  }

  assert.equal(watchdog.farewellCalls.length, 0, "der Zaehler wurde bei jedem Erfolg zurueckgesetzt");
  assert.ok(!lines.join("\n").includes("farewell_scheduled"));
  const degradedLines = lines.filter((l) => l.includes("[telnyx-shim] degraded"));
  assert.equal(degradedLines.length, 2);
  for (const l of degradedLines) assert.ok(l.includes('"giveUp":false'));
});

test("GQ-P4/A2 N Fehlschlaege in Folge -> Abschiedssatz UND Ende", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxMaxConsecutiveFailedTurns: 2 });
  const watchdog = watchdogSpy();
  const agentTurn = async () => {
    throw new Error("kaputt");
  };
  const handler = makeHandler({ store, config, agentTurn, watchdog });

  const res1 = fakeRes();
  await withConsoleCapture(() => handler(validReq(call), res1));
  const res2 = fakeRes();
  const lines2 = await withConsoleCapture(() => handler(validReq(call), res2));

  const farewell = localeFor("de").llmGiveUpFarewell;
  assert.equal(sseContent(res2), farewell);
  assert.equal(watchdog.farewellCalls.length, 1);
  assert.equal(watchdog.farewellCalls[0].speechChars, farewell.length);
  assert.equal(watchdog.farewellCalls[0].language, "de");
  assert.ok(lines2.some((l) => l.includes("[telnyx-shim] farewell_scheduled")));
});

test("GQ-P4/A2 Config-Satz ueberschreibt den Locale-Default", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({
    telnyxMaxConsecutiveFailedTurns: 1,
    telnyxFailedTurnFarewellText: "Ich muss leider auflegen.",
  });
  const watchdog = watchdogSpy();
  const agentTurn = async () => {
    throw new Error("kaputt");
  };
  const handler = makeHandler({ store, config, agentTurn, watchdog });
  const res = fakeRes();

  await withConsoleCapture(() => handler(validReq(call), res));

  assert.equal(sseContent(res), "Ich muss leider auflegen.");
});

test("GQ-P4/A2 Gegenbeweis: der Zaehler zaehlt nur echte agentTurn-Fehlschlaege", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxMaxConsecutiveFailedTurns: 2 });
  const watchdog = watchdogSpy();
  const agentTurn = async () => ({ speech: "Antwort", endCall: false });
  const handler = makeHandler({ store, config, agentTurn, watchdog });

  // T1-Szenario: agentTurn liefert erfolgreich, aber der Socket bricht mitten im Schreiben
  // weg (writeCompletion selbst wirft, NICHT agentTurn).
  const res = resFailingOnSecondWrite();

  const lines = await withConsoleCapture(() => handler(validReq(call), res));

  assert.equal(watchdog.farewellCalls.length, 0);
  const degradedLines = lines.filter((l) => l.includes("[telnyx-shim] degraded"));
  assert.equal(degradedLines.length, 1);
  assert.ok(degradedLines[0].includes('"failedTurns":0'));
});

// === A3: Sendepfad-Messung ===

test("GQ-P4/A3 MESSUNG: im Fehlerfall geht eine gueltige Completion mit Text hinaus", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const configNoStream = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: false });
  const agentTurn = async () => {
    throw new Error("kaputt");
  };

  const handlerNoStream = makeHandler({ store, config: configNoStream, agentTurn });
  const res1 = fakeRes();
  // stream:false -> JSON-Completion (Bestandsdispatch); der offene AL-P7-Draht existiert
  // hier ohnehin nicht (shimTokenStreaming aus).
  const lines1 = await withConsoleCapture(() => handlerNoStream(validReq(call, { stream: false }), res1));
  const degraded1 = lines1.find((l) => l.includes("[telnyx-shim] degraded"));
  const expected = localeFor("de").turnErrorSpeech;
  assert.ok(degraded1.includes('"path":"fresh_completion"'));
  assert.ok(degraded1.includes(`"chars":${expected.length}`));
  assert.ok(degraded1.includes('"streamChunks":0'));
  assert.equal(jsonCompletion(res1).choices[0].message.content, expected);

  const configStream = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });
  const handlerStream = makeHandler({ store, config: configStream, agentTurn });
  const res2 = fakeRes();
  const lines2 = await withConsoleCapture(() => handlerStream(validReq(call), res2));
  const degraded2 = lines2.find((l) => l.includes("[telnyx-shim] degraded"));
  assert.ok(degraded2.includes('"path":"stream_tail"'));
  assert.ok(sseContent(res2).endsWith(expected));
});

test("GQ-P4/A3 wire_lost meldet ehrlich null Zeichen", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: false });
  const agentTurn = async () => {
    throw new Error("kaputt");
  };
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  res.headersSent = true; // Strom bereits abgeschlossen/gerissen VOR dem Catch

  const lines = await withConsoleCapture(() => handler(validReq(call), res));

  const degraded = lines.find((l) => l.includes("[telnyx-shim] degraded"));
  assert.ok(degraded.includes('"path":"wire_lost"'));
  assert.ok(degraded.includes('"chars":0'));
});

// === PII-Freiheit der neuen Kanaele ===

test("GQ-P4 kein Wortlaut, keine Rufnummer, kein Secret in den neuen Zeilen", async () => {
  const SENTINEL_TRANSCRIPT = "SENTINEL_TRANSCRIPT_ich-bin-privat";
  const SENTINEL_PHONE = "+491700000099";
  const SENTINEL_SECRET = "SENTINEL_SECRET_gqp4";
  const call = makeCall({ from: SENTINEL_PHONE });
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({
    telnyxShimSharedSecret: SENTINEL_SECRET,
    telnyxMaxConsecutiveFailedTurns: 1,
  });
  const agentTurn = async () => {
    throw anthropicCreditError();
  };
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  const req = validReq(call, { messages: [{ role: "user", content: SENTINEL_TRANSCRIPT }] });
  req.headers.authorization = `Bearer ${SENTINEL_SECRET}`;

  const lines = await withConsoleCapture(() => handler(req, res));
  const joined = lines.join("\n");

  assert.ok(!joined.includes(SENTINEL_TRANSCRIPT));
  assert.ok(!joined.includes(SENTINEL_PHONE));
  assert.ok(!joined.includes(SENTINEL_SECRET));
});
