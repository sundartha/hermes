// P1 (docs/strategy/call-debug.md Abschnitt 6): die TEMP-Diagnose-Zeile [outbound-recv]
// muss den Outbound-ERFOLGSpfad sichtbar machen - speziell den endCall-Fall (T1), der
// bisher GAR NICHTS loggte (nur der throw-Fall T2 loggt [outbound]). Dieser Test nagelt
// fest: (a) die Zeile traegt callId/engine/endCall/tail, (b) sie leakt NIE den Roh-Speech
// (DSGVO/PII, Pre-Mortem). Treibt agentTurn ECHT erfolgreich via Anthropic-Mock
// (SDK ehrt ANTHROPIC_BASE_URL) - so wird der Erfolgspfad offline beobachtbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";

const CALL_ID = "call_test1";
// Eindeutiger Marker als "Speech": taucht er im stdout auf, hat die Diagnose PII geleakt.
const SPEECH_MARKER = "PII_GEHEIM_ANLIEGEN_4711";

// Minimaler Anthropic-Messages-Mock: liefert einen festen content-Block (Text bzw.
// Text+end_call) auf jeden POST. Stateless - genau EIN Request pro Turn, weil Text
// und (optional) end_call zusammen in EINER Antwort kommen: ohne Tool bricht der Loop
// mangels toolUses ab, mit end_call bricht er ueber `(endCall || suppressedEndCall) &&
// speech` ab (im ersten Outbound-Turn wird end_call unterdrueckt) - beide Pfade nach
// einer Runde.
async function startAnthropicMock(content) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: "msg_mock_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content,
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 5 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function runOutbound(content) {
  const anthropic = await startAnthropicMock(content);
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: anthropic.baseUrl },
    seed: seedState({ calls: [seedCall({ id: CALL_ID, status: "active", direction: "outbound" })] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(res.status, 200);
    await waitForLog(srv, /\[outbound-recv\]/);
    return srv.stdout;
  } finally {
    await srv.stop();
    await anthropic.close();
  }
}

test("[outbound-recv]: normaler Turn -> Felder gesetzt, tail=gather, KEIN Speech-Leak", async () => {
  const out = await runOutbound([{ type: "text", text: SPEECH_MARKER }]);

  const line = out.split("\n").find((l) => l.includes("[outbound-recv]"));
  assert.ok(line, `[outbound-recv]-Zeile fehlt im stdout:\n${out}`);
  assert.match(line, new RegExp(`callId=${CALL_ID}`), `callId fehlt: ${line}`);
  // engine ist im budget-Pfad strukturell konstant (realtime returnt frueher); geprueft
  // wird hier nur die Feld-Praesenz, nicht Verhalten.
  assert.match(line, /engine=budget/, `engine fehlt: ${line}`);
  assert.match(line, /endCall=false/, `endCall fehlt/falsch: ${line}`);
  assert.match(line, /tail=gather/, `tail fehlt/falsch: ${line}`);

  // PII-Gate: der Roh-Speech darf NIRGENDS im Log stehen (auch nicht ausserhalb der Zeile).
  assert.ok(!out.includes(SPEECH_MARKER), `Speech-Leak im Log (DSGVO): ${out}`);
});

test("[outbound-recv]: end_call im ersten Outbound-Turn (T1) wird unterdrueckt -> endCall=false, tail=gather, KEIN Speech-Leak", async () => {
  const out = await runOutbound([
    { type: "text", text: SPEECH_MARKER },
    { type: "tool_use", id: "toolu_1", name: "end_call", input: {} },
  ]);

  const line = out.split("\n").find((l) => l.includes("[outbound-recv]"));
  assert.ok(line, `[outbound-recv]-Zeile fehlt im stdout:\n${out}`);
  // T1-Fix P3a (claude.js): ruft der Agent im ERSTEN Outbound-Turn end_call, BEVOR der
  // Angerufene etwas gesagt hat, wird es unterdrueckt -> agentTurn liefert endCall=false,
  // der Webhook rendert ein <Gather> (tail=gather) statt eines stummen Hangups.
  assert.match(line, /endCall=false/, `T1-Fix: end_call im ersten Turn muss unterdrueckt sein: ${line}`);
  assert.match(line, /tail=gather/, `T1-Fix: tail muss gather sein (kein Hangup): ${line}`);

  assert.ok(!out.includes(SPEECH_MARKER), `Speech-Leak im Log (DSGVO): ${out}`);
});
