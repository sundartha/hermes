// GQ-P5 (Befund N-1): Tests fuer den Provider-Anstoss-Riegel.
//
// Telnyx stoesst nach telephony_settings.user_idle_reply_secs Sekunden Anrufer-Stille von
// sich aus einen Turn an (Anbieter-Schema: "Duration in seconds of end user silence before
// the assistant checks in on the user. When this limit is reached the assistant will prompt
// the user to respond."; Live-Wert 4). Der Request traegt dann KEINE neue Aeusserung - seine
// letzte Nachricht ist eine System-Nachricht, die letzte user-Nachricht ist die alte.
//
// Ohne Riegel beantwortete der Shim diese alte Aeusserung erneut und sprach sie aus; die
// eigene Sprechzeit ist aus Anrufersicht wieder Stille, also folgte der naechste Anstoss.
// Am Beleg-Anruf call_msf0epenyv9g sechs Runden dieser Schleife (turnSeq 4/5/8/9/10/17).
//
// Diese Datei nagelt genau die Fremd-API-Annahme fest, an der der Bestand gescheitert ist
// (P10): "jeder POST auf /v1/chat/completions ist eine neue Aeusserung des Anrufers".
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
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import { captureConsole, noopWatchdog } from "./helpers.js";

const NUDGE_GATE_MARKER = '"reason":"provider_nudge"';

// Der gemessene Live-Payload: die alte Aeusserung steht noch als user-Nachricht drin, die
// LETZTE Nachricht ist der System-Anstoss von Telnyx.
function nudgeReq(call) {
  return validReq(call, {
    messages: [
      { role: "user", content: "Woher soll ich denn wissen, was dein Boss faehrt?" },
      { role: "assistant", content: "Einen Moment noch, bitte." },
      { role: "system", content: "The user has been silent. Check in on the user." },
    ],
  });
}

// Eine echte Aeusserung: letzte Nachricht traegt die user-Rolle.
function callerReq(call, text = "Welches Automodell hat er denn?") {
  return validReq(call, { messages: [{ role: "user", content: text }] });
}

function agentTurnSpy(result = { speech: "Echte Antwort", endCall: false }) {
  const calls = [];
  async function agentTurn(call, callerText, opts = {}) {
    calls.push({ call, callerText, opts });
    return {
      superseded: false,
      speechStreamed: false,
      roundtrips: 1,
      toolNames: [],
      offeredToolNames: [],
      streamArmedRounds: 0,
      stopReason: null,
      ...result,
    };
  }
  return { agentTurn, calls };
}

test("GQ-P5-1: System-Anstoss -> KEIN agentTurn, kein gesprochener Satz, gueltige leere Completion", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const spy = agentTurnSpy();
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true }),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });
  const res = fakeRes();

  await handler(nudgeReq(call), res);

  assert.equal(spy.calls.length, 0, "kein Modell-Aufruf (kein Token-Burn)");
  assert.equal(sseContent(res), "", "nichts gesprochen");
  assert.equal(sseEndsWithDone(res), true, "gueltige Completion - Telnyx darf den Turn nicht als abgebrochen lesen");
});

test("GQ-P5-2: System-Anstoss -> genau EINE gate-Zeile mit reason=provider_nudge, ohne Nachrichtentext (PII)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const spy = agentTurnSpy();
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(nudgeReq(call), res));

  const gateLines = lines.filter((l) => l.includes(NUDGE_GATE_MARKER));
  assert.equal(gateLines.length, 1);
  assert.ok(!gateLines[0].includes("Boss"), "kein Nachrichtentext im Log (PII)");
  assert.ok(!gateLines[0].includes("silent"), "kein Systemtext im Log (PII)");
});

test("GQ-P5-3: echte Aeusserung (letzte Rolle user) -> Riegel greift NICHT, Turn laeuft normal", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const spy = agentTurnSpy({ speech: "Echte Antwort", endCall: false });
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true }),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });
  const res = fakeRes();

  await handler(callerReq(call), res);

  assert.equal(spy.calls.length, 1);
  assert.equal(sseContent(res), "Echte Antwort");
});

test("GQ-P5-4: Flag aus -> Bestandsverhalten, der Anstoss beantwortet die ALTE Aeusserung erneut", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const spy = agentTurnSpy({ speech: "Gerne, ich warte.", endCall: false });
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig({
      telnyxShimTokenStreaming: true,
      telnyxShimIgnoreProviderNudge: false,
    }),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });
  const res = fakeRes();

  await handler(nudgeReq(call), res);

  assert.equal(spy.calls.length, 1, "Bestand: der Anstoss loest einen vollen Turn aus");
  assert.equal(
    spy.calls[0].callerText,
    "Woher soll ich denn wissen, was dein Boss faehrt?",
    "und zwar auf die ALTE Aeusserung - genau der gemessene Defekt",
  );
  assert.equal(sseContent(res), "Gerne, ich warte.");
});

// Der Anstoss ist ein Lebenszeichen: die Leitung steht. Wuerde der Riegel VOR observeTurn
// greifen, liefe der Dead-Air-Timer waehrend einer Rueckfrage weiter, in der der Anrufer
// absichtlich schweigt - und legte mitten im Warten auf. Diese Reihenfolge ist deshalb
// bindend und wird hier gepinnt (G31: sie steht sonst nur im Kommentar).
test("GQ-P5-5: der Anstoss fuettert den Watchdog trotzdem - observeTurn laeuft VOR dem Riegel", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const spy = agentTurnSpy();
  const observed = [];
  const watchdog = {
    ...noopWatchdog(),
    observeTurn: (callId, callerText) => {
      observed.push({ callId, callerText });
      return { loopExceeded: false, turnSeq: observed.length };
    },
  };
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog,
  });

  await handler(nudgeReq(call), fakeRes());

  assert.equal(observed.length, 1, "Dead-Air-Timer wird zurueckgesetzt - sonst legt der Notaus im Warten auf");
  assert.equal(spy.calls.length, 0, "trotzdem kein Modell-Aufruf");
});

// Der Loop-Guard liegt VOR dem Riegel (Schritt 4.6 vor 6.5). Reisst er, terminiert der Call
// wie im Bestand - der Riegel darf diesen Notaus nicht verschlucken.
test("GQ-P5-6: Loop-Guard schlaegt den Riegel - gerissener Guard terminiert auch beim Anstoss", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const spy = agentTurnSpy();
  const watchdog = { ...noopWatchdog(), observeTurn: () => ({ loopExceeded: true, turnSeq: 9 }) };
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog,
  });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(nudgeReq(call), res));

  assert.ok(
    lines.some((l) => l.includes('"reason":"loop_guard"')),
    "der Loop-Guard entscheidet, nicht der Riegel",
  );
  assert.ok(!lines.some((l) => l.includes(NUDGE_GATE_MARKER)), "kein provider_nudge-Gate danach");
  assert.equal(spy.calls.length, 0);
});
