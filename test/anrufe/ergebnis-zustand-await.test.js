import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { z } from "zod";

import { registerTools } from "../../src/mcp-tools.js";

const CALL_ID = "call_4059_await";
const HTTP_OK = 200;
const ZITAT_KARTE = { confirmed: true, declined: false };

function captureTools(ctx) {
  const tools = new Map();
  const fakeServer = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return tools;
}

async function withGateway(callBody, event, fn) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url.includes("/consult") ? { event } : callBody));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

function anruf(abweichung) {
  return {
    status: "completed",
    answeredAt: "2026-11-20T10:00:05.000Z",
    transcript: [
      { role: "agent", text: "Guten Tag." },
      { role: "user", text: "Praxis, guten Tag." },
    ],
    summary: "Termin vereinbart.",
    objectiveAchieved: true,
    failureReason: null,
    result: null,
    ...abweichung,
  };
}

async function awaitEvent(callBody, event = "done") {
  return withGateway(callBody, event, async () => {
    const tools = captureTools({ identity: null, scopedTenant: "tenant_4059", consultAllowed: true, language: "de" });
    const { config, handler } = tools.get("await_call_event");
    const reply = await handler({ call_id: CALL_ID });
    return { config, reply };
  });
}

const KARTE = {
  outcome: "Termin steht.",
  commitments: [],
  counterpartyCommitments: [],
  openPoints: [],
  nextStep: null,
  nextSteps: [],
  facts: [],
};

const TABELLE = [
  ["ohne Bestaetigung", anruf({}), "unconfirmed", null],
  ["bestaetigt", anruf({ result: { ...KARTE, counterparty: ZITAT_KARTE } }), "done_confirmed", null],
  [
    "abgelehnt",
    anruf({ result: { ...KARTE, counterparty: { confirmed: false, declined: true } } }),
    "not_done",
    "declined",
  ],
  ["nur Menue", anruf({ transcript: [{ role: "agent", text: "Hallo?" }] }), "not_done", "menu-only"],
];

for (const [name, call, zustand, grund] of TABELLE) {
  test(`await_call_event 4059 done: ${name}`, async () => {
    const { reply } = await awaitEvent(call);
    assert.equal(reply.structuredContent.result_state, zustand);
    assert.equal(reply.structuredContent.result_reason, grund);
    const text = JSON.parse(reply.content[0].text);
    assert.equal(text.result_state, zustand);
    assert.equal(text.result_reason, grund);
  });
}

test("await_call_event 4059: ohne Ende des Anrufs sind Zustand und Grund null", async () => {
  const { reply } = await awaitEvent(anruf({}), "none");
  assert.equal(reply.structuredContent.result_state, null);
  assert.equal(reply.structuredContent.result_reason, null);
});

test("await_call_event 4059: outputSchema verlangt result_state und result_reason, beide duerfen null sein", async () => {
  const { config, reply } = await awaitEvent(anruf({}));
  const schema = z.object(config.outputSchema);
  const base = reply.structuredContent;
  assert.ok(schema.safeParse({ ...base, result_state: null, result_reason: null }).success);
  assert.ok(!schema.safeParse({ ...base, result_state: undefined }).success);
  assert.ok(!schema.safeParse({ ...base, result_reason: undefined }).success);
  assert.ok(!schema.safeParse({ ...base, result_state: 3 }).success);
});
