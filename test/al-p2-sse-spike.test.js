// AL-P2 (SSE-Spike): der BEFRISTETE Verzoegerungs-Schalter im Shim-Antwortpfad. Er misst,
// ob Telnyx unseren SSE-Strom inkrementell konsumiert oder bis data:[DONE] puffert - und ist
// die einzige Stelle dieser Phase, an der ein echter Anruf betroffen sein KOENNTE. Genau das
// pinnen diese Tests: der Schalter greift ausschliesslich fuer die konfigurierte Wegwerf-
// Zielnummer, NIE auf einem Notaus-Pfad, ist bei Default-Config byte-identisch zum Bestand
// und nie stumm. Fake-basiert (kein Netz), bis auf den Boot-Refusal-Spawn am Ende.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sseSpikeDelayMsFor, splitAtFirstSentence } from "../src/telnyx-llm-shim.js";
import { configFatalErrors, e164Env, productionFootguns } from "../src/config.js";
import { sseSpikeBannerLine } from "../src/boot.js";
import { LlmUnavailableError } from "../src/llm.js";
import { noopWatchdog, startServerExpectExit } from "./helpers.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import {
  agentTurnSpy,
  fakeRes,
  fakeStore,
  jsonCompletion,
  makeCall,
  makeHandler,
  sleepSpy,
  sseChunks,
  sseContent,
  sseEndsWithDone,
  sseFinishReason,
  validReq,
  voiceControlSpy,
} from "./telnyx-shim-harness.js";

// Wegwerf-Zielnummer des Spikes (Testwert, NICHT die reale DID aus der Checkliste).
const SPIKE_CALLEE = "+15550000001";
const OTHER_CALLEE = "+15550000002";
const SPIKE_DELAY_MS = 8000;
const TURN_SPEECH = "Guten Tag. Ich habe eine Frage zum Termin.";

// Armierter Spike: Verzoegerung UND Zielnummer gesetzt.
function armedConfig(overrides = {}) {
  return fakeTelnyxShimConfig({
    telnyxSseSpikeDelayMs: SPIKE_DELAY_MS,
    telnyxSseSpikeCallee: SPIKE_CALLEE,
    ...overrides,
  });
}

// Ein fertig verdrahteter Shim mit Fake-Pause statt echter Wartezeit (EINE Aufbau-Stelle,
// G5). res/sleep gehoeren zusammen: sleepSpy protokolliert, wie viele Chunks zum Zeitpunkt
// der Pause schon am Draht standen.
function spikeShim({ call, config = armedConfig(), store, agentTurn, watchdog } = {}) {
  const res = fakeRes();
  const sleep = sleepSpy(res);
  const handler = makeHandler({
    store: store ?? fakeStore({ call }),
    config,
    agentTurn: agentTurn ?? agentTurnSpy({ speech: TURN_SPEECH, endCall: false }),
    voiceControl: voiceControlSpy(),
    watchdog,
    sleep,
  });
  return { call, handler, res, sleep };
}

// Ein Turn gegen einen aufgebauten Shim; liefert dasselbe Objekt zurueck (res/sleep gefuellt).
async function runTurn(setup, body) {
  await setup.handler(validReq(setup.call, body), setup.res);
  return setup;
}

// Erfasst alle drei Console-Kanaele und restauriert sie immer (Muster
// telnyx-llm-shim.test.js withConsoleCapture, F.I.R.S.T.).
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

// === sseSpikeDelayMsFor: die EINE Stelle, die ueber Betroffenheit entscheidet ===========

test("AL-P2-1: Default-Config (0 / leer) -> keine Verzoegerung", () => {
  const call = makeCall({ to: SPIKE_CALLEE });

  assert.equal(sseSpikeDelayMsFor(call, fakeTelnyxShimConfig().telnyxAssistant), 0);
  assert.equal(sseSpikeDelayMsFor(call, undefined), 0, "fehlende Assistant-Config -> 0");
});

test("AL-P2-2: Verzoegerung OHNE Zielnummer -> wirkungslos (fail-safe, kein globaler Schalter)", () => {
  const assistant = fakeTelnyxShimConfig({ telnyxSseSpikeDelayMs: SPIKE_DELAY_MS }).telnyxAssistant;

  assert.equal(sseSpikeDelayMsFor(makeCall({ to: SPIKE_CALLEE }), assistant), 0);
  assert.equal(sseSpikeDelayMsFor(makeCall({ to: OTHER_CALLEE }), assistant), 0);
});

test("AL-P2-3: Zielnummer gesetzt, aber der Call geht woanders hin -> keine Verzoegerung", () => {
  const assistant = armedConfig().telnyxAssistant;

  assert.equal(sseSpikeDelayMsFor(makeCall({ to: OTHER_CALLEE }), assistant), 0);
  assert.equal(sseSpikeDelayMsFor(makeCall({ to: undefined }), assistant), 0, "Call ohne Ziel -> 0");
  assert.equal(sseSpikeDelayMsFor(null, assistant), 0, "kein Call -> 0");
});

test("AL-P2-4: exakter Treffer auf die Wegwerf-Nummer -> die konfigurierte Verzoegerung", () => {
  const assistant = armedConfig().telnyxAssistant;

  assert.equal(sseSpikeDelayMsFor(makeCall({ to: SPIKE_CALLEE }), assistant), SPIKE_DELAY_MS);
});

// === splitAtFirstSentence ==============================================================

test("AL-P2-5: Split am ersten Satzende - mit/ohne Satzende, leer, mehrere Saetze", () => {
  assert.deepEqual(splitAtFirstSentence("Hallo. Und Tschuess."), {
    head: "Hallo. ",
    tail: "Und Tschuess.",
  });
  assert.deepEqual(splitAtFirstSentence("Kein Satzende"), { head: "Kein Satzende", tail: "" });
  assert.deepEqual(splitAtFirstSentence(""), { head: "", tail: "" });
  assert.deepEqual(splitAtFirstSentence("Eins! Zwei? Drei."), { head: "Eins! ", tail: "Zwei? Drei." });
  assert.deepEqual(splitAtFirstSentence(undefined), { head: "", tail: "" }, "Nicht-String -> leer");
});

// === Draht-Verhalten ===================================================================

test("AL-P2-6: Spike AUS -> Sequenz byte-identisch zum Bestand, sleep nie gerufen", async () => {
  const { res, sleep } = await runTurn(
    spikeShim({ call: makeCall({ to: SPIKE_CALLEE }), config: fakeTelnyxShimConfig() }),
  );

  const chunks = sseChunks(res);
  assert.equal(chunks.length, 3, "role + EIN content + finish");
  assert.equal(chunks[0].choices[0].delta.role, "assistant");
  assert.equal(chunks[1].choices[0].delta.content, TURN_SPEECH, "voller Text in EINEM Chunk");
  assert.deepEqual(chunks[2].choices[0].delta, {});
  assert.equal(sseFinishReason(res), "stop");
  assert.ok(sseEndsWithDone(res));
  assert.equal(sleep.calls.length, 0, "ohne Spike gibt es keinen Timer");
});

test("AL-P2-7: Spike AN -> genau 1 Pause mit delayMs, NACH dem ersten Sprech-Chunk", async () => {
  const { sleep } = await runTurn(spikeShim({ call: makeCall({ to: SPIKE_CALLEE }) }));

  assert.equal(sleep.calls.length, 1);
  assert.equal(sleep.calls[0].ms, SPIKE_DELAY_MS);
  assert.equal(sleep.calls[0].chunksBefore, 2, "role + erster Sprech-Chunk standen schon am Draht");
});

test("AL-P2-8: Spike AN -> kein Text geht verloren, finish/[DONE] bleiben korrekt", async () => {
  const { res } = await runTurn(spikeShim({ call: makeCall({ to: SPIKE_CALLEE }) }));

  assert.equal(sseContent(res), TURN_SPEECH, "head + tail ergeben exakt den Turn-Text");
  assert.equal(sseFinishReason(res), "stop");
  assert.ok(sseEndsWithDone(res));
  assert.equal(sseChunks(res).length, 4, "role + head + tail + finish");
});

test("AL-P2-9: Spike armiert, Call geht an eine ANDERE Nummer -> Bestandssequenz, keine Pause", async () => {
  const { res, sleep } = await runTurn(spikeShim({ call: makeCall({ to: OTHER_CALLEE }) }));

  assert.equal(sleep.calls.length, 0, "ein echter Kundenanruf darf NIE verzoegert werden");
  assert.equal(sseChunks(res).length, 3);
  assert.equal(sseContent(res), TURN_SPEECH);
});

test("AL-P2-10: stream:false + armiert -> plain JSON, keine Pause (kein Chunk-Layout da)", async () => {
  const { res, sleep } = await runTurn(spikeShim({ call: makeCall({ to: SPIKE_CALLEE }) }), {
    stream: false,
  });

  assert.equal(sleep.calls.length, 0);
  assert.equal(jsonCompletion(res).choices[0].message.content, TURN_SPEECH);
});

test("AL-P2-11: verzoegerte Antwort loggt sse_spike_delay - ohne Rufnummer, ohne Sprechtext", async () => {
  const setup = spikeShim({ call: makeCall({ to: SPIKE_CALLEE }) });

  const lines = await withConsoleCapture(() => runTurn(setup));

  const spikeLines = lines.filter((l) => l.includes("[telnyx-shim] sse_spike_delay"));
  assert.equal(spikeLines.length, 1);
  assert.ok(spikeLines[0].includes(`"callId":"${setup.call.id}"`));
  assert.ok(spikeLines[0].includes(`"delayMs":${SPIKE_DELAY_MS}`));
  const joined = lines.join("\n");
  assert.ok(!joined.includes(SPIKE_CALLEE), "keine Rufnummer im Log (PII)");
  assert.ok(!joined.includes("Termin"), "kein Sprechtext im Log (PII)");
});

// === Notaus-Pfade bleiben sofortig (Regel 1) ===========================================

test("AL-P2-12: Rate-Gate, Budget-Kill und Loop-Guard verzoegern NIE - auch nicht fuer die Spike-Nummer", async () => {
  const call = makeCall({ to: SPIKE_CALLEE });

  // Rate-Gate: Limit 1 -> der ZWEITE Turn desselben Calls wird ohne agentTurn abgewiesen.
  // Gezaehlt wird der Zuwachs NACH dem ersten (regulaer verzoegerten) Turn.
  const rate = spikeShim({ call, config: armedConfig({ telnyxShimMaxTurnsPerMin: 1 }) });
  await runTurn(rate);
  const pausesBeforeRateGate = rate.sleep.calls.length;
  await runTurn(rate);
  assert.equal(rate.sleep.calls.length, pausesBeforeRateGate, "rate_limited darf nicht warten");

  // Budget-Kill (Tenant-Achse) VOR dem Turn.
  const budget = await runTurn(spikeShim({ call, store: fakeStore({ call, budgetExceeded: true }) }));
  assert.equal(budget.sleep.calls.length, 0, "budget_tenant darf nicht warten");

  // Loop-Guard: der Watchdog meldet den Leer-Turn-Streak.
  const loop = await runTurn(
    spikeShim({
      call,
      watchdog: { ...noopWatchdog(), observeTurn: () => ({ loopExceeded: true, turnSeq: 9 }) },
    }),
  );
  assert.equal(loop.sleep.calls.length, 0, "loop_guard darf nicht warten");
});

test("AL-P2-13: agentTurn wirft -> Degradations-Antwort ohne Pause", async () => {
  async function throwingTurn() {
    throw new LlmUnavailableError("Breaker offen");
  }
  const setup = spikeShim({ call: makeCall({ to: SPIKE_CALLEE }), agentTurn: throwingTurn });

  await withConsoleCapture(() => runTurn(setup));

  assert.equal(setup.sleep.calls.length, 0, "die Degradation ist kein Spike-Gegenstand");
  assert.equal(sseChunks(setup.res).length, 3, "Bestandssequenz der Degradation");
});

// === Config-Kanten =====================================================================

test("AL-P2-14: e164Env - leer, gueltig (getrimmt), ungueltig (genau 1 Fatal ohne Wert)", () => {
  assert.equal(e164Env("TELNYX_SSE_SPIKE_CALLEE", undefined), "");
  assert.equal(e164Env("TELNYX_SSE_SPIKE_CALLEE", ""), "");
  assert.equal(e164Env("TELNYX_SSE_SPIKE_CALLEE", `  ${SPIKE_CALLEE}\n`), SPIKE_CALLEE);

  const before = configFatalErrors().length;
  assert.equal(e164Env("TELNYX_SSE_SPIKE_CALLEE", "0170-kaputt"), "");
  const added = configFatalErrors().slice(before);
  assert.equal(added.length, 1, "genau ein Fatal-Befund");
  assert.match(added[0], /TELNYX_SSE_SPIKE_CALLEE/);
  assert.ok(!added[0].includes("0170-kaputt"), "der Wert (PII) darf NIE in der Diagnose stehen");
});

test("AL-P2-15: productionFootguns - Verzoegerung ohne Zielnummer ist im Hosting fatal", () => {
  // Produktionssichere Basis (Muster config-prod-footguns.test.js SAFE_PROD): variiert wird
  // NUR der Spike; gefiltert wird auf seine Diagnose, damit der Test isoliert bleibt.
  const safeProd = {
    auth: { dashboardPassword: "geheim", mcpAuth: "", oauthIssuerUrl: "" },
    safety: { skipTwilioSignatureCheck: false },
    store: { storeBackend: "pg" },
  };
  const withSpike = (sseSpikeDelayMs, sseSpikeCallee) => ({
    ...safeProd,
    telnyx: { telnyxAssistant: { sseSpikeDelayMs, sseSpikeCallee } },
  });
  const spikeErrors = (cfg, isProduction) =>
    productionFootguns(cfg, isProduction).filter((e) => e.includes("TELNYX_SSE_SPIKE"));

  const errors = spikeErrors(withSpike(SPIKE_DELAY_MS, ""), true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /TELNYX_SSE_SPIKE_DELAY_MS/);
  assert.match(errors[0], /TELNYX_SSE_SPIKE_CALLEE/);
  assert.deepEqual(spikeErrors(withSpike(SPIKE_DELAY_MS, SPIKE_CALLEE), true), [], "mit Zielnummer erlaubt");
  assert.deepEqual(spikeErrors(withSpike(0, ""), true), [], "Schalter aus -> kein Footgun");
  assert.deepEqual(spikeErrors(withSpike(SPIKE_DELAY_MS, ""), false), [], "lokal bleibt es erlaubt");
});

test("AL-P2-16: sseSpikeBannerLine - aus/armiert/wirkungslos, nie die Rufnummer", () => {
  assert.equal(sseSpikeBannerLine({ sseSpikeDelayMs: 0, sseSpikeCallee: "" }), "");

  const armed = sseSpikeBannerLine({ sseSpikeDelayMs: SPIKE_DELAY_MS, sseSpikeCallee: SPIKE_CALLEE });
  assert.match(armed, /AKTIV/);
  assert.ok(armed.includes(`${SPIKE_DELAY_MS} ms`), "die Verzoegerung steht im Banner");
  assert.ok(!armed.includes(SPIKE_CALLEE), "kein PII im Boot-Banner");

  const inert = sseSpikeBannerLine({ sseSpikeDelayMs: SPIKE_DELAY_MS, sseSpikeCallee: "" });
  assert.match(inert, /wirkungslos/);
  assert.match(inert, /TELNYX_SSE_SPIKE_CALLEE/);
});

test("AL-P2-17: Hosting + Verzoegerung ohne Zielnummer -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      RENDER_EXTERNAL_URL: "https://agent.onrender.com",
      DASHBOARD_PASSWORD: "prod-geheim",
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_SSE_SPIKE_DELAY_MS: String(SPIKE_DELAY_MS),
    },
  });

  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /TELNYX_SSE_SPIKE_DELAY_MS/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});
