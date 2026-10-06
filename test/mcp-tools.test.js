import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";

const HTTP_OK = 200;

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

function sendJson(res, { body = null, status = HTTP_OK } = {}) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body == null ? "" : JSON.stringify(body));
}

async function startGatewayMock({ body = null, status = HTTP_OK } = {}) {
  const server = http.createServer((req, res) => sendJson(res, { body, status }));
  return listen(server);
}

async function startGatewayMockSequence(bodies) {
  let i = 0;
  const server = http.createServer((req, res) => {
    sendJson(res, { body: bodies[Math.min(i++, bodies.length - 1)] });
  });
  return listen(server);
}

function toolText(result) {
  return (result?.content || []).map((item) => item.text).join("\n");
}

test("T-P4-06: degradierte api-Antwort ({}) -> klare Tool-Fehlermeldung, kein .length-Crash", async () => {
  const mock = await startGatewayMock({ body: null });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null });

    let result;
    await assert.doesNotReject(async () => {
      result = await handlers.get("list_calls")();
    }, "list_calls darf nicht mit TypeError crashen");
    assert.ok(result?.isError, "degradierte Antwort -> isError-Tool-Antwort");
    assert.doesNotMatch(
      toolText(result),
      /Cannot read|undefined|TypeError/i,
      "kein roher Deref-Fehler",
    );

    let statusResult;
    await assert.doesNotReject(async () => {
      statusResult = await handlers.get("get_agent_status")();
    });
    assert.ok(statusResult?.isError, "get_agent_status auf {} -> isError");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("T-P4-06b: leere Anrufliste ([]) bleibt valide -> 'Noch keine Anrufe.', kein Fehler", async () => {
  const mock = await startGatewayMock({ body: { calls: [] } });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null, language: "de" });
    const result = await handlers.get("list_calls")();
    assert.ok(!result?.isError, "leere Anrufliste ist KEIN Fehler");
    assert.match(toolText(result), /Noch keine Anrufe/);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("T-P4-07: Handler-Throw (Gateway 500) -> MCP-Fehlerantwort, keine unhandled rejection", async () => {
  const mock = await startGatewayMock({ body: { error: "boom" }, status: 500 });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on("unhandledRejection", onRejection);
  try {
    const handlers = captureTools({ identity: null });
    let result;
    await assert.doesNotReject(async () => {
      result = await handlers.get("get_agent_number")();
    }, "Handler-Throw darf nicht als Rejection entkommen");
    assert.ok(result?.isError, "Gateway-Fehler -> isError-Tool-Antwort");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejections.length, 0, "keine unhandled rejection");
  } finally {
    process.removeListener("unhandledRejection", onRejection);
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("T-P4-07b: Gateway-500 zeigt einem EN-Tenant keinen deutschen Fehlertext", async () => {
  const mock = await startGatewayMock({ body: { error: "boom" }, status: 500 });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null, language: "en" });
    const result = await handlers.get("get_agent_number")();
    assert.ok(result?.isError);
    assert.doesNotMatch(
      toolText(result),
      /Telefon-Agent|erreichbar|nicht gefunden/,
      "kein deutscher Satz fuer einen EN-Tenant",
    );
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

const TEN_SECONDS_AGO_MS = 10_000;
const ONE_SECOND_AGO_MS = 1_000;
const MIN_POLL1_DURATION_S = 9;
const EXPECTED_COMPLETED_DURATION_S = 65;

test("T-C3-01: duration_s springt bei markAnswered nicht zurueck (Monotonie)", async () => {
  const base = Date.now();
  const startedAt = new Date(base - TEN_SECONDS_AGO_MS).toISOString();
  const dialing = { status: "active", startedAt, transcript: [] };
  const answered = {
    status: "active",
    startedAt,
    answeredAt: new Date(base - ONE_SECOND_AGO_MS).toISOString(),
    transcript: [],
  };
  const mock = await startGatewayMockSequence([dialing, answered]);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null });
    const poll1 = await handlers.get("get_call_status")({ call_id: "call_1" });
    const poll2 = await handlers.get("get_call_status")({ call_id: "call_1" });
    const d1 = poll1.structuredContent.duration_s;
    const d2 = poll2.structuredContent.duration_s;
    assert.equal(poll1.structuredContent.status, "dialing");
    assert.equal(poll2.structuredContent.status, "in_progress");
    assert.ok(d1 >= MIN_POLL1_DURATION_S, `Poll 1 misst seit startedAt (~10s), war ${d1}`);
    assert.ok(d2 >= d1, `Monotonie verletzt: Poll 2 (${d2}) < Poll 1 (${d1})`);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("S1-5a: list_action_items filtert erledigte aus + praefixt Termine mit '(Termin) '", async () => {
  const actionItems = [
    { id: "a1", text: "Rueckruf", type: "todo", done: false },
    { id: "a2", text: "Zahnarzt", type: "appointment", done: false },
    { id: "a3", text: "Erledigt", type: "todo", done: true },
  ];
  const mock = await startGatewayMock({ body: { actionItems } });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null });
    const result = await handlers.get("list_action_items")();
    const text = toolText(result);
    assert.match(text, /^Rueckruf$/m);
    assert.match(text, /^\(Termin\) Zahnarzt$/m);
    assert.doesNotMatch(text, /\[a1\]|\[a2\]|\[a3\]/, "keine Item-ID-Klammer mehr");
    assert.doesNotMatch(text, /Erledigt/);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("S1-5b: list_action_items ohne offene Items -> 'Keine offenen Action Items.'", async () => {
  const mock = await startGatewayMock({ body: { actionItems: [] } });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null });
    const result = await handlers.get("list_action_items")();
    assert.equal(toolText(result), "Keine offenen Action Items.");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("S1-5c: Todo-Zeile traegt KEIN '(Termin) '-Praefix (Ternary nicht invertiert)", async () => {
  const actionItems = [
    { id: "b1", text: "Einkaufen", type: "todo", done: false },
    { id: "b2", text: "Friseur", type: "appointment", done: false },
  ];
  const mock = await startGatewayMock({ body: { actionItems } });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null });
    const result = await handlers.get("list_action_items")();
    const lines = toolText(result).split("\n");
    const todoLine = lines.find((line) => line.includes("Einkaufen"));
    const apptLine = lines.find((line) => line.includes("Friseur"));
    assert.equal(todoLine, "Einkaufen");
    assert.equal(apptLine, "(Termin) Friseur");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("T-C3-02: completed-Call misst startedAt..endedAt, nicht answeredAt..endedAt", async () => {
  const body = {
    status: "completed",
    startedAt: "2026-06-26T10:00:00.000Z",
    answeredAt: "2026-06-26T10:00:05.000Z",
    endedAt: "2026-06-26T10:01:05.000Z",
    transcript: [],
  };
  const mock = await startGatewayMock({ body });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null });
    const result = await handlers.get("get_call_status")({ call_id: "call_1" });
    assert.equal(
      result.structuredContent.duration_s,
      EXPECTED_COMPLETED_DURATION_S,
      "Anker = startedAt (nicht 60 = answeredAt)",
    );
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});
