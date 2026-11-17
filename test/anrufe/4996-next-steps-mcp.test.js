import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import { registerTools } from "../../src/mcp-tools.js";

const CALL_ID = "call_4996_mcp";
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
    res.end(JSON.stringify(callBody));
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
    summary: "Termin vereinbart.",
    objectiveAchieved: true,
    failureReason: null,
    result,
  };
}

function karte(overrides = {}) {
  return {
    outcome: "Termin steht.",
    commitments: [],
    counterpartyCommitments: [],
    openPoints: [],
    nextStep: "Termin in den Kalender eintragen",
    nextSteps: [],
    facts: [],
    ...overrides,
  };
}

async function getCallResult(callBody) {
  return withGateway(callBody, async () => {
    const tools = captureTools({ identity: null, scopedTenant: "tenant_4996", consultAllowed: true, language: "de" });
    const { config, handler } = tools.get("get_call_result");
    const reply = await handler({ call_id: CALL_ID });
    return { config, reply };
  });
}

test("get_call_result liefert next_steps strukturiert mit Art, Text und Zeitpunkt, next_step bleibt", async () => {
  const schritte = [
    { type: "appointment", text: "Termin mit Dr. X vereinbart, bitte in den Kalender eintragen", at: "2026-11-20T10:00" },
    { type: "callback", text: "Praxis ruft zurueck", at: null },
  ];
  const { reply } = await getCallResult(endedCall(karte({ nextSteps: schritte })));
  assert.deepEqual(reply.structuredContent.next_steps, schritte);
  assert.equal(reply.structuredContent.next_step, "Termin in den Kalender eintragen");
  const text = JSON.parse(reply.content[0].text);
  assert.deepEqual(text.next_steps, schritte);
  assert.equal(text.next_step, "Termin in den Kalender eintragen");
});

test("get_call_result: ohne Schritte ist next_steps leer, bei Ergebniskarte ohne Feld und ohne Karte", async () => {
  const mitKarte = await getCallResult(endedCall(karte()));
  const { structuredContent } = mitKarte.reply;
  assert.deepEqual(structuredContent.next_steps, []);
  const textKarte = JSON.parse(mitKarte.reply.content[0].text);
  assert.deepEqual(textKarte.next_steps, []);

  const altKarte = karte();
  delete altKarte.nextSteps;
  const ohneFeld = await getCallResult(endedCall(altKarte));
  assert.deepEqual(ohneFeld.reply.structuredContent.next_steps, []);

  const ohneKarte = await getCallResult(endedCall(null));
  assert.deepEqual(ohneKarte.reply.structuredContent.next_steps, []);
});

test("get_call_result: Text der Schritte laeuft durch die Maskierung gesperrter Daten", async () => {
  const { reply } = await getCallResult(
    endedCall(karte({ nextSteps: [{ type: "task", text: "Karte 4111 1111 1111 1111 pruefen", at: null }] })),
  );
  const [schritt] = reply.structuredContent.next_steps;
  assert.ok(!schritt.text.includes("4111 1111 1111 1111"));
  assert.equal(schritt.type, "task");
});

test("Werkzeugvertrag: outputSchema von get_call_result nennt next_steps als Liste von Art, Text, Zeitpunkt", async () => {
  const { config, reply } = await getCallResult(endedCall(karte()));
  const schema = z.object(config.outputSchema);
  const gut = { type: "appointment", text: "x", at: "2026-11-20" };
  const base = reply.structuredContent;
  assert.ok(schema.safeParse({ ...base, next_steps: [gut, { ...gut, at: null }] }).success);
  assert.ok(!schema.safeParse({ ...base, next_steps: [{ type: "appointment", text: "x" }] }).success);
  assert.ok(!schema.safeParse({ ...base, next_steps: [{ ...gut, text: 5 }] }).success);
  assert.ok(!schema.safeParse({ ...base, next_steps: undefined }).success);
});
