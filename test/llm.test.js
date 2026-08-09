// Seam-Unit-Tests fuer src/llm.js (P3b-R Schicht 2). Reine node:test-Unit gegen
// Fakes (DIP) - KEIN Server-Spawn, KEIN pglite: schnell, offline, deterministisch
// (P12 F.I.R.S.T.; injizierte sleep/random/now/messagesCreate statt echter Zeit/Netz).
//
// Scope-Abgrenzung (bewusst): Der echte HTTP-Premature-close-Mock (chunked ohne
// Content-Length + res.socket.destroy()) gehoert zu CP4 (Server-Spawn, end-to-end
// Pfad). Hier wuerde er keinen Konsumenten haben (tote Test-Infra, G12). isTransient
// wird stattdessen gegen die reine, VERIFIZIERTE Fehler-Form geprueft (FetchError-Shape
// direkt konstruiert) - schneller und stabiler als ein echter HTTP-Round-Trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { isTransient, withRetry, createLlmClient, LlmUnavailableError } from "../src/llm.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

// --- Test-Doubles (lokal, Single-Consumer-Konvention) ---

// Rohe node-fetch-FetchError-Form: message "Premature close" + ERR_STREAM_PREMATURE_CLOSE,
// KEIN status, KEIN APIError (die verifizierte Shape aus dem Parse-Pfad des SDK 0.39).
function prematureClose() {
  return { message: "Premature close", code: "ERR_STREAM_PREMATURE_CLOSE" };
}
// SDK-APIError-Subklassen tragen .status (HTTP-Status); hier minimal nachgebildet.
function apiError(status) {
  return { status, message: `HTTP ${status}` };
}
// Echte APIConnectionError-Instanz (status undefined) - prueft gegen die reale Klasse.
function connError() {
  return new Anthropic.APIConnectionError({ message: "connection failed" });
}
// Minimale Anbieter-Antwort. Seit B3a liefert complete() ein LlmTurn (llm/ports.js), also
// wird auf turn.text geprueft statt auf ein durchgereichtes Rohfeld.
function okResponse() {
  return {
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

// sleep-Fake: zaehlt Aufrufe + Delays, schlaeft NICHT real (synchron resolved).
function fakeSleep() {
  const calls = [];
  const fn = (ms) => {
    calls.push(ms);
    return Promise.resolve();
  };
  fn.calls = calls;
  return fn;
}

// Minimal-Config mit den sechs LLM-Feldern (deterministisch, kein echter Backoff).
function llmConfig(overrides = {}) {
  return withConfigNamespaces({
    llmRequestTimeoutMs: 3500,
    llmMaxRetries: 2,
    llmBackoffMs: 1,
    llmBreakerThreshold: 5,
    llmBreakerWindowMs: 10000,
    llmBreakerCooldownMs: 30000,
    ...overrides,
  });
}

// Standard-withRetry-Optionen mit injizierten Fakes; max/baseMs ueberschreibbar.
function retryOpts({ sleep, max = 2, baseMs = 1, jitter = false, random = () => 0 } = {}) {
  return { max, baseMs, jitter, retryable: isTransient, sleep: sleep || fakeSleep(), random };
}

// --- T-CP2-1..4: isTransient-Klassifikation ---

test("T-CP2-1: isTransient klassifiziert Premature-close-FetchError als transient", () => {
  assert.equal(isTransient(prematureClose()), true);
});

test("T-CP2-2: isTransient klassifiziert APIConnectionError als transient", () => {
  assert.equal(isTransient(connError()), true);
});

test("T-CP2-3: isTransient klassifiziert HTTP-Status korrekt (transient vs. nicht)", () => {
  for (const s of [408, 409, 429, 500, 502, 503])
    assert.equal(isTransient(apiError(s)), true, `status ${s} sollte transient sein`);
  for (const s of [400, 401, 403, 404, 422])
    assert.equal(isTransient(apiError(s)), false, `status ${s} sollte NICHT transient sein`);
});

test("T-CP2-4: isTransient folgt verschachtelter cause (ECONNRESET) als transient", () => {
  assert.equal(isTransient({ message: "wrapped", cause: { code: "ECONNRESET" } }), true);
  assert.equal(isTransient(null), false);
});

// --- T-CP2-5..8: withRetry ---

test("T-CP2-5: withRetry retriet bei transient und gibt nach Erfolg zurueck", async () => {
  const sleep = fakeSleep();
  let calls = 0;
  const fn = () => {
    calls += 1;
    if (calls === 1) throw prematureClose();
    return "ok";
  };
  const out = await withRetry(fn, retryOpts({ sleep }), null);
  assert.equal(out, "ok");
  assert.equal(calls, 2);
  assert.equal(sleep.calls.length, 1);
});

test("T-CP2-6: withRetry wirft bei nicht-transient sofort, kein sleep", async () => {
  const sleep = fakeSleep();
  let calls = 0;
  const fn = () => {
    calls += 1;
    throw apiError(400);
  };
  await assert.rejects(
    () => withRetry(fn, retryOpts({ sleep }), null),
    (e) => e.status === 400,
  );
  assert.equal(calls, 1);
  assert.equal(sleep.calls.length, 0);
});

test("T-CP2-7: withRetry haelt die Obergrenze ein (1 + max Versuche)", async () => {
  const sleep = fakeSleep();
  let calls = 0;
  const fn = () => {
    calls += 1;
    throw prematureClose();
  };
  await assert.rejects(
    () => withRetry(fn, retryOpts({ sleep, max: 2 }), null),
    (e) => e.message === "Premature close",
  );
  assert.equal(calls, 3); // 1 + max
  assert.equal(sleep.calls.length, 2);
});

test("T-CP2-8: withRetry-Jitter-Backoff ist via injiziertem random deterministisch", async () => {
  const sleep = fakeSleep();
  let calls = 0;
  const fn = () => {
    calls += 1;
    throw prematureClose();
  };
  // random=0.5, baseMs=100, jitter=true: delay = floor(0.5 * 100*2^attempt) = 50, 100.
  await assert.rejects(() =>
    withRetry(fn, retryOpts({ sleep, max: 2, baseMs: 100, jitter: true, random: () => 0.5 }), null),
  );
  assert.deepEqual(sleep.calls, [50, 100]);
});

// --- T-CP2-9..13: complete / Breaker / Metrik (ueber injiziertes messagesCreate) ---

// Baut einen Client mit Fake-SDK-Aufruf + injizierter sleep, sammelt Metrik-Calls.
function clientWith({ create, config = llmConfig() } = {}) {
  const metricCalls = [];
  const client = createLlmClient({
    config,
    sleep: fakeSleep(),
    metrics: { llmCall: (m) => metricCalls.push(m) },
    messagesCreate: create,
  });
  return { client, metricCalls };
}

test("T-CP2-9: Breaker oeffnet nach threshold transienten Fehlern -> Folge-Call wirft circuit-open ohne weiteren SDK-Call", async () => {
  let sdkCalls = 0;
  const config = llmConfig({ llmBreakerThreshold: 2, llmMaxRetries: 0 });
  const { client } = clientWith({
    config,
    create: () => {
      sdkCalls += 1;
      return Promise.reject(prematureClose());
    },
  });
  // Zwei fehlschlagende complete()-Calls saettigen den Breaker (threshold=2, je 1 SDK-Call).
  await assert.rejects(() => client.complete({}), LlmUnavailableError);
  await assert.rejects(() => client.complete({}), LlmUnavailableError);
  const callsAfterSaturation = sdkCalls;
  // Folge-Call: Breaker open -> sofortiger circuit-open-Throw, KEIN weiterer SDK-Call.
  await assert.rejects(
    () => client.complete({}),
    (e) => e instanceof LlmUnavailableError && e.reason === "circuit-open",
  );
  assert.equal(sdkCalls, callsAfterSaturation);
});

test("T-CP2-10: Breaker open -> nach Cooldown half-open eine Probe -> Erfolg schliesst ihn", async () => {
  // Echter Cooldown waere 30 s; hier kurz halten und Date.now ueber das Fenster bewegen
  // ist nicht injizierbar (Breaker nutzt Date.now). Stattdessen Cooldown=0 -> isOpen()
  // laesst SOFORT die half-open-Probe zu; Erfolg der Probe schliesst den Breaker wieder.
  let attempt = 0;
  const config = llmConfig({ llmBreakerThreshold: 1, llmMaxRetries: 0, llmBreakerCooldownMs: 0 });
  const { client } = clientWith({
    config,
    create: () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(prematureClose());
      return Promise.resolve(okResponse());
    },
  });
  await assert.rejects(() => client.complete({}), LlmUnavailableError); // oeffnet (threshold=1)
  const probe = await client.complete({}); // half-open-Probe geht durch -> closed
  assert.equal(probe.text, "ok");
  const again = await client.complete({}); // wieder normal verfuegbar
  assert.equal(again.text, "ok");
});

test("T-CP2-11: complete mappt erschoepfte transiente Fehler auf LlmUnavailableError(retries-exhausted)", async () => {
  const { client } = clientWith({
    config: llmConfig({ llmMaxRetries: 1, llmBreakerThreshold: 99 }),
    create: () => Promise.reject(prematureClose()),
  });
  await assert.rejects(
    () => client.complete({}),
    (e) => e instanceof LlmUnavailableError && e.reason === "retries-exhausted",
  );
});

test("T-CP2-12: complete propagiert nicht-transienten Fehler (400) unveraendert (kein Wrap)", async () => {
  const { client } = clientWith({
    create: () => Promise.reject(apiError(400)),
  });
  await assert.rejects(
    () => client.complete({}),
    (e) => e.status === 400 && !(e instanceof LlmUnavailableError),
  );
});

test("T-I13-1: complete streift callId vor dem SDK-Call ab (kein unbekanntes Feld im Provider-Request)", async () => {
  let received;
  const { client } = clientWith({
    create: (params) => {
      received = params;
      return Promise.resolve({ id: "x" });
    },
  });
  await client.complete({ callId: "call_42", model: "m", max_tokens: 10 });
  assert.deepEqual(received, { model: "m", max_tokens: 10 }, "callId darf das SDK nie erreichen");
});

test("T-I13-2: Metrik traegt bei Erfolg callId + Cache-Zaehler aus resp.usage (additiv)", async () => {
  const { client, metricCalls } = clientWith({
    create: () =>
      Promise.resolve({
        id: "x",
        usage: {
          input_tokens: 5,
          output_tokens: 7,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 100,
        },
      }),
  });
  await client.complete({ callId: "call_42" });
  assert.equal(metricCalls.length, 1);
  const m = metricCalls[0];
  assert.equal(m.callId, "call_42");
  assert.equal(m.cache_creation_input_tokens, 20);
  assert.equal(m.cache_read_input_tokens, 100);
  assert.equal(m.outcome, "success");
});

test("T-I13-3: ohne callId/Cache-Felder bleibt die Metrik-Form byte-identisch (nur die vier Basis-Felder)", async () => {
  const { client, metricCalls } = clientWith({ create: () => Promise.resolve({ id: "x" }) });
  await client.complete({});
  assert.deepEqual(Object.keys(metricCalls[0]).sort(), [
    "attempts",
    "breakerState",
    "latencyMs",
    "outcome",
  ]);
});

test("T-I13-4: Fehlerpfad traegt callId, aber KEINE Cache-Zaehler (keine Response vorhanden)", async () => {
  const { client, metricCalls } = clientWith({ create: () => Promise.reject(apiError(401)) });
  await assert.rejects(() => client.complete({ callId: "call_42" }));
  const m = metricCalls[0];
  assert.equal(m.callId, "call_42");
  assert.equal(m.outcome, "non-transient");
  assert.ok(!("cache_creation_input_tokens" in m));
  assert.ok(!("cache_read_input_tokens" in m));
});

// S1-10: Der Breaker-open-Zweig in complete() emittiert eine STRUKTURELL abweichende
// Metrik-Payload (outcome/attempts/breakerState, OHNE latencyMs) - anders als success/
// non-transient (die immer latencyMs tragen, da eine echte Messung stattfand). Diese
// Form ist bisher nirgends festgenagelt.
test("S1-10: Breaker-open-Metrik traegt outcome/attempts/breakerState, KEIN latencyMs", async () => {
  const config = llmConfig({ llmBreakerThreshold: 1, llmMaxRetries: 0 });
  const { client, metricCalls } = clientWith({
    config,
    create: () => Promise.reject(prematureClose()),
  });
  await assert.rejects(() => client.complete({}), LlmUnavailableError); // saettigt + oeffnet den Breaker
  const before = metricCalls.length;
  await assert.rejects(
    () => client.complete({}),
    (e) => e instanceof LlmUnavailableError && e.reason === "circuit-open",
  );
  assert.equal(metricCalls.length, before + 1, "genau EINE Metrik fuer den Breaker-open-Call");
  const m = metricCalls[metricCalls.length - 1];
  assert.equal(m.outcome, "breaker-open");
  assert.equal(m.attempts, 0);
  assert.equal(m.breakerState, "open");
  assert.deepEqual(Object.keys(m).sort(), ["attempts", "breakerState", "outcome"]);
});

test("T-CP2-13: Metrik-Stub wird je Outcome einmal mit der fixierten Form gerufen (kein PII)", async () => {
  // Erfolg
  const ok = clientWith({ create: () => Promise.resolve({ id: "x" }) });
  await ok.client.complete({ secret: "do-not-leak" });
  assert.equal(ok.metricCalls.length, 1);
  const m = ok.metricCalls[0];
  assert.equal(m.outcome, "success");
  assert.equal(typeof m.attempts, "number");
  assert.equal(typeof m.latencyMs, "number");
  assert.equal(typeof m.breakerState, "string");
  // Form-Fixierung: keine rohen params/keine Secrets in der Metrik.
  assert.deepEqual(Object.keys(m).sort(), ["attempts", "breakerState", "latencyMs", "outcome"]);

  // Nicht-transient
  const bad = clientWith({ create: () => Promise.reject(apiError(401)) });
  await assert.rejects(() => bad.client.complete({}));
  assert.equal(bad.metricCalls.length, 1);
  assert.equal(bad.metricCalls[0].outcome, "non-transient");
});
