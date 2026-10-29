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

function captureRegistrationOrder(ctx) {
  const order = [];
  const fakeServer = {
    registerTool(name) {
      order.push(name);
    },
    registerResource(name) {
      order.push(`Ressource ${name}`);
    },
  };
  registerTools(fakeServer, { uiHost: { enabled: true }, ...ctx });
  return order;
}

const REGISTRIERFOLGE_VOR_RUECKFRAGE = ["Ressource call", "prepare_call", "place_call"];
const RUECKFRAGE_WERKZEUGE = ["await_call_event", "answer_consult"];
const REGISTRIERFOLGE_NACH_RUECKFRAGE = [
  "get_call_status",
  "get_call_result",
  "cancel_call",
  "Ressource my-number",
  "get_agent_number",
  "Ressource calls",
  "list_calls",
  "check_inbox",
  "list_action_items",
  "Ressource agent-status",
  "get_agent_status",
];

test("[NIE1] registerTools registriert Werkzeuge und Widget-Ressourcen in der festen Folge, mit und ohne consultAllowed", () => {
  assert.deepEqual(captureRegistrationOrder({ consultAllowed: true }), [
    ...REGISTRIERFOLGE_VOR_RUECKFRAGE,
    ...RUECKFRAGE_WERKZEUGE,
    ...REGISTRIERFOLGE_NACH_RUECKFRAGE,
  ]);
  assert.deepEqual(captureRegistrationOrder({ consultAllowed: false }), [
    ...REGISTRIERFOLGE_VOR_RUECKFRAGE,
    ...REGISTRIERFOLGE_NACH_RUECKFRAGE,
  ]);
});

const KOPF_CALL_ID = "call_kopf";

const KOPF_GATEWAY_ANTWORT = {
  preview: { status: "awaiting_confirmation" },
  confirmed: true,
  callId: KOPF_CALL_ID,
  event: "done",
  eventId: null,
  questions: [],
  status: "completed",
  startedAt: "2026-06-26T10:00:00.000Z",
  endedAt: "2026-06-26T10:01:00.000Z",
  transcript: [],
  calls: [],
  actionItems: [],
  entries: [],
};

const KOPF_ANRUF_ARGS = { to: "+4917212345678", objective: "Testanruf" };

const KOPF_WERKZEUG_AUFRUFE = [
  ["prepare_call", KOPF_ANRUF_ARGS],
  ["place_call", { ...KOPF_ANRUF_ARGS, confirmation_code: "123456" }],
  ["await_call_event", { call_id: KOPF_CALL_ID }],
  ["answer_consult", { call_id: KOPF_CALL_ID, event_id: "evt_1", answers: ["Ja"] }],
  ["get_call_status", { call_id: KOPF_CALL_ID }],
  ["get_call_result", { call_id: KOPF_CALL_ID }],
  ["cancel_call", { call_id: KOPF_CALL_ID }],
  ["get_agent_number", {}],
  ["list_calls", {}],
  ["check_inbox", {}],
  ["list_action_items", {}],
  ["get_agent_status", {}],
];

const KOPF_KONTEXTE = [
  { identity: "ident-kunde", scopedTenant: "tenant-kunde" },
  { identity: "ident-allein", scopedTenant: null },
  { identity: null, scopedTenant: "tenant-allein" },
];

async function withRecordingGateway(body, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      route: `${req.method} ${req.url}`,
      identity: req.headers["x-internal-identity"],
      tenant: req.headers["x-internal-tenant"],
    });
    sendJson(res, { body });
  });
  const gateway = await listen(server);
  const previousUrl = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = gateway.url;
  try {
    return await run(requests);
  } finally {
    if (previousUrl === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = previousUrl;
    await gateway.close();
  }
}

async function requestsPerTool(ctx) {
  return withRecordingGateway(KOPF_GATEWAY_ANTWORT, async (requests) => {
    const handlers = captureTools({ ...ctx, consultAllowed: true });
    const perTool = new Map();
    for (const [name, args] of KOPF_WERKZEUG_AUFRUFE) {
      const before = requests.length;
      await handlers.get(name)(args);
      perTool.set(name, requests.slice(before));
    }
    return perTool;
  });
}

test("[NIE2] jeder Gateway-Aufruf der zwoelf Werkzeuge traegt X-Internal-Identity und X-Internal-Tenant aus registerTools", async () => {
  for (const ctx of KOPF_KONTEXTE) {
    const perTool = await requestsPerTool(ctx);
    assert.deepEqual(
      [...perTool.keys()],
      KOPF_WERKZEUG_AUFRUFE.map(([name]) => name),
    );
    for (const [name, requests] of perTool) {
      assert.ok(requests.length > 0, `${name} erreicht das Gateway`);
      for (const request of requests) {
        assert.deepEqual(
          { identity: request.identity, tenant: request.tenant },
          { identity: ctx.identity ?? undefined, tenant: ctx.scopedTenant ?? undefined },
          `${name} ${request.route} mit ${JSON.stringify(ctx)}`,
        );
      }
    }
    assert.deepEqual(
      perTool.get("await_call_event").map((request) => request.route),
      [`GET /api/calls/${KOPF_CALL_ID}/consult`, `GET /api/calls/${KOPF_CALL_ID}`],
    );
  }
});
