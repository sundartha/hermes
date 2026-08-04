// GQ-P1 (Befund B-1): Tests fuer den Verdraengungs-Riegel. Ebene 1 prueft die reine
// Registry (kein Netz/Spawn, P12 Fast/Independent). Ebene 2 prueft den Shim-Handler ueber
// die geteilte Fake-Harness (test/telnyx-shim-harness.js) mit einem lokal steuerbaren
// agentTurn-Double, das echte Ueberlappung zweier Turns nachbildet - genau das Fenster, in
// dem live zwischen zwei Telnyx-POSTs ein Turn noch laeuft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeInFlightTurnRegistry, SUPERSEDE_REFUSAL } from "../src/telnyx-turn-supersede.js";
import {
  fakeRes,
  fakeStore,
  makeCall,
  makeHandler,
  validReq,
  sseContent,
  sseRole,
  sseFinishReason,
  sseEndsWithDone,
  jsonCompletion,
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import { captureConsole, noopWatchdog } from "./helpers.js";

// ---------- Ebene 1: reine Registry ----------

test("GQ-P1-1: laufender Turn + supersedeTurn -> superseded:true, refusal:null, Signal aborted", () => {
  const registry = makeInFlightTurnRegistry();
  const inFlight = registry.beginTurn("call_a", { hasSpokenText: () => false });
  const outcome = registry.supersedeTurn("call_a");
  assert.deepEqual(outcome, { superseded: true, refusal: null });
  assert.equal(inFlight.signal.aborted, true);
});

test("GQ-P1-2: kein laufender Turn -> superseded:false, refusal:no_inflight", () => {
  const registry = makeInFlightTurnRegistry();
  const outcome = registry.supersedeTurn("call_unbekannt");
  assert.deepEqual(outcome, { superseded: false, refusal: SUPERSEDE_REFUSAL.NO_INFLIGHT });
});

test("GQ-P1-3: hasSpokenText liefert true -> refusal:already_spoken, Signal bleibt unaborted", () => {
  const registry = makeInFlightTurnRegistry();
  const inFlight = registry.beginTurn("call_a", { hasSpokenText: () => true });
  const outcome = registry.supersedeTurn("call_a");
  assert.deepEqual(outcome, { superseded: false, refusal: SUPERSEDE_REFUSAL.ALREADY_SPOKEN });
  assert.equal(inFlight.signal.aborted, false);
});

test("GQ-P1-4: zweimal verdraengen -> zweiter Versuch already_superseded", () => {
  const registry = makeInFlightTurnRegistry();
  registry.beginTurn("call_a", { hasSpokenText: () => false });
  const first = registry.supersedeTurn("call_a");
  const second = registry.supersedeTurn("call_a");
  assert.equal(first.superseded, true);
  assert.deepEqual(second, { superseded: false, refusal: SUPERSEDE_REFUSAL.ALREADY_SUPERSEDED });
});

test("GQ-P1-5: endTurn des VERDRAENGTEN Turns loescht nicht den Eintrag seines Nachfolgers", () => {
  const registry = makeInFlightTurnRegistry();
  const first = registry.beginTurn("call_a", { hasSpokenText: () => false });
  registry.supersedeTurn("call_a"); // verdraengt first
  const second = registry.beginTurn("call_a", { hasSpokenText: () => false });
  first.endTurn(); // ein naives delete wuerde hier second's Eintrag mitreissen
  const outcome = registry.supersedeTurn("call_a");
  assert.equal(outcome.superseded, true, "second ist weiterhin verdraengbar");
  assert.equal(second.signal.aborted, true);
});

test("GQ-P1-6: zwei callIds beeinflussen sich nicht", () => {
  const registry = makeInFlightTurnRegistry();
  const a = registry.beginTurn("call_a", { hasSpokenText: () => false });
  registry.beginTurn("call_b", { hasSpokenText: () => false });
  const outcomeA = registry.supersedeTurn("call_a");
  assert.equal(outcomeA.superseded, true);
  assert.equal(a.signal.aborted, true);
  const outcomeB = registry.supersedeTurn("call_b");
  assert.equal(outcomeB.superseded, true, "call_b unabhaengig weiterhin verdraengbar");
});

// ---------- Ebene 2: Shim-Handler ueber die Fake-Harness ----------

// Ein agentTurn, der HAENGT, bis der Test ihn freigibt - nur so entsteht im Test die
// Ueberlappung, die live zwischen zwei Telnyx-POSTs entsteht. waitForCall(idx) wartet
// (unabhaengig von der Aufrufreihenfolge) auf genau den idx-ten Aufruf; release(idx) gibt
// ihn frei. Der Rueckgabewert bildet den echten agentTurn-Vertrag nach: ist das Signal
// beim Freigeben bereits aborted, liefert er den verdraengten Ausgang (superseded:true,
// speech:""), sonst das uebergebene Ergebnis.
function deferredAgentTurn(result = { speech: "Hallo Welt", endCall: false }) {
  const calls = [];
  const releasers = [];
  const calledSignals = [];
  function calledSignal(idx) {
    if (!calledSignals[idx]) {
      let resolve;
      const promise = new Promise((res) => {
        resolve = res;
      });
      calledSignals[idx] = { promise, resolve };
    }
    return calledSignals[idx];
  }
  async function agentTurn(call, callerText, opts = {}) {
    const idx = calls.length;
    calls.push({ call, callerText, opts });
    calledSignal(idx).resolve();
    await new Promise((res) => {
      releasers[idx] = res;
    });
    if (opts.abortSignal?.aborted)
      return {
        speech: "",
        speechStreamed: false,
        endCall: false,
        superseded: true,
        roundtrips: 1,
        toolNames: [],
        offeredToolNames: [],
        streamArmedRounds: 0,
        stopReason: "superseded",
      };
    return { superseded: false, speechStreamed: false, roundtrips: 1, toolNames: [], offeredToolNames: [], streamArmedRounds: 0, stopReason: null, ...result };
  }
  return {
    agentTurn,
    calls,
    waitForCall: (idx) => calledSignal(idx).promise,
    release: (idx) => releasers[idx](),
    emit: (idx, text) => calls[idx].opts.onSpeechChunk?.(text),
    signalOf: (idx) => calls[idx].opts.abortSignal,
  };
}

function supersedeConfig(overrides = {}) {
  return fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true, ...overrides });
}

// Zwei Aeusserungen im "extends"-Verhaeltnis (der Sonde, telnyx-turn-probe.js): der zweite
// Text ist ein echtes Praefix-Fortschreiben des ersten - das kumulative STT-Zwischenergebnis
// dieser Phase. reqExtends(call, chars) liefert den Request MIT dem gewuenschten Fragment.
const EXTENDS_TEXT_1 = "Ja,";
const EXTENDS_TEXT_2 = "Ja, teil was hat der Doktor gesagt";

function reqExtends(call, text) {
  return validReq(call, { messages: [{ role: "user", content: text }] });
}

test("GQ-P1-7: extends bei laufendem Turn verdraengt ihn - Vorgaenger schweigt, Nachfolger spricht", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Vollstaendige Antwort" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqExtends(call, EXTENDS_TEXT_1), res1);
    await fa.waitForCall(0);
    const p2 = handler(reqExtends(call, EXTENDS_TEXT_2), res2);
    await fa.waitForCall(1);

    assert.equal(fa.signalOf(0).aborted, true, "Vorgaenger wurde verdraengt");
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  assert.equal(sseContent(res1), "", "verdraengter Turn spricht nichts");
  assert.equal(sseFinishReason(res1), "stop");
  assert.equal(sseEndsWithDone(res1), true, "gueltige Completion statt Stille");
  assert.equal(sseContent(res2), "Vollstaendige Antwort");
  assert.ok(lines.some((l) => l.includes("supersede") && l.includes('"superseded":true')));
});

test("GQ-P1-8: extends bei bereits abgeschlossenem Turn -> no_inflight, beide Turns sprechen (Bestand)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Antwort eins" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqExtends(call, EXTENDS_TEXT_1), res1);
    await fa.waitForCall(0);
    fa.release(0);
    await p1; // R1 ist VOLLSTAENDIG beendet, bevor R2 eintrifft

    const p2 = handler(reqExtends(call, EXTENDS_TEXT_2), res2);
    await fa.waitForCall(1);
    fa.release(1);
    await p2;
  });

  assert.equal(sseContent(res1), "Antwort eins");
  assert.equal(sseContent(res2), "Antwort eins");
  const supersedeLine = lines.find((l) => l.includes("supersede"));
  assert.ok(supersedeLine.includes('"superseded":false'));
  assert.ok(supersedeLine.includes(SUPERSEDE_REFUSAL.NO_INFLIGHT));
});

test("GQ-P1-9: same bei laufendem Turn -> keine supersede-Zeile, kein Abbruch (Consult-Nachfass)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Antwort" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const sameText = "Ich moechte einen Termin";
  const lines = await captureConsole(async () => {
    const p1 = handler(validReq(call, { messages: [{ role: "user", content: sameText }] }), res1);
    await fa.waitForCall(0);
    const p2 = handler(validReq(call, { messages: [{ role: "user", content: sameText }] }), res2);
    await fa.waitForCall(1);

    assert.equal(fa.signalOf(0).aborted, false, "same darf NICHT abbrechen");
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  assert.equal(
    lines.some((l) => l.includes("supersede")),
    false,
  );
});

test("GQ-P1-10: other bei laufendem Turn -> keine supersede-Zeile, kein Abbruch", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Antwort" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(validReq(call, { messages: [{ role: "user", content: "Wie ist das Wetter" }] }), res1);
    await fa.waitForCall(0);
    const p2 = handler(
      validReq(call, { messages: [{ role: "user", content: "Ganz was anderes komplett" }] }),
      res2,
    );
    await fa.waitForCall(1);

    assert.equal(fa.signalOf(0).aborted, false, "other darf NICHT abbrechen");
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  assert.equal(
    lines.some((l) => l.includes("supersede")),
    false,
  );
});

test("GQ-P1-11: verdraengter Request bekommt eine gueltige, leere Completion - nie Stille", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Vollstaendig" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqExtends(call, EXTENDS_TEXT_1), res1);
    await fa.waitForCall(0);
    const p2 = handler(reqExtends(call, EXTENDS_TEXT_2), res2);
    await fa.waitForCall(1);
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  assert.equal(sseRole(res1), "assistant");
  assert.equal(sseFinishReason(res1), "stop");
  assert.equal(sseEndsWithDone(res1), true);
  assert.equal(sseContent(res1), "");
});

test("GQ-P1-12: Vorgaenger hat schon gestreamt -> already_spoken, kein Abbruch, Text bleibt vollstaendig", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Guten Tag." });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqExtends(call, EXTENDS_TEXT_1), res1);
    await fa.waitForCall(0);
    fa.emit(0, "Guten Tag."); // Vorgaenger hat bereits gesprochen, BEVOR R2 eintrifft
    const p2 = handler(reqExtends(call, EXTENDS_TEXT_2), res2);
    await fa.waitForCall(1);

    assert.equal(fa.signalOf(0).aborted, false, "bereits gesprochener Text darf nicht abgebrochen werden");
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  assert.equal(sseContent(res1), "Guten Tag.Guten Tag.", "streamedChunk + finish(speech) - Bestandsverhalten");
  const supersedeLine = lines.find((l) => l.includes("supersede"));
  assert.ok(supersedeLine.includes('"superseded":false'));
  assert.ok(supersedeLine.includes(SUPERSEDE_REFUSAL.ALREADY_SPOKEN));
});

test("GQ-P1-13: Flag aus -> Bestandsverhalten, keine supersede-Zeile, beide Turns sprechen", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig({ telnyxShimSupersedeExtendedTurn: false });
  const fa = deferredAgentTurn({ speech: "Antwort" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqExtends(call, EXTENDS_TEXT_1), res1);
    await fa.waitForCall(0);
    const p2 = handler(reqExtends(call, EXTENDS_TEXT_2), res2);
    await fa.waitForCall(1);

    assert.equal(fa.signalOf(0).aborted, false);
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  assert.equal(sseContent(res1), "Antwort");
  assert.equal(sseContent(res2), "Antwort");
  assert.equal(
    lines.some((l) => l.includes("supersede")),
    false,
  );
});

test("GQ-P1-14: verdraengter Turn mit endCall:true loest KEIN farewell_scheduled aus", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Auf Wiederhoeren", endCall: true });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqExtends(call, EXTENDS_TEXT_1), res1);
    await fa.waitForCall(0);
    const p2 = handler(reqExtends(call, EXTENDS_TEXT_2), res2);
    await fa.waitForCall(1);
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  const farewellCount = lines.filter((l) => l.includes("farewell_scheduled")).length;
  assert.equal(
    farewellCount,
    1,
    "GENAU EIN Abschied (vom Nachfolger p2) - der verdraengte Vorgaenger p1 plant keinen zweiten",
  );
});

// Gegenbeispiel zu GQ-P1-14: derselbe Turn OHNE Verdraengung loest sehr wohl
// farewell_scheduled aus - stellt sicher, dass die Abwesenheit oben am Riegel liegt und
// nicht an einer trivial nie greifenden Bedingung.
test("GQ-P1-14b (Gegenbeispiel): derselbe endCall:true-Turn OHNE Verdraengung plant den Abschied", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Auf Wiederhoeren", endCall: true });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(validReq(call), res1);
    await fa.waitForCall(0);
    fa.release(0);
    await p1;
  });

  assert.ok(lines.some((l) => l.includes("farewell_scheduled")));
});

test("GQ-P1-15: die supersede-Zeile enthaelt weder Anrufer- noch Antworttext (PII)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = supersedeConfig();
  const fa = deferredAgentTurn({ speech: "Vollstaendige Antwort mit geheimem Inhalt" });
  const handler = makeHandler({ store, config, agentTurn: fa.agentTurn, watchdog: noopWatchdog() });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const callerText1 = "Ja";
  const callerText2 = "Ja, teil was hat der Zahnarzt gesagt";

  const lines = await captureConsole(async () => {
    const p1 = handler(validReq(call, { messages: [{ role: "user", content: callerText1 }] }), res1);
    await fa.waitForCall(0);
    const p2 = handler(validReq(call, { messages: [{ role: "user", content: callerText2 }] }), res2);
    await fa.waitForCall(1);
    fa.release(1);
    await p2;
    fa.release(0);
    await p1;
  });

  const supersedeLine = lines.find((l) => l.includes("supersede"));
  assert.ok(supersedeLine);
  assert.ok(!supersedeLine.includes(callerText1));
  assert.ok(!supersedeLine.includes(callerText2));
  assert.ok(!supersedeLine.includes("geheimem Inhalt"));
});
