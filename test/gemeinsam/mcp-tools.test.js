import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";

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
const EXPECTED_COMPLETED_DURATION_S = 60;

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
    assert.equal(d1, 0, `Poll 1 vor dem Abheben zaehlt noch nicht, war ${d1}`);
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

test("T-C3-02: completed-Call misst answeredAt..endedAt", async () => {
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
      "Anker = answeredAt",
    );
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

const INCOMPLETE_ANSWER_DE =
  "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.";
const CALL_ID = "call_1";
const PLACE_ARGS = { to: "+4917212345678", objective: "Ich moechte einen Termin vereinbaren." };
const FINISHED_CALL = {
  status: "completed",
  startedAt: "2026-06-26T10:00:00.000Z",
  endedAt: "2026-06-26T10:01:05.000Z",
  transcript: [],
};
const AGENT_STATE = {
  agent: { number: "+4930123456", owner: "Max" },
  calls: [],
  actionItems: [],
  usage: { calls: 0 },
  settings: { allowSummaries: true, allowPersonalData: false, allowBankData: false },
};
const FULL_GATEWAY = {
  "POST /api/calls": { callId: CALL_ID },
  [`GET /api/calls/${CALL_ID}/consult`]: { event: "done", eventId: null, questions: [] },
  [`POST /api/calls/${CALL_ID}/consult/answer`]: { merged_facts: 1 },
  [`GET /api/calls/${CALL_ID}`]: FINISHED_CALL,
  [`POST /api/calls/${CALL_ID}/cancel`]: { ok: true },
  "GET /api/state": AGENT_STATE,
  "POST /api/inbox/poll": { entries: [], remaining: 0 },
};

async function withGatewayTable(table, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      route: `${req.method} ${req.url}`,
      identity: req.headers["x-internal-identity"] ?? null,
      tenant: req.headers["x-internal-tenant"] ?? null,
    });
    const key = `${req.method} ${req.url}`;
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(key in table ? table[key] : {}));
  });
  const mock = await listen(server);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await run(requests);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
}

const CONSULT_ANSWER_ROUTE = `POST /api/calls/${CALL_ID}/consult/answer`;

function callTool(table, { tool, args, consultAllowed = false }) {
  return withGatewayTable(table, () =>
    captureTools({ identity: null, consultAllowed }).get(tool)(args),
  );
}

function answerConsult(gatewayAnswer, answerArgs) {
  return callTool(
    { [CONSULT_ANSWER_ROUTE]: gatewayAnswer },
    {
      tool: "answer_consult",
      args: { call_id: CALL_ID, event_id: "e1", ...answerArgs },
      consultAllowed: true,
    },
  );
}

test("place_call: Gateway ohne callId -> unvollstaendige Antwort, kein Anruf ohne Kennung gemeldet", async () => {
  const result = await callTool(
    { "POST /api/calls": {} },
    { tool: "place_call", args: PLACE_ARGS },
  );
  assert.equal(result.isError, true);
  assert.equal(toolText(result), INCOMPLETE_ANSWER_DE);
});

test("await_call_event: after_event_id geht kodiert als ?after= an die Rueckfrage-Abfrage", async () => {
  const consultRoute = `GET /api/calls/${CALL_ID}/consult?after=ev%201`;
  const noEvent = { event: "none", eventId: null, questions: [] };
  await withGatewayTable({ [consultRoute]: noEvent }, async (requests) => {
    const handlers = captureTools({ identity: null, consultAllowed: true });
    const result = await handlers.get("await_call_event")({
      call_id: CALL_ID,
      after_event_id: "ev 1",
    });
    assert.equal(result.structuredContent.event, "none");
    assert.deepEqual(
      requests.map((request) => request.route),
      [consultRoute],
    );
  });
});

test("answer_consult: Quittung 'working' ist eine Textantwort mit accepted und null Fakten", async () => {
  const result = await answerConsult({ merged_facts: 4 }, { status: "working" });
  assert.deepEqual(result.content, [
    { type: "text", text: "Rueckfrage quittiert - die Antwort wird erwartet." },
  ]);
  assert.deepEqual(result.structuredContent, { accepted: true, merged_facts: 0 });
});

test("answer_consult: endgueltige Antwort meldet die Zahl uebernommener Fakten als Text", async () => {
  const result = await answerConsult({ merged_facts: 2 }, { answers: ["Dienstag passt"] });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(result.structuredContent, { accepted: true, merged_facts: 2 });
});

test("answer_consult: merged_facts ohne Zahl zaehlt als 0", async () => {
  const result = await answerConsult({ merged_facts: "3" }, { answers: ["Ja"] });
  assert.deepEqual(result.structuredContent, { accepted: true, merged_facts: 0 });
});

test("answer_consult: Gateway-Antwort null wird angenommen und zaehlt 0 Fakten", async () => {
  const result = await answerConsult(null, { answers: ["Ja"] });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { accepted: true, merged_facts: 0 });
});

test("get_call_status: Anruf ohne Transkript -> unvollstaendige Antwort", async () => {
  const withoutTranscript = {
    status: FINISHED_CALL.status,
    startedAt: FINISHED_CALL.startedAt,
    endedAt: FINISHED_CALL.endedAt,
  };
  const result = await callTool(
    { [`GET /api/calls/${CALL_ID}`]: withoutTranscript },
    { tool: "get_call_status", args: { call_id: CALL_ID } },
  );
  assert.equal(result.isError, true);
  assert.equal(toolText(result), INCOMPLETE_ANSWER_DE);
});

test("get_agent_number: Zustand ohne agent -> unvollstaendige Antwort", async () => {
  const result = await callTool(
    { "GET /api/state": { calls: [] } },
    { tool: "get_agent_number", args: undefined },
  );
  assert.equal(result.isError, true);
  assert.equal(toolText(result), INCOMPLETE_ANSWER_DE);
});

function captureRegistrationOrder(ctx) {
  const order = [];
  const fakeServer = {
    registerTool(name) {
      order.push(`tool ${name}`);
    },
    registerResource(name) {
      order.push(`resource ${name}`);
    },
  };
  registerTools(fakeServer, ctx);
  return order;
}

test("[NIE1] Werkzeuge und Widget-Ressourcen erscheinen in der festen Folge, mit und ohne Rueckfrage", () => {
  assert.deepEqual(captureRegistrationOrder({ uiHost: { enabled: true }, consultAllowed: true }), [
    "resource call",
    "tool place_call",
    "tool await_call_event",
    "tool answer_consult",
    "tool get_call_status",
    "tool get_call_result",
    "tool cancel_call",
    "resource my-number",
    "tool get_agent_number",
    "resource calls",
    "tool list_calls",
    "tool check_inbox",
    "tool list_action_items",
    "resource agent-status",
    "tool get_agent_status",
  ]);

  assert.deepEqual(captureRegistrationOrder({ uiHost: { enabled: true }, consultAllowed: false }), [
    "resource call",
    "tool place_call",
    "tool get_call_status",
    "tool get_call_result",
    "tool cancel_call",
    "resource my-number",
    "tool get_agent_number",
    "resource calls",
    "tool list_calls",
    "tool check_inbox",
    "tool list_action_items",
    "resource agent-status",
    "tool get_agent_status",
  ]);
});

const EXPECTED_GATEWAY_ROUTES = [
  "POST /api/calls",
  `GET /api/calls/${CALL_ID}/consult`,
  `GET /api/calls/${CALL_ID}`,
  `POST /api/calls/${CALL_ID}/consult/answer`,
  `GET /api/calls/${CALL_ID}`,
  `GET /api/calls/${CALL_ID}`,
  `POST /api/calls/${CALL_ID}/cancel`,
  "GET /api/state",
  "GET /api/state",
  "POST /api/inbox/poll",
  "GET /api/state",
  "GET /api/state",
];

async function callAllTools(handlers) {
  const callArgs = { call_id: CALL_ID };
  return [
    await handlers.get("place_call")(PLACE_ARGS),
    await handlers.get("await_call_event")(callArgs),
    await handlers.get("answer_consult")({ ...callArgs, event_id: "e1", answers: ["Ja"] }),
    await handlers.get("get_call_status")(callArgs),
    await handlers.get("get_call_result")(callArgs),
    await handlers.get("cancel_call")(callArgs),
    await handlers.get("get_agent_number")(),
    await handlers.get("list_calls")(),
    await handlers.get("check_inbox")({}),
    await handlers.get("list_action_items")(),
    await handlers.get("get_agent_status")(),
  ];
}

function gatewayTrafficOfAllTools({ identity, scopedTenant }) {
  return withGatewayTable(FULL_GATEWAY, async (requests) => {
    const handlers = captureTools({ identity, scopedTenant, consultAllowed: true });
    const results = await callAllTools(handlers);
    return { errors: results.filter((result) => result.isError).map(toolText), requests };
  });
}

const expectedRequests = (identity, tenant) =>
  EXPECTED_GATEWAY_ROUTES.map((route) => ({ route, identity, tenant }));

test("[NIE2] jeder Gateway-Aufruf der elf Werkzeuge traegt Identitaet und Mandant des Aufrufs", async () => {
  const { errors, requests } = await gatewayTrafficOfAllTools({
    identity: "user-ident-7",
    scopedTenant: "tenant-42",
  });
  assert.deepEqual(errors, [], "jedes Werkzeug erreicht das Gateway erfolgreich");
  assert.deepEqual(requests, expectedRequests("user-ident-7", "tenant-42"));
});

test("[NIE2] nur gesetzter Mandant geht ohne Identitaet, aber mit X-Internal-Tenant an jeden Gateway-Aufruf", async () => {
  const { errors, requests } = await gatewayTrafficOfAllTools({
    identity: null,
    scopedTenant: "tenant-42",
  });
  assert.deepEqual(errors, [], "jedes Werkzeug erreicht das Gateway erfolgreich");
  assert.deepEqual(requests, expectedRequests(null, "tenant-42"));
});

const TOOLS_IN_ORDER_WITH_CONSULT = [
  "place_call",
  "await_call_event",
  "answer_consult",
  "get_call_status",
  "get_call_result",
  "cancel_call",
  "get_agent_number",
  "list_calls",
  "check_inbox",
  "list_action_items",
  "get_agent_status",
];

const RESOURCE_RIGHT_BEFORE_TOOL = {
  place_call: "call",
  get_agent_number: "my-number",
  list_calls: "calls",
  get_agent_status: "agent-status",
};

async function listedOverRealSdk(ctx) {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const mcpServer = new McpServer({ name: "hermes-reihenfolge", version: "0.0.0" });
  const resourceBefore = {};
  let lastResource = null;
  const realRegisterTool = mcpServer.registerTool.bind(mcpServer);
  const realRegisterResource = mcpServer.registerResource.bind(mcpServer);
  mcpServer.registerResource = (name, ...rest) => {
    lastResource = name;
    return realRegisterResource(name, ...rest);
  };
  mcpServer.registerTool = (name, ...rest) => {
    if (lastResource !== null) resourceBefore[name] = lastResource;
    lastResource = null;
    return realRegisterTool(name, ...rest);
  };
  registerTools(mcpServer, ctx);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-reihenfolge-client", version: "0.0.0" });
  await Promise.all([mcpServer.connect(serverSide), client.connect(clientSide)]);
  try {
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    return {
      tools: tools.map((tool) => tool.name),
      resources: resources.map((resource) => resource.name),
      resourceBefore,
    };
  } finally {
    await client.close();
    await mcpServer.close();
  }
}

test("[NIE1] echtes MCP-SDK listet Werkzeuge und Widget-Ressourcen in der festen Folge, jede Ressource direkt vor ihrem Werkzeug", async () => {
  const listed = await listedOverRealSdk({ uiHost: { enabled: true }, consultAllowed: true });
  assert.deepEqual(listed.tools, TOOLS_IN_ORDER_WITH_CONSULT);
  assert.deepEqual(listed.resources, ["call", "my-number", "calls", "agent-status"]);
  assert.deepEqual(listed.resourceBefore, RESOURCE_RIGHT_BEFORE_TOOL);

  const withoutConsult = await listedOverRealSdk({
    uiHost: { enabled: true },
    consultAllowed: false,
  });
  assert.deepEqual(
    withoutConsult.tools,
    TOOLS_IN_ORDER_WITH_CONSULT.filter(
      (name) => name !== "await_call_event" && name !== "answer_consult",
    ),
  );
  assert.deepEqual(withoutConsult.resources, ["call", "my-number", "calls", "agent-status"]);
  assert.deepEqual(withoutConsult.resourceBefore, RESOURCE_RIGHT_BEFORE_TOOL);
});

const LISTED_CALLS = [
  {
    id: "c1",
    direction: "outbound",
    to: "+4917212345678",
    status: "completed",
    startedAt: "2026-06-26T10:00:00.000Z",
    summary: "Termin am Dienstag",
  },
  {
    id: "c2",
    direction: "inbound",
    from: "+4930987654",
    status: "completed",
    startedAt: "2026-06-26T11:00:00.000Z",
  },
];

test("list_calls: Zeile mit Zusammenfassung haengt sie mit ' | ' an, Zeile ohne endet am Startzeitpunkt", async () => {
  const result = await callTool(
    { "GET /api/state": { calls: LISTED_CALLS } },
    { tool: "list_calls", args: undefined },
  );
  const [withSummary, withoutSummary] = result.structuredContent.calls;
  assert.deepEqual(toolText(result).split("\n"), [
    `[c1] -> +4917212345678 | completed | ${withSummary.startedAt} | Termin am Dienstag`,
    `[c2] <- +4930987654 | completed | ${withoutSummary.startedAt}`,
  ]);
});
