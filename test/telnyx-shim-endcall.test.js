// Unit-Tests fuer P3a (PLAN-TELNYX-AI-ASSISTANT.md, Phase telnyx-p3a): end_call aus dem
// Telnyx Brain-Shim MUSS den Call REAL out-of-band ueber Call-Control beenden (Regel 1) -
// sonst laeuft der Call plus Tokenkosten weiter, obwohl das Modell "Auf Wiederhoeren" sagt.
// Fake-Harness (kein Netz/Spawn) aus telnyx-shim-harness.js (G5, geteilt mit
// telnyx-p6-midcall-budget-kill.test.js - beide brauchen den voiceControl-Hangup-Pfad).
import { test } from "node:test";
import assert from "node:assert/strict";
import { localeFor } from "../src/i18n/locales.js";
import {
  fakeRes,
  fakeStore,
  voiceControlSpy,
  agentTurnSpy,
  makeCall,
  makeHandler,
  reqWith,
  firstChunkJson,
} from "./telnyx-shim-harness.js";

// Wie fakeRes(), aber der ZWEITE write()-Aufruf wirft (der erste - der eigentliche SSE-
// Chunk - schlaegt durch, headersSent kippt wie im echten Express). Bildet einen Socket
// nach, der mitten im Happy-Path-writeFakeStream wegbricht (zwischen dem Daten-Chunk und
// "data: [DONE]") - Muster identisch zu T1 in telnyx-llm-shim.test.js.
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

// === E1: end_call feuert Hangup, speech geht ZUERST raus ========================

test("E1: end_call=true + vorhandene callControlId -> speech zuerst, dann echter Call-Control-Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.chunks.length, 2, "genau EIN SSE-Chunk + data: [DONE]");
  assert.equal(firstChunkJson(res).choices[0].delta.content, "Auf Wiederhoeren");
  assert.equal(res.ended, true);

  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: "cc_1" }]);
  assert.deepEqual(
    store.getCallIds,
    ["call_x", "call_x"],
    "Token-Auth-Fetch + frischer Store-Stand vor dem Hangup",
  );
});

// === E2: kein zweiter Store-Write (Settlement bleibt P4.5 onHangup) =============

test("E2: end_call ruft KEIN finishCall/endCallRecord auf - genau EIN Hangup-Call", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Tschuess", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(voiceControl.calls.length, 1);
  assert.deepEqual(store.settlementCalls, [], "Settlement bleibt allein bei P4.5 onHangup");
});

// === E3: fail-safe ohne callControlId (persistiert erst P5) =====================

test("E3: end_call=true OHNE callControlId -> kein Hangup, kein Throw, speech normal", async () => {
  const call = makeCall({ callControlId: undefined });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Tschuess", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(voiceControl.calls.length, 0, "fail-safe Skip ohne callControlId");
  assert.equal(res.chunks.length, 2, "speech geht trotzdem normal raus");
  assert.equal(res.ended, true);
});

// === E4: endCall=false Gegenprobe (kein Fresh-Fetch, kein Hangup) ===============

test("E4: endCall=false -> kein Hangup-Aufruf, kein Fresh-Fetch nach dem Turn", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Bis dann", endCall: false });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(voiceControl.calls.length, 0);
  assert.deepEqual(store.getCallIds, ["call_x"], "kein zweiter getCall ohne end_call");
  assert.equal(firstChunkJson(res).choices[0].delta.content, "Bis dann");
});

// === E5: Hangup wirft -> Response bleibt intakt (eigener try/catch, Regel-1-Robustheit) ===

test("E5: Call-Control-Hangup wirft -> Handler resolved trotzdem, Response bereits intakt raus", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy({ throwOnHangup: true });
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.chunks.length, 2, "Response wurde vor dem Hangup-Versuch bereits vollstaendig geschrieben");
  assert.equal(res.ended, true);
  assert.equal(voiceControl.calls.length, 1, "Hangup wurde versucht");
});

// === T5: end_call=true + writeFakeStream wirft (Teil-Write, Catch-Pfad) -> Hangup TROTZDEM ===
// Review-Blocker G3/T5 (+ C2): agentTurn liefert erfolgreich endCall=true, aber der
// direkt anschliessende writeFakeStream-Aufruf wirft mitten im SSE-Write (identisches
// Muster zu T1 in telnyx-llm-shim.test.js). Der Code landet im Catch-Block - dort darf
// der Call-Control-Hangup NICHT ausbleiben, denn agentTurn HAT bereits ein verwertbares
// Ergebnis (endCall=true) geliefert; nur der Response-Write ist gescheitert.

test("T5: end_call=true, writeFakeStream wirft nach dem ersten Write -> Hangup wird trotzdem versucht", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeResFailingOnSecondWrite();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.chunks.length, 1, "nur der erste (fehlgeschlagene) Chunk steht - kein Retry-Chunk");
  assert.equal(res.ended, true, "Fehlerpfad ruft end() statt erneut writeFakeStream aufzurufen");
  assert.deepEqual(
    voiceControl.calls,
    [{ provider: "telnyx", callControlId: "cc_1" }],
    "endCall=true bleibt aus dem agentTurn-Erfolg bestehen - Hangup trotz Write-Fehler",
  );
});

test("T5b: endCall=false + writeFakeStream wirft -> Gegenprobe: weiterhin KEIN Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Bis dann", endCall: false });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeResFailingOnSecondWrite();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.ended, true);
  assert.equal(voiceControl.calls.length, 0, "kein Hangup, wenn agentTurn kein end_call lieferte");
});
