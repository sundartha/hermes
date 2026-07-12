// Unit-Tests fuer P3a (PLAN-TELNYX-AI-ASSISTANT.md, Phase telnyx-p3a): end_call aus dem
// Telnyx Brain-Shim MUSS den Call REAL out-of-band ueber Call-Control beenden (Regel 1) -
// sonst laeuft der Call plus Tokenkosten weiter, obwohl das Modell "Auf Wiederhoeren" sagt.
// Seit afix-p3 (R4) terminiert der Shim bei end_call NICHT mehr sofort, sondern uebergibt an
// watchdog.scheduleFarewellHangup (Schutz des Abschiedssatzes) - diese Datei ist die EINE
// Quelle des end_call-Shim-Kontrakts und wurde entsprechend angepasst (G5/G11), nicht
// dupliziert. Braucht dafuer den ECHTEN Watchdog + Fake-Timer statt noopWatchdog. Fake-Harness
// (kein Netz/Spawn) aus telnyx-shim-harness.js (G5, geteilt mit
// telnyx-p6-midcall-budget-kill.test.js - beide brauchen den voiceControl-Hangup-Pfad).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fakeRes,
  fakeStore,
  voiceControlSpy,
  agentTurnSpy,
  makeCall,
  makeHandler,
  reqWith,
  validReq,
  SHIM_SHARED_SECRET,
  sseContent,
  sseEndsWithDone,
  fakeTimers,
  makeTestWatchdog,
  DEAD_AIR_TEST_MS,
} from "./telnyx-shim-harness.js";
import { captureConsole } from "./helpers.js";

// afix-p3-Bau-Helfer (P13): ein handler mit ECHTEM Watchdog + Fake-Timer statt der
// noopWatchdog-Default aus makeHandler - noetig fuer jeden Test, der den end_call-Hangup
// tatsaechlich beobachten will (der Hangup laeuft jetzt ueber den Farewell-Timer).
function setupWithRealWatchdog({ store, agentTurn, voiceControl }) {
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const handler = makeHandler({ store, agentTurn, voiceControl, watchdog });
  return { timers, watchdog, handler };
}

// Wie fakeRes(), aber der ZWEITE write()-Aufruf wirft (der erste - der role-Delta-Chunk -
// schlaegt durch, headersSent kippt wie im echten Express). Bildet einen Socket nach, der
// mitten im Happy-Path-writeCompletion wegbricht (zwischen dem role-Chunk und dem
// content-Chunk) - Muster identisch zu T1 in telnyx-llm-shim.test.js.
function fakeResFailingOnSecondWrite() {
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

// === E1: end_call plant den Hangup verzoegert (afix-p3), speech geht ZUERST raus ===

test("E1: end_call=true + vorhandene callControlId -> speech zuerst, kein sofortiger Hangup, Farewell-Timer geplant", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy();
  const { timers, handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.ok(sseEndsWithDone(res), "Sequenz endet spec-konform mit data: [DONE]");
  assert.equal(sseContent(res), "Auf Wiederhoeren");
  assert.equal(res.ended, true);
  assert.equal(voiceControl.calls.length, 0, "kein sofortiger Hangup - der Abschied bekommt Zeit");
  assert.equal(timers.pendingCount(), 1, "genau ein Farewell-Timer pending");

  timers.fireAll();
  await Promise.resolve();

  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: "cc_1" }]);
  assert.deepEqual(
    store.getCallIds,
    ["call_x"],
    "frischer Store-Stand vor dem Hangup (terminateViaCallControl-Fresh-Fetch)",
  );
});

// afix-p3 (P14, eigener Test): der farewell_scheduled-Log ist die einzige Live-Unterscheidung
// zwischen "Hangup geplant" und "end_call kam gar nicht" - PII-frei (nur callId + delayMs).
test("E1b: end_call=true loggt farewell_scheduled mit callId und delayMs (PII-frei)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy();
  const { handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(validReq(call), res));

  assert.ok(
    lines.some((l) => l.includes("[telnyx-shim] farewell_scheduled") && l.includes('"callId":"call_x"') && l.includes('"delayMs"')),
    "farewell_scheduled-Log mit callId+delayMs fehlt",
  );
});

// === E2: kein zweiter Store-Write (Settlement bleibt P4.5 onHangup) =============

test("E2: end_call ruft KEIN finishCall/endCallRecord auf - genau EIN Hangup-Call, auch nach dem Farewell-Delay", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Tschuess", endCall: true });
  const voiceControl = voiceControlSpy();
  const { timers, handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(validReq(call), res);
  timers.fireAll();
  await Promise.resolve();

  assert.equal(voiceControl.calls.length, 1);
  assert.deepEqual(store.settlementCalls, [], "Settlement bleibt allein bei P4.5 onHangup");
});

// === E3: unaufloesbare ccid -> 403, kein agentTurn, kein Hangup =================
// Vorher (P1): ein Call OHNE callControlId loeste ueber das per-Call-Token trotzdem auf
// (Token = callId), der Hangup war lediglich fail-safe uebersprungen. Seit der Korrelation
// ueber call_control_id (E1) IST callControlId der Aufloesungs-Schluessel selbst - ein Call
// ohne callControlId ist damit gar nicht mehr erreichbar. Das neue korrekte Gate ist ein
// 403 VOR agentTurn (kein Turn/Token-Burn, kein Hangup-Versuch).

test("E3: unaufloesbare ccid (kein Call traegt diese callControlId) -> 403, kein agentTurn, kein Hangup", async () => {
  const call = makeCall({ callControlId: undefined });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Tschuess", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: `Bearer ${SHIM_SHARED_SECRET}`, body: { extra_metadata: { call_control_id: "cc_unresolvable" } } }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0, "kein Token-Burn ohne aufgeloesten Call");
  assert.equal(voiceControl.calls.length, 0, "kein Hangup-Versuch ohne aufgeloesten Call");
});

// === E4: endCall=false Gegenprobe (kein Fresh-Fetch, kein Hangup, Dead-Air statt Farewell) ===

test("E4: endCall=false -> kein Hangup-Aufruf, kein Fresh-Fetch nach dem Turn, nur der Dead-Air-Timer aus observeTurn", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Bis dann", endCall: false });
  const voiceControl = voiceControlSpy();
  const { timers, handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.equal(voiceControl.calls.length, 0);
  assert.deepEqual(store.getCallIds, [], "kein getCall-Fresh-Fetch ohne end_call");
  assert.equal(sseContent(res), "Bis dann");
  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "Dead-Air aus observeTurn, kein Farewell-Timer");
});

// === E5: Hangup wirft -> Response bleibt intakt (eigener try/catch, Regel-1-Robustheit) ===

test("E5: Call-Control-Hangup wirft im Timer-Callback -> kein unhandled rejection, Response bereits intakt raus, Hangup versucht", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy({ throwOnHangup: true });
  const { timers, handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.ok(sseEndsWithDone(res), "Response wurde vor dem Hangup-Versuch bereits vollstaendig geschrieben");
  assert.equal(res.ended, true);

  assert.doesNotThrow(() => timers.fireAll(), "der werfende Hangup darf den Timer-Callback nicht crashen lassen");
  await Promise.resolve();
  assert.equal(voiceControl.calls.length, 1, "Hangup wurde versucht");
});

// === T5: end_call=true + writeCompletion wirft (Teil-Write, Catch-Pfad) -> Hangup TROTZDEM ===
// Review-Blocker G3/T5 (+ C2): agentTurn liefert erfolgreich endCall=true, aber der
// direkt anschliessende writeCompletion-Aufruf wirft mitten im SSE-Write (identisches
// Muster zu T1 in telnyx-llm-shim.test.js). Der Code landet im Catch-Block - dort darf
// der Call-Control-Hangup NICHT ausbleiben, denn agentTurn HAT bereits ein verwertbares
// Ergebnis (endCall=true) geliefert; nur der Response-Write ist gescheitert.

test("T5: end_call=true, writeCompletion wirft nach dem ersten Write -> Farewell wird trotzdem geplant, Hangup laeuft ab", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy();
  const { timers, handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeResFailingOnSecondWrite();

  await handler(validReq(call), res);

  assert.equal(res.chunks.length, 1, "nur der role-Chunk steht - der content-Chunk-Write hat geworfen, kein Retry");
  assert.equal(res.ended, true, "Fehlerpfad ruft end() statt erneut writeCompletion aufzurufen");
  assert.equal(voiceControl.calls.length, 0, "kein sofortiger Hangup");

  timers.fireAll();
  await Promise.resolve();

  assert.deepEqual(
    voiceControl.calls,
    [{ provider: "telnyx", callControlId: "cc_1" }],
    "endCall=true bleibt aus dem agentTurn-Erfolg bestehen - Hangup trotz Write-Fehler (Regel 1)",
  );
});

test("T5b: endCall=false + writeCompletion wirft -> Gegenprobe: weiterhin KEIN Farewell-Timer, kein Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Bis dann", endCall: false });
  const voiceControl = voiceControlSpy();
  const { timers, handler } = setupWithRealWatchdog({ store, agentTurn, voiceControl });
  const res = fakeResFailingOnSecondWrite();

  await handler(validReq(call), res);

  assert.equal(res.ended, true);
  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "nur der Dead-Air-Timer aus observeTurn, kein Farewell-Timer");
  assert.equal(voiceControl.calls.length, 0, "kein Hangup, wenn agentTurn kein end_call lieferte");
});
