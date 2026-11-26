import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

const OWNER = "Jonas Beispiel";

function message(content, stopReason) {
  return {
    id: "msg_alp14",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const textOnly = (text) => message([{ type: "text", text }], "end_turn");
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];

let ops, inCall, question;

function answeredOutbound(id, overrides = {}) {
  const answeredAt = new Date().toISOString();
  return seedCall({ id, direction: "outbound", language: "de", answeredAt, ...overrides });
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-alp14-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 22; i++) calls.push(answeredOutbound(`call_alp14_${i}`));
  calls.push(answeredOutbound("call_alp14_inbound", { direction: "inbound" }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../../src/config.ts");
  ops = await import("../../src/store/state-ops.js");
  inCall = await import("../../src/consult/in-call.js");
  question = await import("../../src/consult/question.ts");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("AL-P14-13: Anfuehrungszeichen und die zitierte Spanne werden entfernt", () => {
  const cleaned = question.sanitizeConsultQuestion(
    'Er sagt "wir haben nur noch Freitag frei" - passt das?',
    [],
  );
  assert.ok(cleaned);
  assert.ok(!/["'„“”«»‚‘’]/.test(cleaned), `Anfuehrungszeichen uebrig: ${cleaned}`);
  assert.ok(!cleaned.includes("nur noch Freitag frei"), `Zitat uebrig: ${cleaned}`);
});

test("AL-P14-14: eine woertlich wiederholte Wortfolge des Anrufers wird abgelehnt", () => {
  const transcript = [
    { role: "agent", text: "Wann haetten Sie denn Zeit?" },
    { role: "caller", text: "Wir haben diese Woche nur noch am Freitag einen Platz frei." },
  ];
  const verbatim = "Frage: wir haben diese Woche nur noch am Freitag einen Platz frei?";
  assert.equal(question.sanitizeConsultQuestion(verbatim, transcript), null);
  assert.ok(question.sanitizeConsultQuestion("Ist Freitag akzeptabel?", transcript));
});

test("AL-P14-15: eine zu lange Frage wird an der Wortgrenze gekappt", () => {
  const long = `${"Wort ".repeat(80)}Ende`;
  const cleaned = question.sanitizeConsultQuestion(long, []);
  assert.ok(cleaned.length <= question.CONSULT_QUESTION_MAX_CHARS);
  assert.ok(!cleaned.endsWith("Wor"), "mitten im Wort gekappt");
  assert.ok(cleaned.endsWith("Wort"), `unerwartetes Ende: ${cleaned}`);
});

test("AL-P14-16: leere und nicht-String-Fragen werden abgelehnt", () => {
  for (const bad of ["", "   ", '""', null, undefined, 42, { question: "x" }]) {
    assert.equal(question.sanitizeConsultQuestion(bad, []), null, `nicht abgelehnt: ${bad}`);
  }
});

test("AL-P14-23: isInCallConsult unterscheidet Consult #0 von der Rueckfrage im Gespraech", () => {
  const answeredAt = "2026-07-31T10:00:05.000Z";
  const call = { answeredAt };
  assert.equal(ops.isInCallConsult(call, { askedAt: "2026-07-31T10:00:00.000Z" }), false);
  assert.equal(ops.isInCallConsult(call, { askedAt: answeredAt }), true);
  assert.equal(ops.isInCallConsult(call, { askedAt: "2026-07-31T10:00:30.000Z" }), true);
  assert.equal(
    ops.isInCallConsult({ answeredAt: null }, { askedAt: "2026-07-31T10:00:30.000Z" }),
    false,
  );
});

test("AL-P14-24: consultFitsBillingMinute haelt nur, wenn die Frist in die laufende Minute passt", () => {
  const nowMs = Date.parse("2026-07-31T10:00:00.000Z");
  const at = (offsetMs) => ({ answeredAt: new Date(nowMs - offsetMs).toISOString() });
  assert.equal(inCall.consultFitsBillingMinute(at(1000), nowMs), true);
  assert.equal(inCall.consultFitsBillingMinute(at(59_000), nowMs), false);
  assert.equal(inCall.consultFitsBillingMinute({ answeredAt: null, startedAt: null }, nowMs), false);
  assert.equal(inCall.consultFitsBillingMinute(at(-5000), nowMs), false);
});
