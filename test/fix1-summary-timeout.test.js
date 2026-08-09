// FIX-1 Teil 1: die Gespraechs-Zusammenfassung fuehrt ihren EIGENEN Per-Request-Timeout
// mit (config.llm.summaryTimeoutMs), nicht den Sprechpfad-Timeout (llmRequestTimeoutMs).
// Gemessen wird am echten Pfad: ein lokaler HTTP-Mock verzoegert die Antwort so, dass sie
// unter dem Sprechpfad-Timeout SICHER stirbt und unter dem Zusammenfassungs-Timeout SICHER
// durchkommt. Rotprobe (Spec): summaryLlm zurueck auf llmRequestTimeoutMs biegen -> FIX1-1 rot.
//
// Rein in-process (kein Server-Spawn, kein pglite) - dieselbe Naht wie
// test/c1-auftragstreue.test.js: ANTHROPIC_BASE_URL + DATA_DIR vor dem ersten
// config-Import setzen, dann dynamischer Import der reinen Funktionen.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_fix1";
const GOAL = "Rueckruf vereinbaren";
const TRANSCRIPT = [
  { role: "agent", text: "Koennen wir einen Rueckruftermin vereinbaren?" },
  { role: "caller", text: "Ja, gerne morgen Vormittag." },
];

const SPEECH_PATH_TIMEOUT_MS = 50; // absichtlich winzig: nur so ist der Beweis scharf
const SUMMARY_TIMEOUT_MS = 1200;
const MOCK_FAST_DELAY_MS = 400; // > 50 (Sprechpfad tot), << 1200 (Zusammenfassung lebt)
const MOCK_SLOW_DELAY_MS = 3000; // > 1200 -> auch die eigene Frist greift wirklich

const MOCK_DECISION = { summary: "Rueckruf vereinbart.", actionItems: [], objective_achieved: true };

function anthropicMessage() {
  return {
    id: "msg_fix1_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: JSON.stringify(MOCK_DECISION) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

let mode = "fast"; // "fast" | "slow"
let server;
const pending = new Set();
let summarizeCall, store, LlmUnavailableError;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      body; // Body wird nicht gebraucht (Prompt-Grounding ist nicht Gegenstand dieses Tests)
      const delay = mode === "slow" ? MOCK_SLOW_DELAY_MS : MOCK_FAST_DELAY_MS;
      const timer = setTimeout(() => {
        pending.delete(timer);
        // Nach einem SDK-Abort darf nicht auf einen toten Socket geschrieben werden.
        if (res.writableEnded || res.destroyed) return;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(anthropicMessage()));
      }, delay);
      pending.add(timer);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  // Env VOR dem ersten config-Import: Sprechpfad-Timeout winzig, Zusammenfassungs-Timeout
  // im mittleren Fenster, kein Backoff-Wartezeit, Breaker praktisch nie offen (Test-
  // Reihenfolge-Unabhaengigkeit, Muster cq-p8).
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-fix1-key";
  process.env.LLM_REQUEST_TIMEOUT_MS = String(SPEECH_PATH_TIMEOUT_MS);
  process.env.CALL_SUMMARY_TIMEOUT_MS = String(SUMMARY_TIMEOUT_MS);
  process.env.LLM_BACKOFF_MS = "1";
  process.env.LLM_BREAKER_THRESHOLD = "100";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [seedCall({ id: CALL_ID, direction: "outbound", goal: GOAL, transcript: TRANSCRIPT })],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ summarizeCall } = await import("../src/claude.js"));
  ({ LlmUnavailableError } = await import("../src/llm.js"));
});

after(async () => {
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  await new Promise((r) => server.close(r));
});

test("FIX1-1: summarizeCall ueberlebt eine Antwort, die den Sprechpfad-Timeout reisst", async () => {
  mode = "fast";
  const r = await summarizeCall(store.getCall(CALL_ID));
  assert.equal(r.summary, MOCK_DECISION.summary);
});

test("FIX1-2: der eigene Timeout ist ARMIERT - jenseits von summaryTimeoutMs bricht der Aufruf ab", async () => {
  mode = "slow";
  await assert.rejects(
    () => summarizeCall(store.getCall(CALL_ID)),
    (e) => e instanceof LlmUnavailableError && e.reason === "retries-exhausted",
  );
});

test("FIX1-3: der Sprechpfad-Timeout bleibt unveraendert 3500 ms (Code-Fallback + Doku-Parity)", () => {
  const configSrc = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
  assert.match(configSrc, /LLM_REQUEST_TIMEOUT_MS[\s\S]{0,200}fallback:\s*3500/);
  assert.match(configSrc, /CALL_SUMMARY_TIMEOUT_MS[\s\S]{0,400}fallback:\s*20000/);

  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /^CALL_SUMMARY_TIMEOUT_MS=20000$/m);

  const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(renderYaml, /key: CALL_SUMMARY_TIMEOUT_MS\s*\n\s*value: "20000"/);
});
