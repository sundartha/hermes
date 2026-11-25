import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";

const CALL_ID = "call_4059_zustand";
const HTTP_OK = 200;
const ZUSTAENDE = ["done_confirmed", "not_done", "unconfirmed"];

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

function anruf(abweichung) {
  return {
    status: "completed",
    answeredAt: "2026-11-20T10:00:05.000Z",
    transcript: [],
    summary: "Termin vereinbart.",
    objectiveAchieved: true,
    failureReason: null,
    result: null,
    ...abweichung,
  };
}

async function ergebnisVon(callBody) {
  return withGateway(callBody, async () => {
    const tools = captureTools({ identity: null, scopedTenant: "tenant_4059", consultAllowed: true, language: "de" });
    const reply = await tools.get("get_call_result").handler({ call_id: CALL_ID });
    const text = JSON.parse(reply.content[0].text);
    assert.equal(reply.structuredContent.result_state, text.result_state);
    assert.equal(reply.structuredContent.result_reason, text.result_reason);
    return reply.structuredContent;
  });
}

const AGENT = { role: "agent", text: "Guten Tag, ich rufe im Auftrag von Frau Muster an." };
const MENUE = { role: "agent", text: "Hallo?" };
const GEGENSEITE = { role: "user", text: "Praxis Dr. Beispiel, guten Tag." };

const TABELLE = [
  ["nur Menue erreicht: Agent spricht, Gegenseite nie", { transcript: [AGENT, MENUE] }, "not_done", "menu-only"],
  ["Gegenseite mit leerem Text zaehlt nicht als Gegenseite", { transcript: [AGENT, { role: "user", text: "  " }] }, "not_done", "menu-only"],
  ["niemand abgenommen: kein answeredAt", { answeredAt: null, status: "failed", failureReason: "busy" }, "not_done", "no-answer"],
  ["Fehlergrund no-answer trotz answeredAt", { failureReason: "no-answer", transcript: [AGENT, GEGENSEITE] }, "not_done", "no-answer"],
  ["Fehlergrund no-answer mit Detail", { failureReason: "no-answer: 480", transcript: [AGENT, GEGENSEITE] }, "not_done", "no-answer"],
  ["Gegenseite hat gesprochen: nie done_confirmed ohne Bestaetigung", { transcript: [AGENT, GEGENSEITE] }, "unconfirmed", null],
  ["Transkript geloescht: nicht als Menue werten", { transcript: [] }, "unconfirmed", null],
  ["Ziel nicht erreicht aendert den Zustand nicht", { objectiveAchieved: false, transcript: [AGENT, GEGENSEITE] }, "unconfirmed", null],
];

for (const [name, abweichung, zustand, grund] of TABELLE) {
  test(`get_call_result 4059: ${name}`, async () => {
    const ergebnis = await ergebnisVon(anruf(abweichung));
    assert.equal(ergebnis.result_state, zustand);
    assert.equal(ergebnis.result_reason, grund);
    assert.notEqual(ergebnis.result_state, "done_confirmed");
    assert.ok(ZUSTAENDE.includes(ergebnis.result_state));
  });
}

test("get_call_result 4059: objective_achieved bleibt unveraendert neben dem Zustand", async () => {
  const ergebnis = await ergebnisVon(anruf({ transcript: [AGENT, MENUE] }));
  assert.equal(ergebnis.objective_achieved, true);
  assert.equal(ergebnis.result_state, "not_done");
});
