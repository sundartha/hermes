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

// ---------- GQ-P7: das Zustellfenster der Rueckfrage-Antwort ----------
//
// Der Riegel oben darf nicht absolut sein. Am Live-Anruf call_msfwfmf7thof gemessen: die
// Antwort traf um 09:44:24 ein, danach sieben blockierte Anstoesse in Folge, Gespraechsende
// um 09:44:52 - der Agent hatte die Auskunft 28 Sekunden im Prompt und nie einen Turn, um
// sie auszusprechen. objective_achieved war false.

// Ein Call mit eingetroffener, aber noch nicht ausgelieferter Rueckfrage-Antwort.
// askedAt/answeredAt liegen NACH call.answeredAt - nur dann zaehlt der Consult als
// In-Call-Consult (isInCallConsult), und nur In-Call-Consults oeffnen das Fenster.
function callWithUndeliveredConsultAnswer(overrides = {}) {
  const answeredAt = new Date(Date.now() - 60_000).toISOString();
  return makeCall({
    answeredAt,
    consults: [
      {
        id: "c0",
        seq: 0,
        status: "answered",
        askedAt: new Date(Date.now() - 20_000).toISOString(),
        answeredAt: new Date(Date.now() - 5_000).toISOString(),
        answeredFacts: 1,
        ...overrides,
      },
    ],
  });
}

test("GQ-P7-1: wartende Rueckfrage-Antwort -> der Anstoss kommt DURCH, der Agent bekommt seinen Turn", async () => {
  const call = callWithUndeliveredConsultAnswer();
  const store = fakeStore({ call });
  const spy = agentTurnSpy({ speech: "Das Modell ist ein VW Golf 7.", endCall: false });
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true }),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(nudgeReq(call), res));

  assert.equal(spy.calls.length, 1, "der Turn MUSS laufen - sonst bleibt die Auskunft ungesagt");
  assert.equal(sseContent(res), "Das Modell ist ein VW Golf 7.");
  assert.ok(!lines.some((l) => l.includes(NUDGE_GATE_MARKER)), "kein provider_nudge-Gate");
});

test("GQ-P7-2: der ausgelieferte Turn schliesst das Fenster - der NAECHSTE Anstoss wird wieder blockiert", async () => {
  const call = callWithUndeliveredConsultAnswer();
  const store = fakeStore({ call });
  const spy = agentTurnSpy({ speech: "Das Modell ist ein VW Golf 7.", endCall: false });
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });

  await handler(nudgeReq(call), fakeRes());
  const lines = await captureConsole(() => handler(nudgeReq(call), fakeRes()));

  assert.deepEqual(store.consultDeliveryMarks, [call.id], "genau EINMAL markiert");
  assert.equal(spy.calls.length, 1, "der zweite Anstoss darf KEINEN zweiten Turn ausloesen");
  assert.equal(lines.filter((l) => l.includes(NUDGE_GATE_MARKER)).length, 1);
});

test("GQ-P7-3: wirft agentTurn, bleibt die Antwort unausgeliefert - das Fenster oeffnet erneut", async () => {
  const call = callWithUndeliveredConsultAnswer();
  const store = fakeStore({ call });
  let attempts = 0;
  async function agentTurn() {
    attempts += 1;
    throw new Error("Modell kaputt");
  }
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn,
    watchdog: noopWatchdog(),
  });

  await handler(nudgeReq(call), fakeRes());
  await handler(nudgeReq(call), fakeRes());

  assert.equal(attempts, 2, "fail-safe: lieber ein Turn zu viel als eine verlorene Auskunft");
  assert.deepEqual(store.consultDeliveryMarks, [], "nie als zugestellt markiert");
});

test("GQ-P7-4: auch ein ECHTER Sprecher-Turn verbraucht das Fenster (er traegt die Antwort genauso)", async () => {
  const call = callWithUndeliveredConsultAnswer();
  const store = fakeStore({ call });
  const spy = agentTurnSpy({ speech: "Antwort", endCall: false });
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });

  await handler(callerReq(call), fakeRes());
  const lines = await captureConsole(() => handler(nudgeReq(call), fakeRes()));

  assert.deepEqual(store.consultDeliveryMarks, [call.id]);
  assert.equal(spy.calls.length, 1, "der Anstoss danach oeffnet kein zweites Fenster");
  assert.equal(lines.filter((l) => l.includes(NUDGE_GATE_MARKER)).length, 1);
});

test("GQ-P7-5: eine BEREITS ausgelieferte Antwort oeffnet kein Fenster", async () => {
  const call = callWithUndeliveredConsultAnswer({ deliveredAt: new Date().toISOString() });
  const store = fakeStore({ call });
  const spy = agentTurnSpy();
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });

  const lines = await captureConsole(() => handler(nudgeReq(call), fakeRes()));

  assert.equal(spy.calls.length, 0);
  assert.equal(lines.filter((l) => l.includes(NUDGE_GATE_MARKER)).length, 1);
});

test("GQ-P7-6: eine noch OFFENE Rueckfrage oeffnet kein Fenster - es gibt nichts auszuliefern", async () => {
  const call = callWithUndeliveredConsultAnswer({ status: "open", answeredAt: null, answeredFacts: 0 });
  const store = fakeStore({ call });
  const spy = agentTurnSpy();
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn: spy.agentTurn,
    watchdog: noopWatchdog(),
  });

  const lines = await captureConsole(() => handler(nudgeReq(call), fakeRes()));

  assert.equal(spy.calls.length, 0);
  assert.equal(lines.filter((l) => l.includes(NUDGE_GATE_MARKER)).length, 1);
});
