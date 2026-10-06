import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { config } from "../src/config.js";
import { noteLlmBillingOutage } from "../src/llm-billing-outage.js";
import { markBillingBlocked } from "../src/llm/billing-latch.js";
import { makeConfigOverrides, startServer, seedState, seedCall } from "./helpers.js";
import { LOCALES } from "../src/i18n/locales.js";

const { withConfigOverrides } = makeConfigOverrides(config);
const TEST_DEEPSEEK_KEY = "sk-fw2-alarm-dummy";

function withConsoleCapture(run) {
  const lines = [];
  const orig = { warn: console.warn, log: console.log, error: console.error };
  const grab = (...args) => lines.push(args.map(String).join(" "));
  console.warn = grab;
  console.log = grab;
  console.error = grab;
  let result;
  try {
    result = run();
  } finally {
    Object.assign(console, orig);
  }
  return { lines, result };
}

const telnyx402Error = () => Object.assign(new Error("payment required"), { status: 402 });
const anthropicFormError = () =>
  Object.assign(new Error("400 messages: roles must alternate ..."), {
    status: 400,
    type: "invalid_request_error",
  });
const genericServerError = () => Object.assign(new Error("boom"), { status: 500 });

function expireLatch(provider) {
  markBillingBlocked({ provider, nowMs: Date.now(), cooldownMs: 0 });
}

test("FW2-A1: 402-Fehler -> genau EINE ALARM_LLM_BILLING-Zeile mit callId+handlung, Rueckgabe true, kein Secret", () => {
  const { lines, result } = withConsoleCapture(() =>
    noteLlmBillingOutage(telnyx402Error(), { logPrefix: "[voice/turn]", payload: { callId: "call_fw2a1" } }),
  );
  assert.equal(result, true);
  const alarms = lines.filter((line) => line.includes("[voice/turn] ALARM_LLM_BILLING"));
  assert.equal(alarms.length, 1);
  assert.ok(alarms[0].includes('"callId":"call_fw2a1"'));
  assert.ok(alarms[0].includes("handlung"));
  assert.ok(!lines.join("\n").includes("sk-ant"), "kein Secret im Log");
});

test("FW2-A2: beliebiger 400-Formfehler / 500 -> KEINE Zeile, Rueckgabe false, Routing bleibt beim Primaeranbieter", () => {
  withConfigOverrides({ llmProviderFallback: "deepseek", deepseekApiKey: TEST_DEEPSEEK_KEY }, () => {
    try {
      for (const err of [anthropicFormError(), genericServerError()]) {
        const { lines, result } = withConsoleCapture(() =>
          noteLlmBillingOutage(err, { logPrefix: "[voice/turn]", payload: { callId: "call_fw2a2" } }),
        );
        assert.equal(result, false);
        assert.equal(lines.filter((line) => line.includes("ALARM_LLM_BILLING")).length, 0);
        assert.equal(lines.filter((line) => line.includes("LLM_PROVIDER_SWITCH")).length, 0);
      }
    } finally {
      expireLatch("anthropic");
    }
  });
});

test("FW2-A3: mit Fallback - erster Guthaben-Fehler latcht + EINE Wechsel-Zeile; ein WIEDERHOLTER Fehler auf dem BEREITS gelatchten Anbieter (im Cooldown) latcht erneut OHNE zweite Wechsel-Zeile", () => {
  withConfigOverrides(
    { llmProviderFallback: "deepseek", deepseekApiKey: TEST_DEEPSEEK_KEY, llmBillingLatchCooldownMs: 60000 },
    () => {
      try {
        const first = withConsoleCapture(() =>
          noteLlmBillingOutage(telnyx402Error(), { logPrefix: "[voice/turn]", payload: { callId: "c1" } }),
        );
        const firstSwitches = first.lines.filter((line) => line.includes("LLM_PROVIDER_SWITCH"));
        assert.equal(first.lines.filter((line) => line.includes("ALARM_LLM_BILLING")).length, 1);
        assert.equal(firstSwitches.length, 1);
        assert.ok(firstSwitches[0].includes('"blockedProvider":"anthropic"'));
        assert.ok(firstSwitches[0].includes('"nextProvider":"deepseek"'));
        assert.ok(firstSwitches[0].includes('"cooldownMs":60000'));

        const second = withConsoleCapture(() =>
          noteLlmBillingOutage(telnyx402Error(), { logPrefix: "[voice/turn]", payload: { callId: "c2" } }),
        );
        const secondSwitches = second.lines.filter((line) => line.includes("LLM_PROVIDER_SWITCH"));
        assert.equal(second.lines.filter((line) => line.includes("ALARM_LLM_BILLING")).length, 1);
        assert.equal(secondSwitches.length, 1, "der Fallback wird jetzt zum ERSTEN Mal gelatcht - eigene Zeile");
        assert.ok(secondSwitches[0].includes('"blockedProvider":"deepseek"'));

        const third = withConsoleCapture(() =>
          noteLlmBillingOutage(telnyx402Error(), { logPrefix: "[voice/turn]", payload: { callId: "c3" } }),
        );
        assert.equal(third.lines.filter((line) => line.includes("ALARM_LLM_BILLING")).length, 1);
        assert.equal(
          third.lines.filter((line) => line.includes("LLM_PROVIDER_SWITCH")).length,
          0,
          "deepseek ist innerhalb des Cooldowns schon gelatcht - keine erneute Wechsel-Zeile",
        );
      } finally {
        expireLatch("anthropic");
        expireLatch("deepseek");
      }
    },
  );
});

test("FW2-A4: ohne Fallback - Guthaben-Fehler -> Alarm, KEINE Wechsel-Zeile", () => {
  const { lines } = withConsoleCapture(() =>
    noteLlmBillingOutage(telnyx402Error(), { logPrefix: "[voice/turn]", payload: { callId: "c3" } }),
  );
  assert.equal(lines.filter((line) => line.includes("ALARM_LLM_BILLING")).length, 1);
  assert.equal(lines.filter((line) => line.includes("LLM_PROVIDER_SWITCH")).length, 0);
});

const ANTHROPIC_MOCK_HEADERS = { "content-type": "application/json" };
const TEXML_WEBHOOK_STATUS = 200;
const ANTHROPIC_STATUS_BILLING = 402;
const ANTHROPIC_STATUS_SERVER_ERROR = 500;

function startAnthropicMock(mode) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      if (mode === "402") {
        res.writeHead(ANTHROPIC_STATUS_BILLING, ANTHROPIC_MOCK_HEADERS);
        res.end(JSON.stringify({ type: "error", error: { type: "billing_error", message: "payment required" } }));
        return;
      }
      res.writeHead(ANTHROPIC_STATUS_SERVER_ERROR, ANTHROPIC_MOCK_HEADERS);
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}

test("FW2-A5: Mock antwortet 402 -> unveraendert turnErrorSpeech + Hangup, UND das Log traegt ALARM_LLM_BILLING", async () => {
  const mock = await startAnthropicMock("402");
  const id = "call_fw2a5";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [
        seedCall({ id, provider: "telnyx", status: "active", direction: "outbound", language: "de" }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hallo" }),
    });
    const body = await res.text();
    assert.equal(res.status, TEXML_WEBHOOK_STATUS);
    assert.ok(body.includes(LOCALES.de.turnErrorSpeech));
    assert.match(body, /<Hangup/);
    assert.match(srv.stdout, /ALARM_LLM_BILLING/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("FW2-A6: Mock antwortet 500 -> llmDegradedSpeech, Log OHNE ALARM_LLM_BILLING (keine Falschmeldung)", async () => {
  const mock = await startAnthropicMock("500");
  const id = "call_fw2a6";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, LLM_MAX_RETRIES: "0" },
    seed: seedState({
      calls: [
        seedCall({ id, provider: "telnyx", status: "active", direction: "outbound", language: "de" }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hallo" }),
    });
    const body = await res.text();
    assert.equal(res.status, TEXML_WEBHOOK_STATUS);
    assert.ok(body.includes(LOCALES.de.llmDegradedSpeech));
    assert.equal(/ALARM_LLM_BILLING/.test(srv.stdout), false);
  } finally {
    await srv.stop();
    await mock.close();
  }
});
