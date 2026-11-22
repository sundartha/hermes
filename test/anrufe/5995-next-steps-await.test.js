import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import { registerTools } from "../../src/mcp-tools.js";

const CALL_ID = "call_5995_await";
const HTTP_OK = 200;

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

async function withGateway(callBody, fn) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url.includes("/consult") ? { event: "done" } : callBody));
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

function endedCall(result) {
  return {
    status: "completed",
    transcript: [],
    summary: "Rueckruf vereinbart.",
    objectiveAchieved: true,
    failureReason: null,
    result,
  };
}

function karte(overrides = {}) {
  return {
    outcome: "Rueckruf steht.",
    commitments: [],
    counterpartyCommitments: [],
    openPoints: [],
    nextStep: "Rueckruf morgen",
    nextSteps: [],
    facts: [],
    ...overrides,
  };
}

async function awaitDone(callBody) {
  return withGateway(callBody, async () => {
    const tools = captureTools({ identity: null, scopedTenant: "tenant_5995", consultAllowed: true, language: "de" });
    const { config, handler } = tools.get("await_call_event");
    const reply = await handler({ call_id: CALL_ID });
    return { config, reply };
  });
}

test("await_call_event: done traegt den Rueckrufwunsch morgen um 10 Uhr als next_steps", async () => {
  const schritte = [{ type: "callback", text: "Rueckruf morgen um 10 Uhr", at: "2026-11-23T10:00" }];
  const { reply } = await awaitDone(endedCall(karte({ nextSteps: schritte })));
  assert.deepEqual(reply.structuredContent.next_steps, schritte);
  assert.deepEqual(JSON.parse(reply.content[0].text).next_steps, schritte);
});

test("await_call_event: ohne Schritte, ohne Feld und ohne Karte ist next_steps leer", async () => {
  const mitKarte = await awaitDone(endedCall(karte()));
  assert.deepEqual(mitKarte.reply.structuredContent.next_steps, []);
  const altKarte = karte();
  delete altKarte.nextSteps;
  const ohneFeld = await awaitDone(endedCall(altKarte));
  assert.deepEqual(ohneFeld.reply.structuredContent.next_steps, []);
  const ohneKarte = await awaitDone(endedCall(null));
  assert.deepEqual(ohneKarte.reply.structuredContent.next_steps, []);
});

test("await_call_event: Text der Schritte laeuft durch die Maskierung gesperrter Daten", async () => {
  const { reply } = await awaitDone(
    endedCall(karte({ nextSteps: [{ type: "task", text: "Karte 4111 1111 1111 1111 pruefen", at: null }] })),
  );
  const [schritt] = reply.structuredContent.next_steps;
  assert.ok(!schritt.text.includes("4111 1111 1111 1111"));
  assert.equal(schritt.type, "task");
});

test("await_call_event: outputSchema verlangt next_steps als Liste von Art, Text, Zeitpunkt", async () => {
  const { config, reply } = await awaitDone(endedCall(karte()));
  const schema = z.object(config.outputSchema);
  const gut = { type: "callback", text: "x", at: "2026-11-23T10:00" };
  const base = reply.structuredContent;
  assert.ok(schema.safeParse({ ...base, next_steps: [gut, { ...gut, at: null }] }).success);
  assert.ok(!schema.safeParse({ ...base, next_steps: [{ type: "callback", text: "x" }] }).success);
  assert.ok(!schema.safeParse({ ...base, next_steps: undefined }).success);
});

test("await_call_event: die Beschreibung nennt next_steps als Teil der done-Antwort", async () => {
  const { config } = await awaitDone(endedCall(karte()));
  assert.match(config.description, /next_steps \(a list of \{type, text, at\}/);
  assert.match(config.description, /Hermes enters nothing into any calendar/);
});
