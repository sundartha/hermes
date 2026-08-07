// AL-P6, zweite Haelfte: agentTurn PRUEFT die Budget-Achsen (test/al-p6-turn-deadline-
// budget.test.js), die REAKTION liegt beim Aufrufer - und beide Engines muessen sie haben.
//   Teil A (Shim, Assistant-Pfad): Abschluss-Ansage + realer Call-Control-Hangup, derselbe
//     Notaus wie das Gate VOR dem Turn (telnyx-p6, Weg iii).
//   Teil B (Budget-Engine, /voice/turn): derselbe Locale-Satz + <Hangup> im TeXML.
// Der ZEIT-Abbruch (deadline) fuehrt bewusst in KEINER Engine zum Auflegen - der Turn hat
// eine gueltige Antwort. Testnamen ohne Katalog-ID (Regressionslauf).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { localeFor } from "../src/i18n/locales.js";
import { startServer, seedState, seedCall } from "./helpers.js";
import {
  fakeRes,
  fakeStore,
  voiceControlSpy,
  agentTurnSpy,
  makeCall,
  makeHandler,
  validReq,
  sseContent,
} from "./telnyx-shim-harness.js";

const HANGUP_CALL = { provider: "telnyx", callControlId: "cc_1" };

// Faengt die PII-freien Gate-Zeilen des Shims ab (console.warn wie alle Gate-Logs).
async function withShimGateLog(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    await fn();
    return lines.filter((l) => l.includes("[telnyx-shim] gate"));
  } finally {
    console.warn = original;
  }
}

// Build-Schritt (P13): ein Shim-Handler samt Spies fuer einen Turn mit gegebenem
// stopReason, Budget-Gate VOR dem Turn bewusst FREI (nur der Mid-Turn-Abbruch wirkt).
function shimWithStopReason(stopReason) {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = voiceControlSpy();
  const agentTurn = agentTurnSpy({ speech: "Ich schaue kurz nach.", endCall: false, stopReason });
  return { call, store, voiceControl, res: fakeRes(), handler: makeHandler({ store, agentTurn, voiceControl }) };
}

test("AL-P6-7: Shim - Tenant-Cap mitten im Turn erschoepft -> Ansage UND Call-Control-Hangup", async () => {
  const { call, store, voiceControl, res, handler } = shimWithStopReason("budget_tenant");

  const gateLines = await withShimGateLog(() => handler(validReq(call), res));

  assert.equal(sseContent(res), localeFor("de").budgetExhaustedHangup);
  assert.deepEqual(voiceControl.calls, [HANGUP_CALL]);
  assert.deepEqual(store.settlementCalls, [], "Settlement bleibt allein bei P4.5 onHangup");
  assert.equal(gateLines.length, 1);
  assert.match(gateLines[0], /"reason":"budget_tenant"/);
});

test("AL-P6-9: Shim - der Zeit-Abbruch legt NICHT auf, der Turn-Text geht raus", async () => {
  const { call, voiceControl, res, handler } = shimWithStopReason("deadline");

  await handler(validReq(call), res);

  assert.equal(sseContent(res), "Ich schaue kurz nach.");
  assert.deepEqual(voiceControl.calls, [], "eine gueltige Antwort beendet kein Gespraech");
});

// ---- Teil B: Budget-Engine (echte HTTP-Route, Spawn) --------------------------------

// Haiku kostet 1,0 USD je Million Input-Token; 40 Mio. Token sind rund 3680 ct. Im
// Spawn-Env steht DEFAULT_TENANT_BUDGET_CENTS auf 0 (Sentinel), der effektive Tenant-Cap
// ist damit der Plattform-Cap (MAX_BUDGET_EUR=30 = 3000 ct) - EINE Runde reisst ihn, und
// die Tenant-Achse wird zuerst gefragt, also lautet der Grund-Token budget_tenant.
const TOKENS_OVER_TENANT_CAP = 40_000_000;

function anthropicMessage(content, inputTokens) {
  return {
    id: "msg_alp6_engine",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: 5 },
  };
}

// Antwortet auf JEDEN Request identisch und zaehlt die Requests - so faellt eine zweite,
// bereits gebuchte Runde als Zahl auf.
async function startAnthropicMock(payload) {
  const requests = { count: 0 };
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requests.count += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Opening (LLM-frei) + ein Turn mit Speech gegen die echte Route (P13).
async function runTurn(srv, id) {
  const opening = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: "CAtest" }),
  });
  assert.equal(opening.status, 200);
  const turn = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ SpeechResult: "Ja, Donnerstag passt gut" }),
  });
  return await turn.text();
}

test("AL-P6-10: Budget-Engine - der im Turn gerissene Cap beendet den Call mit Ansage", async () => {
  const id = "call_alp6_engine";
  const mock = await startAnthropicMock(
    anthropicMessage(
      [{ type: "tool_use", id: "tu1", name: "look_up_not_yet_built", input: {} }],
      TOKENS_OVER_TENANT_CAP,
    ),
  );
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ calls: [seedCall({ id, provider: "telnyx", direction: "outbound" })] }),
  });
  try {
    const body = await runTurn(srv, id);

    assert.equal(mock.requests.count, 1, "keine zweite, bereits gebuchte Runde");
    assert.ok(
      body.includes(localeFor("de").budgetExhaustedHangup),
      `Abschluss-Ansage erwartet: ${body}`,
    );
    assert.match(body, /<Hangup/);
    assert.match(srv.stdout, /\[turn\] abbruch grund=budget_tenant/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("AL-P6-11: Budget-Engine - normaler Verbrauch laesst das Gespraech weiterlaufen", async () => {
  const id = "call_alp6_engine_ok";
  const speech = "Gerne, ich pruefe das.";
  const mock = await startAnthropicMock(anthropicMessage([{ type: "text", text: speech }], 12));
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ calls: [seedCall({ id, provider: "telnyx", direction: "outbound" })] }),
  });
  try {
    const body = await runTurn(srv, id);

    assert.ok(body.includes(speech), `Modelltext erwartet: ${body}`);
    assert.match(body, /<Gather/);
    assert.doesNotMatch(body, /<Hangup/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});
