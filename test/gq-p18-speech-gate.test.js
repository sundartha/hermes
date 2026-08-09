// GQ-P18: Tests fuer die Sprechsperre gegen die fragmentierte Spracherkennung. Ebene 1
// prueft die Sperre selbst gegen einen Fake-Draht, Ebene 2 den Shim-Handler ueber die
// geteilte Fake-Harness (test/telnyx-shim-harness.js). Kein Netz, kein Spawn, keine
// Wanduhr: die Frist laeuft ueber injizierte Timer (P12 Fast/Repeatable).
//
// Der Vorgaenger GQ-P17 hielt den TURN an; seine Tests konnten deshalb pruefen, dass
// agentTurn NICHT gerufen wird. Das ist hier bewusst anders: der Turn LAEUFT, nur das
// Sprechen wartet. Der Vertrag, den diese Datei pinnt, ist entsprechend verschoben - vom
// "kein Modell-Aufruf" zum "kein gesprochenes Wort" (und, neu, "keine Verzoegerung").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeSpeechGate, SPEECH_GATE_OUTCOME } from "../src/telnyx-speech-gate.js";
import { makeInFlightTurnRegistry } from "../src/telnyx-turn-supersede.js";
import { deadAirOverrun, enforcedTurnWorstCaseMs } from "../src/turn-budget.js";
import {
  fakeRes,
  fakeStore,
  fakeTimers,
  makeCall,
  makeHandler,
  validReq,
  sseContent,
  sseRole,
  sseFinishReason,
  sseEndsWithDone,
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import { captureConsole, noopWatchdog } from "./helpers.js";

// ---------- Ebene 1: die Sperre gegen einen Fake-Draht ----------

// Der Draht, reduziert auf das, was die Sperre von ihm braucht (P4: die Sperre haengt an
// einer Abstraktion, nicht am echten SSE-Strom).
function fakeWire() {
  const written = [];
  return { writeChunk: (text) => written.push(text), written };
}

const HOLD_MS = 3000;

// Build-Schritt (P13): Sperre + Draht + Timer + Abbruch-Riegel in einem Griff.
function gateHarness({ holdMs = HOLD_MS } = {}) {
  const wire = fakeWire();
  const timers = fakeTimers();
  const controller = new AbortController();
  const gate = makeSpeechGate({ wire, holdMs, signal: controller.signal, ...timers });
  return { wire, timers, controller, gate };
}

test("GQ-P18-1: Frist 0 -> Durchreichen ohne Timer (Bestandsverhalten, der Rueckweg)", () => {
  const { wire, timers, gate } = gateHarness({ holdMs: 0 });
  gate.write("Guten Tag");
  assert.deepEqual(wire.written, ["Guten Tag"], "ohne Frist geht jedes Fragment sofort raus");
  assert.equal(timers.pendingCount(), 0, "ohne Frist wird kein Timer gestellt");
  assert.equal(gate.outcome(), SPEECH_GATE_OUTCOME.OFF);
});

test("GQ-P18-2: waehrend der Frist bleibt der Draht stumm, danach fliesst der Puffer in Reihenfolge", () => {
  const { wire, timers, gate } = gateHarness();
  gate.write("Einen Moment,");
  gate.write(" ich schaue nach.");
  assert.deepEqual(wire.written, [], "nichts war auf der Leitung");
  assert.equal(gate.bufferedCount(), 2);
  assert.deepEqual(timers.pendingDelays(), [HOLD_MS]);

  timers.fireAll();
  assert.deepEqual(wire.written, ["Einen Moment,", " ich schaue nach."]);
  assert.equal(gate.outcome(), SPEECH_GATE_OUTCOME.RELEASED);
  // Ab jetzt reicht sie durch, ohne zu puffern.
  gate.write(" Es wird sonnig.");
  assert.equal(wire.written.length, 3);
});

test("GQ-P18-3: Turn-Ende vor Fristablauf -> alles raus, Timer geraeumt, outcome flushed", () => {
  const { wire, timers, gate } = gateHarness();
  gate.write("Es wird sonnig.");
  gate.releaseAtTurnEnd();
  assert.deepEqual(wire.written, ["Es wird sonnig."], "die Sperre verzoegert keine Antwort");
  assert.equal(gate.outcome(), SPEECH_GATE_OUTCOME.FLUSHED);
  assert.equal(timers.pendingCount(), 0, "kein Timer bleibt liegen");
  assert.equal(timers.clearedCount(), 1);
});

test("GQ-P18-4: verdraengter Turn -> der Puffer verfaellt, der Draht bleibt leer (der Gewinn)", () => {
  const { wire, controller, gate } = gateHarness();
  gate.write("Morgen wird es sonnig bei 24 Grad.");
  controller.abort(); // ein fortschreibendes Fragment ueberholt diesen Turn
  gate.releaseAtTurnEnd();
  assert.deepEqual(wire.written, [], "der Anrufer hoert die widerrufene Antwort NICHT");
  assert.equal(gate.outcome(), SPEECH_GATE_OUTCOME.SILENCED);
});

test("GQ-P18-5: nach der Verdraengung schreibt auch eine laufende Modellrunde nichts mehr", () => {
  const { wire, controller, gate } = gateHarness();
  controller.abort();
  gate.write("Rest der abgebrochenen Antwort");
  gate.releaseAtTurnEnd();
  assert.deepEqual(wire.written, []);
});

test("GQ-P18-6: nach Fristablauf verdraengt nichts mehr - Gesprochenes ist nicht zurueckholbar", () => {
  const { wire, timers, controller, gate } = gateHarness();
  gate.write("Es wird sonnig.");
  timers.fireAll(); // die Frist laeuft ab, der Satz ist raus
  controller.abort(); // das Fragment kommt ZU SPAET
  gate.releaseAtTurnEnd();
  assert.deepEqual(wire.written, ["Es wird sonnig."], "der Ausgang wird nicht rueckwirkend umgeschrieben");
  assert.equal(gate.outcome(), SPEECH_GATE_OUTCOME.RELEASED);
});

test("GQ-P18-7: hasSilentTurn - reine Abfrage, kein Nebeneffekt (GQ-H1-a haengt daran)", () => {
  const registry = makeInFlightTurnRegistry();
  assert.equal(registry.hasSilentTurn("call_a"), false, "kein laufender Turn");

  let spoken = false;
  const inFlight = registry.beginTurn("call_a", { hasSpokenText: () => spoken });
  assert.equal(registry.hasSilentTurn("call_a"), true, "laeuft und schweigt -> ueberholbar");
  // Die Abfrage darf den Turn NICHT verdraengen (P5).
  assert.equal(inFlight.signal.aborted, false);

  spoken = true;
  assert.equal(registry.hasSilentTurn("call_a"), false, "hat gesprochen -> nicht mehr ueberholbar");

  spoken = false;
  registry.supersedeTurn("call_a");
  assert.equal(registry.hasSilentTurn("call_a"), false, "bereits verdraengt");
});

// ---------- Ebene 2: Shim-Handler ueber die Fake-Harness ----------

// Zwei Aeusserungen im "extends"-Verhaeltnis der Sonde (telnyx-turn-probe.js): der zweite
// Text schreibt den ersten woertlich fort - genau das kumulative nova-3-Zwischenergebnis,
// das am 2026-08-09 zwei Wetterberichte erzeugt hat.
const FRAGMENT_1 = "Wie ist das Wetter";
const FRAGMENT_2 = "Wie ist das Wetter morgen in Muenchen";
const ANSWER = "Morgen wird es sonnig bei 24 Grad";

// Die await-Kette bis zum Turn ist rein Mikrotask-basiert (Call-Aufloesung + Gates);
// setImmediate laeuft danach - der Handler steht dann sicher im Modell-Turn.
const tick = () => new Promise((resolve) => setImmediate(resolve));

function gateConfig(overrides = {}) {
  return fakeTelnyxShimConfig({
    telnyxShimExtendHoldMs: HOLD_MS,
    // Ohne Token-Streaming gibt es keinen Sprech-Draht und damit keine Sperre - der
    // Live-Zustand (AL-P7) ist an.
    telnyxShimTokenStreaming: true,
    ...overrides,
  });
}

function reqText(call, text) {
  return validReq(call, { messages: [{ role: "user", content: text }] });
}

// Ein agentTurn, der wie der echte STREAMT und sich anhalten laesst: erst schiebt er seinen
// Satz auf den Sprech-Draht, dann haengt er, bis der Test ihn freigibt. Nur so kann ein
// zweiter Request den laufenden Turn ueberhaupt antreffen. Der Rueckgabewert spiegelt den
// Vertrag von claude.js (Abbruch -> superseded:true, kein Text).
function streamingAgentTurn() {
  const calls = [];
  const pending = [];
  async function agentTurn(call, callerText, { onSpeechChunk, abortSignal } = {}) {
    calls.push({ call, callerText });
    onSpeechChunk?.(ANSWER);
    await new Promise((resolve) => pending.push(resolve));
    if (abortSignal?.aborted)
      return { speech: "", speechStreamed: false, endCall: false, superseded: true };
    return { speech: ANSWER, speechStreamed: true, endCall: false, superseded: false };
  }
  agentTurn.calls = calls;
  agentTurn.releaseAll = () => pending.splice(0).forEach((resolve) => resolve());
  return agentTurn;
}

// Build-Schritt (P13): Call + Store + Handler mit injizierten Timern.
function shimHarness({ config = gateConfig(), call = makeCall() } = {}) {
  const timers = fakeTimers();
  const agent = streamingAgentTurn();
  const handler = makeHandler({
    store: fakeStore({ call }),
    config,
    agentTurn: agent,
    watchdog: noopWatchdog(),
    speechGateTimers: timers,
  });
  return { call, timers, agent, handler };
}

function holdLines(lines) {
  return lines.filter((l) => l.includes("[telnyx-shim] hold "));
}

test("GQ-P18-8: fortschreibendes Fragment -> der Vorgaenger spricht kein Wort, nur der zweite antwortet", async () => {
  const { call, agent, handler } = shimHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick(); // Turn 1 laeuft und hat seinen Satz in die Sperre geschoben
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  assert.equal(agent.calls.length, 2, "beide Turns LAUFEN - die Sperre haelt nur das Sprechen");
  assert.equal(sseContent(res1), "", "der ueberholte Turn spricht nichts");
  assert.equal(sseContent(res2), ANSWER, "genau EINE gesprochene Antwort");
});

test("GQ-P18-9: die Sperre verzoegert keine Antwort - der Turn antwortet, ohne dass die Frist ablaeuft", async () => {
  const { call, timers, agent, handler } = shimHarness();
  const res = fakeRes();

  await captureConsole(async () => {
    const p = handler(reqText(call, FRAGMENT_1), res);
    await tick();
    agent.releaseAll();
    // KEIN timers.fireAll(): unter der alten Haltefrist (GQ-P17) haette dieser await
    // ewig gehangen - genau die Latenz, die der Owner abgelehnt hat.
    await p;
  });

  assert.equal(sseContent(res), ANSWER);
  assert.equal(timers.pendingCount(), 0, "der Timer wird am Turn-Ende geraeumt");
  assert.equal(timers.clearedCount(), 1);
});

test("GQ-P18-10: die hold-Zeile meldet silenced und traegt keinen Anrufer-/Antworttext (PII)", async () => {
  const { call, agent, handler } = shimHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  const silenced = holdLines(lines).find((l) =>
    l.includes(`"outcome":"${SPEECH_GATE_OUTCOME.SILENCED}"`),
  );
  assert.ok(silenced, "die unterdrueckten Fragment-Turns sind auszaehlbar");
  assert.ok(silenced.includes(`"holdMs":${HOLD_MS}`), "die Frist steht in der Zeile");
  assert.ok(!silenced.includes(FRAGMENT_1));
  assert.ok(!silenced.includes(FRAGMENT_2));
  assert.ok(!silenced.includes(ANSWER));
  // Der zweite Turn war vor seiner Frist fertig - die Sperre hat ihn nichts gekostet.
  assert.ok(
    holdLines(lines).some((l) => l.includes(`"outcome":"${SPEECH_GATE_OUTCOME.FLUSHED}"`)),
    "der Preis ist am Log ablesbar, nicht nur der Gewinn",
  );
});

test("GQ-P18-11: der ueberholte Request liefert eine gueltige, leere Completion - nie Stille", async () => {
  const { call, agent, handler } = shimHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  assert.equal(sseRole(res1), "assistant");
  assert.equal(sseFinishReason(res1), "stop");
  assert.equal(sseEndsWithDone(res1), true);
  assert.equal(sseContent(res1), "");
});

test("GQ-P18-12: Frist 0 -> Bestandsverhalten, beide Turns sprechen, KEINE hold-Zeile", async () => {
  const { call, agent, handler } = shimHarness({
    config: gateConfig({ telnyxShimExtendHoldMs: 0 }),
  });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  // Ohne Sperre ist der Satz von Turn 1 sofort auf der Leitung - der Riegel verweigert
  // (already_spoken), und der Anrufer hoert wieder zwei Antworten. Genau der Defekt.
  assert.equal(sseContent(res1), ANSWER);
  assert.equal(sseContent(res2), ANSWER);
  assert.equal(holdLines(lines).length, 0, "der Bestandslauf bleibt log-identisch");
});

test("GQ-P18-13: Gegenprobe same (Doppelzustellung) -> kein Ueberholen, beide Turns sprechen", async () => {
  const { call, agent, handler } = shimHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_1), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  assert.equal(sseContent(res1), ANSWER, "same darf keine Antwort verschlucken");
  assert.equal(sseContent(res2), ANSWER);
  assert.equal(
    holdLines(lines).some((l) => l.includes(`"outcome":"${SPEECH_GATE_OUTCOME.SILENCED}"`)),
    false,
  );
});

test("GQ-P18-14: Gegenprobe other (neue Aeusserung) -> beide Turns sprechen", async () => {
  const { call, agent, handler } = shimHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, "Ganz etwas anderes bitte"), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  assert.equal(sseContent(res1), ANSWER);
  assert.equal(sseContent(res2), ANSWER);
});

test("GQ-P18-15: nach Fristablauf ist der Turn nicht mehr ueberholbar - beide sprechen", async () => {
  const { call, timers, agent, handler } = shimHarness();
  const res1 = fakeRes();
  const res2 = fakeRes();

  await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    timers.fireAll(); // die Frist laeuft ab, Turn 1 hat gesprochen
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  // Fail-safe-Richtung von GQ-P1, unveraendert: was auf der Leitung war, holt kein
  // Retract-Event zurueck - lieber zwei Antworten als eine halbe.
  assert.equal(sseContent(res1), ANSWER);
  assert.equal(sseContent(res2), ANSWER);
});

test("GQ-P18-16: die zuvor gesprochene agent-Zeile ueberlebt das Ueberholen (GQ-H1-a)", async () => {
  // Der Vorgaenger wird gleich ueberholt und schreibt deshalb NIE eine agent-Zeile. Ohne
  // die Abfrage hasSilentTurn loeschte der discarded_answer-Riegel hier die aeltere,
  // tatsaechlich GESPROCHENE Zeile - die Nachrichtenliste des Anbieters ist in beiden
  // Requests gleich lang, also "nicht gewachsen".
  const call = makeCall({ transcript: [{ role: "agent", text: "Guten Tag, hier ist Hermes." }] });
  const { agent, handler } = shimHarness({ call });
  const res1 = fakeRes();
  const res2 = fakeRes();

  const lines = await captureConsole(async () => {
    const p1 = handler(reqText(call, FRAGMENT_1), res1);
    await tick();
    const p2 = handler(reqText(call, FRAGMENT_2), res2);
    await tick();
    agent.releaseAll();
    await Promise.all([p1, p2]);
  });

  assert.deepEqual(call.transcript, [{ role: "agent", text: "Guten Tag, hier ist Hermes." }]);
  assert.equal(
    lines.some((l) => l.includes("discarded_answer")),
    false,
    "es gab keine verworfene Antwort zu raeumen",
  );
});

test("GQ-P18-17: turn_ok meldet die WAHRE Zahl gestreamter Fragmente, nicht 0", async () => {
  // Die Sonde streamChunks ist die Live-Abnahme der Streaming-Faehigkeit (AL-P7). Wuerde
  // die Sperre erst beim Schreiben der Antwort enden, meldete jeder gepufferte Turn 0 -
  // eine still falsche Sonde. Deshalb endet sie am TURN-Ende, vor dieser Zeile.
  const { call, agent, handler } = shimHarness();
  const res = fakeRes();

  const lines = await captureConsole(async () => {
    const p = handler(reqText(call, FRAGMENT_1), res);
    await tick();
    agent.releaseAll();
    await p;
  });

  const turnOk = lines.find((l) => l.includes("[telnyx-shim] turn_ok "));
  assert.ok(turnOk, "die Betriebszeile steht");
  assert.ok(turnOk.includes('"streamChunks":1'), `gepufferte Fragmente zaehlen mit: ${turnOk}`);
});

test("GQ-P18-18: die Turn-Rechnung traegt keinen Frist-Aufschlag mehr", () => {
  // Die ausgelieferten Werte (config.js-Fallbacks), gegen die turn-budget.test.js rechnet.
  const SHIPPED = Object.freeze({
    requestTimeoutMs: 3500,
    maxRetries: 2,
    backoffMs: 250,
    synthTimeoutMs: 2000,
  });
  // Die Sperre verlaengert den Turn nicht - die Zahl ist wieder die des Bestands VOR
  // GQ-P17, und ein uebergebenes holdMs darf sie nicht mehr veraendern.
  assert.equal(enforcedTurnWorstCaseMs(SHIPPED), 22750);
  assert.equal(enforcedTurnWorstCaseMs({ ...SHIPPED, holdMs: 3500 }), 22750);
  assert.equal(deadAirOverrun({ deadAirTimeoutMs: 45000, ...SHIPPED }), null);
});

test("GQ-P18-19: Doku-Parity - .env.example, render.yaml und config-Fallback nennen dieselben 3000 ms", () => {
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  const configSrc = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");

  assert.match(envExample, /TELNYX_SHIM_EXTEND_HOLD_MS=3000\b/);
  assert.match(renderYaml, /key: TELNYX_SHIM_EXTEND_HOLD_MS\s*\n\s*value: "3000"/);
  assert.match(configSrc, /TELNYX_SHIM_EXTEND_HOLD_MS[\s\S]{0,160}fallback:\s*3000/);
});
