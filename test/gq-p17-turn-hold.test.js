// GQ-P17: Tests fuer die Haltefrist gegen die fragmentierte Spracherkennung. Ebene 1 prueft
// die reine Registry, Ebene 2 den Shim-Handler ueber die geteilte Fake-Harness
// (test/telnyx-shim-harness.js). Kein Netz, kein Spawn, keine Wanduhr: die Frist laeuft
// ueber injizierte Timer (P12 Fast/Repeatable) - dieselbe Technik wie beim Watchdog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeTurnHoldRegistry, TURN_HOLD_OUTCOME } from "../src/telnyx-turn-hold.js";
import { deadAirOverrun, enforcedTurnWorstCaseMs } from "../src/turn-budget.js";
import {
  agentTurnSpy,
  fakeRes,
  fakeStore,
  fakeTimers,
  makeCall,
  makeHandler,
  validReq,
  voiceControlSpy,
  sseContent,
  sseRole,
  sseFinishReason,
  sseEndsWithDone,
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import { captureConsole, noopWatchdog } from "./helpers.js";

// ---------- Ebene 1: reine Registry ----------

test("GQ-P17-1: holdMs 0 -> outcome off, sofort, kein Eintrag", async () => {
  const timers = fakeTimers();
  const registry = makeTurnHoldRegistry(timers);
  assert.equal(await registry.holdTurn("call_a", 0), TURN_HOLD_OUTCOME.OFF);
  assert.equal(registry.hasHeldTurn("call_a"), false);
  assert.equal(timers.pendingCount(), 0, "ohne Frist wird kein Timer gestellt");
});

test("GQ-P17-2: die Frist laeuft ab -> outcome elapsed, Eintrag danach weg", async () => {
  const timers = fakeTimers();
  const registry = makeTurnHoldRegistry(timers);
  const held = registry.holdTurn("call_a", 3000);
  assert.equal(registry.hasHeldTurn("call_a"), true);
  assert.deepEqual(timers.pendingDelays(), [3000]);
  timers.fireAll();
  assert.equal(await held, TURN_HOLD_OUTCOME.ELAPSED);
  assert.equal(registry.hasHeldTurn("call_a"), false);
});

test("GQ-P17-3: supersedeHeldTurn waehrend des Haltens -> true, Halter bekommt extended", async () => {
  const timers = fakeTimers();
  const registry = makeTurnHoldRegistry(timers);
  const held = registry.holdTurn("call_a", 3000);
  assert.equal(registry.supersedeHeldTurn("call_a"), true);
  assert.equal(await held, TURN_HOLD_OUTCOME.EXTENDED);
  assert.equal(registry.hasHeldTurn("call_a"), false);
  assert.equal(timers.clearedCount(), 1, "der Timer des ueberholten Halters wird geraeumt");
});

test("GQ-P17-4: supersedeHeldTurn ohne Halter -> false (Grenzfall)", () => {
  const registry = makeTurnHoldRegistry(fakeTimers());
  assert.equal(registry.supersedeHeldTurn("call_unbekannt"), false);
});

test("GQ-P17-5: zwei callIds beeinflussen sich nicht", async () => {
  const timers = fakeTimers();
  const registry = makeTurnHoldRegistry(timers);
  const heldA = registry.holdTurn("call_a", 3000);
  const heldB = registry.holdTurn("call_b", 3000);
  assert.equal(registry.supersedeHeldTurn("call_a"), true);
  assert.equal(await heldA, TURN_HOLD_OUTCOME.EXTENDED);
  assert.equal(registry.hasHeldTurn("call_b"), true, "call_b bleibt unberuehrt gehalten");
  timers.fireAll();
  assert.equal(await heldB, TURN_HOLD_OUTCOME.ELAPSED);
});

test("GQ-P17-6: der abgelaufene Halter loescht nicht den Eintrag eines spaeteren Halters", async () => {
  const timers = fakeTimers();
  const registry = makeTurnHoldRegistry(timers);
  const first = registry.holdTurn("call_a", 3000);
  registry.supersedeHeldTurn("call_a"); // first ist ueberholt
  assert.equal(await first, TURN_HOLD_OUTCOME.EXTENDED);
  const second = registry.holdTurn("call_a", 3000);
  assert.equal(registry.hasHeldTurn("call_a"), true);
  // Ein naives delete im Freigabe-Pfad von first haette den Eintrag von second mitgerissen.
  assert.equal(registry.supersedeHeldTurn("call_a"), true, "second ist weiterhin ueberholbar");
  assert.equal(await second, TURN_HOLD_OUTCOME.EXTENDED);
});

// ---------- Ebene 2: Shim-Handler ueber die Fake-Harness ----------

// Die ausgelieferte Frist (config.js-Fallback) - EINE Stelle statt gestreuter Literale.
const HOLD_MS = 3000;

// Zwei Aeusserungen im "extends"-Verhaeltnis der Sonde (telnyx-turn-probe.js): der zweite
// Text schreibt den ersten woertlich fort - genau das kumulative nova-3-Zwischenergebnis,
// das am 2026-08-09 zwei Wetterberichte erzeugt hat.
const FRAGMENT_1 = "Wie ist das Wetter";
const FRAGMENT_2 = "Wie ist das Wetter morgen in Muenchen";
const ANSWER = "Morgen wird es sonnig bei 24 Grad";

// Die await-Kette bis zur Frist ist rein Mikrotask-basiert (Call-Aufloesung + Gates);
// setImmediate laeuft danach - der Handler steht dann sicher in der Frist.
const tick = () => new Promise((resolve) => setImmediate(resolve));

function holdConfig(overrides = {}) {
  return fakeTelnyxShimConfig({ telnyxShimExtendHoldMs: HOLD_MS, ...overrides });
}

function reqText(call, text) {
  return validReq(call, { messages: [{ role: "user", content: text }] });
}

// Build-Schritt (P13): Call + Store + Handler mit injizierten Timern, wie ihn jeder
// Ebene-2-Test braucht.
function holdHarness({ config = holdConfig(), call = makeCall(), store, voiceControl } = {}) {
  const timers = fakeTimers();
  const agent = agentTurnSpy({ speech: ANSWER, endCall: false });
  const usedStore = store || fakeStore({ call });
  const handler = makeHandler({
    store: usedStore,
    config,
    agentTurn: agent,
    voiceControl,
    watchdog: noopWatchdog(),
    heldTurns: makeTurnHoldRegistry(timers),
  });
  return { call, timers, agent, handler };
}

function holdLines(lines) {
  return lines.filter((l) => l.includes("[telnyx-shim] hold "));
}

test("GQ-P17-7: fortschreibendes Fragment -> genau EIN Modell-Turn, nur der zweite spricht", async () => {
  const { call, timers, agent, handler } = holdHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    assert.equal(agent.calls.length, 0, "die Frist haelt den Modell-Aufruf zurueck");

    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await p1; // R1 wird ueberholt und antwortet leer, ohne Turn
    await tick();
    timers.fireAll(); // R2 wartet seine eigene Frist aus
    await p2;
  });

  assert.equal(agent.calls.length, 1, "genau EINE Recherche statt zweier");
  assert.equal(agent.calls[0].callerText, FRAGMENT_2, "der laengere Text gewinnt");
  assert.equal(sseContent(res1), "", "der ueberholte Turn spricht nichts");
  assert.equal(sseContent(res2), ANSWER, "genau EINE gesprochene Antwort");
});

test("GQ-P17-8: der ueberholte Request liefert eine gueltige, leere Completion - nie Stille", async () => {
  const { call, timers, handler } = holdHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await p1;
    await tick();
    timers.fireAll();
    await p2;
  });

  assert.equal(sseRole(res1), "assistant");
  assert.equal(sseFinishReason(res1), "stop");
  assert.equal(sseEndsWithDone(res1), true);
  assert.equal(sseContent(res1), "");
});

test("GQ-P17-9: die hold-Zeile meldet extended und traegt keinen Anrufer-/Antworttext (PII)", async () => {
  const { call, timers, handler } = holdHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await p1;
    await tick();
    timers.fireAll();
    await p2;
  });

  const extendedLine = holdLines(lines).find((l) => l.includes(`"outcome":"${TURN_HOLD_OUTCOME.EXTENDED}"`));
  assert.ok(extendedLine, "die unterdrueckten Fragment-Turns sind auszaehlbar");
  assert.ok(extendedLine.includes(`"holdMs":${HOLD_MS}`), "die Frist steht in der Zeile");
  assert.ok(!extendedLine.includes(FRAGMENT_1));
  assert.ok(!extendedLine.includes(FRAGMENT_2));
  assert.ok(!extendedLine.includes(ANSWER));
});

test("GQ-P17-10: Gegenprobe same (Doppelzustellung) -> kein Ueberholen, beide Turns sprechen", async () => {
  const { call, timers, agent, handler } = holdHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_1), res2);
    await tick();
    timers.fireAll();
    await Promise.all([p1, p2]);
  });

  assert.equal(agent.calls.length, 2, "same darf keine Antwort verschlucken");
  assert.equal(sseContent(res1), ANSWER);
  assert.equal(sseContent(res2), ANSWER);
  assert.equal(
    holdLines(lines).some((l) => l.includes(`"outcome":"${TURN_HOLD_OUTCOME.EXTENDED}"`)),
    false,
  );
});

test("GQ-P17-11: Gegenprobe other (neue Aeusserung) -> beide Turns, beide Fristen laufen ab", async () => {
  const { call, timers, agent, handler } = holdHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, "Ganz etwas anderes bitte"), res2);
    await tick();
    timers.fireAll();
    await Promise.all([p1, p2]);
  });

  assert.equal(agent.calls.length, 2);
  assert.equal(sseContent(res1), ANSWER);
  assert.equal(sseContent(res2), ANSWER);
  const elapsed = holdLines(lines).filter((l) => l.includes(`"outcome":"${TURN_HOLD_OUTCOME.ELAPSED}"`));
  assert.equal(elapsed.length, 2, "beide Turns haben ihre Frist ausgewartet");
});

test("GQ-P17-12: Frist 0 -> Bestandsverhalten, zwei Turns, KEINE hold-Zeile", async () => {
  const { call, agent, handler } = holdHarness({ config: holdConfig({ telnyxShimExtendHoldMs: 0 }) });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    await handler(reqText(call, FRAGMENT_1), res1);
    await handler(reqText(call, FRAGMENT_2), res2);
  });

  assert.equal(agent.calls.length, 2, "ohne Frist bleibt die gemessene Doppelantwort bestehen");
  assert.equal(sseContent(res1), ANSWER);
  assert.equal(sseContent(res2), ANSWER);
  assert.equal(holdLines(lines).length, 0, "ausgeschaltete Frist ist log-identisch zum Bestand");
});

test("GQ-P17-13: der ueberholte Turn ruft agentTurn nie und hinterlaesst keine Transkriptzeile", async () => {
  const call = makeCall();
  const { timers, agent, handler } = holdHarness({ call });
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await p1;
    assert.equal(agent.calls.length, 0, "der ueberholte Turn hat kein Token gebrannt");
    await tick();
    timers.fireAll();
    await p2;
  });

  assert.equal(agent.calls.length, 1);
  assert.deepEqual(call.transcript, [], "kein zweiter Turn, keine zweite Zeile");
});

test("GQ-P17-14: gesperrte Kostendecke antwortet sofort - kein Warten, keine hold-Zeile", async () => {
  const call = makeCall();
  const store = fakeStore({ call, budgetExceeded: true });
  const { timers, agent, handler } = holdHarness({ call, store, voiceControl: voiceControlSpy() });
  const res1 = fakeRes();

  const lines = await captureConsole(async () => {
    await handler(reqText(call, FRAGMENT_1), res1); // laeuft OHNE fireAll durch
  });

  assert.equal(agent.calls.length, 0, "kein Modell-Turn hinter der gesperrten Decke");
  assert.equal(timers.pendingCount(), 0, "die Frist liegt hinter dem Gate, nicht davor");
  assert.equal(holdLines(lines).length, 0);
  assert.ok(lines.some((l) => l.includes("[telnyx-shim] gate")));
});

test("GQ-P17-15: ein Provider-Anstoss beendet die Frist nicht - der gehaltene Turn spricht", async () => {
  const { call, timers, agent, handler } = holdHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const nudge = validReq(call, {
      messages: [
        { role: "user", content: FRAGMENT_1 },
        { role: "system", content: "prompt the user to respond" },
      ],
    });
    const p2 = handler(nudge, res2);
    await p2;
    await tick();
    timers.fireAll();
    await p1;
  });

  assert.equal(agent.calls.length, 1, "der gehaltene Turn faehrt, der Anstoss nicht");
  assert.equal(sseContent(res1), ANSWER, "die gehaltene Antwort geht NICHT verloren");
  assert.equal(sseContent(res2), "", "der Anstoss antwortet leer und gueltig");
});

test("GQ-P17-16: die zuvor gesprochene agent-Zeile ueberlebt das Ueberholen (GQ-H1-a)", async () => {
  // Der Vorgaenger wird gleich ueberholt, hat also NIE geantwortet. Ohne die neue
  // Konjunktion loeschte der discarded_answer-Riegel hier die aeltere, tatsaechlich
  // GESPROCHENE Zeile - die Nachrichtenliste des Anbieters ist in beiden Requests
  // gleich lang, also "nicht gewachsen".
  const call = makeCall({ transcript: [{ role: "agent", text: "Guten Tag, hier ist Hermes." }] });
  const { timers, handler } = holdHarness({ call });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await p1;
    await tick();
    timers.fireAll();
    await p2;
  });

  assert.deepEqual(call.transcript, [{ role: "agent", text: "Guten Tag, hier ist Hermes." }]);
  assert.equal(
    lines.some((l) => l.includes("discarded_answer")),
    false,
    "es gab keine verworfene Antwort zu raeumen",
  );
});

test("GQ-P17-17: Latenz-Beleg - die Frist passt unter den Dead-Air-Watchdog", () => {
  // Die ausgelieferten Werte (config.js-Fallbacks), gegen die turn-budget.test.js rechnet.
  const SHIPPED = Object.freeze({
    requestTimeoutMs: 3500,
    maxRetries: 2,
    backoffMs: 250,
    synthTimeoutMs: 2000,
  });
  assert.equal(enforcedTurnWorstCaseMs(SHIPPED), 22750, "ohne Frist unveraendert zum Bestand");
  assert.equal(enforcedTurnWorstCaseMs({ ...SHIPPED, holdMs: HOLD_MS }), 25750);
  // Auch die Obergrenze des Clamps haelt den Watchdog (TELNYX_DEAD_AIR_TIMEOUT_S=45).
  assert.equal(deadAirOverrun({ deadAirTimeoutMs: 45000, holdMs: 3500, ...SHIPPED }), null);
  // Ein zu kurz gesetzter Watchdog wird MIT der Frist gemeldet - sonst uebersaehe der
  // Boot-Waechter genau die Konfiguration, die ihn reisst.
  assert.deepEqual(deadAirOverrun({ deadAirTimeoutMs: 24000, holdMs: HOLD_MS, ...SHIPPED }), {
    worstCaseMs: 25750,
    limitMs: 24000,
    overrunMs: 1750,
  });
});

test("GQ-P17-18: Doku-Parity - .env.example, render.yaml und config-Fallback nennen dieselben 3000 ms", () => {
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  const configSrc = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");

  assert.match(envExample, /TELNYX_SHIM_EXTEND_HOLD_MS=3000\b/);
  assert.match(renderYaml, /key: TELNYX_SHIM_EXTEND_HOLD_MS\s*\n\s*value: "3000"/);
  assert.match(configSrc, /TELNYX_SHIM_EXTEND_HOLD_MS[\s\S]{0,160}fallback:\s*3000/);
});

test("GQ-P17-19: legt der Anrufer waehrend der Frist auf, startet KEIN Modell-Turn", async () => {
  const call = makeCall();
  const { timers, agent, handler } = holdHarness({ call });
  const res1 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    call.status = "completed"; // der Anrufer legt waehrend der Frist auf
    timers.fireAll();
    await p1;
  });

  assert.equal(agent.calls.length, 0, "die Frist oeffnet kein neues Kostenfenster");
  assert.equal(sseContent(res1), "");
  assert.ok(lines.some((l) => l.includes("call_ended_during_hold")));
});
