// P4 / AC5 + AC6: mcp-tools Result-Guard + per-handler Throw-Schutz.
//
// AC5: Die Tool-Handler derefen verschachtelte Felder aus dem api()-Ergebnis
// (r.callId, s.calendar, s.usage, s.agent, s.calls, s.actionItems). api() degradiert
// bei Parse-Fehler zu `{}` (mcp-tools.js: `res.json().catch(() => ({}))`). Auf `{}`
// ist s.calendar undefined -> .length crasht. Ein Result-Guard muss das in eine
// KLARE Tool-Fehlermeldung wandeln statt in einen TypeError (unhandled rejection im
// stdio-Pfad). Leerer Kalender `[]` bleibt valide (kein Guard-Fehler).
//
// AC6: Wirft ein Handler trotzdem, faengt der per-handler-Wrapper das ab und liefert
// eine MCP-Fehlerantwort (isError: true) statt einer process-level unhandled rejection.
// Gilt fuer stdio UND HTTP (registerTools ist geteilt).
//
// Seam: ein lokaler HTTP-Mock spielt das Gateway; GATEWAY_URL zeigt darauf. Ein
// Fake-MCP-Server faengt die per server.tool registrierten Handler ein, sodass der
// Test sie direkt mit den Mock-Antworten aufrufen kann (kein echter MCP-Transport).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";

// Faengt server.tool(name, desc, schema, handler) ein -> Map name -> handler.
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    tool(name, _desc, _schema, handler) {
      handlers.set(name, handler);
    },
    // P1: get_call_status nutzt registerTool/registerResource. Der Stub muss sie
    // kennen, sonst wirft registerTools (TypeError). Capture nach Name (cb an
    // Position 3 bei registerTool). registerResource ist hier ein No-Op.
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

// Bringt einen HTTP-Server auf 127.0.0.1:<random> hoch und liefert URL + close.
// Gemeinsamer Bootstrap/Teardown beider Gateway-Mocks; der Request-Handler bleibt
// je Mock eigen (single body+status vs. sticky-sequence).
async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

// Schreibt eine JSON-Antwort (gemeinsamer content-type + Status). body=null ->
// leerer Body (-> api() degradiert via res.json().catch zu `{}`).
function sendJson(res, { body = null, status = 200 } = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(body == null ? "" : JSON.stringify(body));
}

// Startet ein Gateway-Mock, das fuer JEDEN Pfad denselben Body liefert. body=null ->
// leerer 200-Body (-> api() degradiert via res.json().catch zu `{}`): genau der
// still-degradierte Pfad, den AC5 absichert.
async function startGatewayMock({ body = null, status = 200 } = {}) {
  const server = http.createServer((req, res) => sendJson(res, { body, status }));
  return listen(server);
}

// Gateway-Mock, der pro Request den naechsten Body aus der Liste liefert (letzter
// bleibt sticky). Erlaubt zwei aufeinanderfolgende get_call_status-Polls mit
// unterschiedlichem Call-Zustand (dialing -> answered) gegen DENSELBEN Endpunkt.
async function startGatewayMockSequence(bodies) {
  let i = 0;
  const server = http.createServer((req, res) => {
    sendJson(res, { body: bodies[Math.min(i++, bodies.length - 1)] });
  });
  return listen(server);
}

// Ein Tool-Ergebnis gilt als Fehler, wenn isError gesetzt ist ODER der Text eine
// klare Fehlermeldung traegt. Kein Crash (kein TypeError) ist die Kernbedingung.
function toolText(result) {
  return (result?.content || []).map((c) => c.text).join("\n");
}

test("T-P4-06: degradierte api-Antwort ({}) -> klare Tool-Fehlermeldung, kein .length-Crash", async () => {
  const mock = await startGatewayMock({ body: null }); // leerer Body -> api() liefert {}
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null, allowCalendar: true });

    // get_calendar derefed s.calendar.length -> auf {} ein TypeError. Mit Guard:
    // klare Fehlermeldung (isError) ODER ein sauberer Text, NIE ein unhandled throw.
    let result;
    await assert.doesNotReject(async () => {
      result = await handlers.get("get_calendar")();
    }, "get_calendar darf nicht mit TypeError crashen");
    assert.ok(result?.isError, "degradierte Antwort -> isError-Tool-Antwort");
    assert.doesNotMatch(
      toolText(result),
      /Cannot read|undefined|TypeError/i,
      "kein roher Deref-Fehler",
    );

    // get_agent_status derefed s.agent.number + s.usage.calls/costEur -> ebenfalls Guard.
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

test("T-P4-06b: leerer Kalender ([]) bleibt valide -> 'Kalender ist leer.', kein Fehler", async () => {
  // Guard prueft Existenz/Typ (Array), NICHT Nicht-Leere: [] ist ein gueltiger Zustand.
  const mock = await startGatewayMock({ body: { calendar: [] } });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null, allowCalendar: true });
    const result = await handlers.get("get_calendar")();
    assert.ok(!result?.isError, "leerer Kalender ist KEIN Fehler");
    assert.match(toolText(result), /Kalender ist leer/);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("T-P4-07: Handler-Throw (Gateway 500) -> MCP-Fehlerantwort, keine unhandled rejection", async () => {
  // Gateway antwortet 500 mit error-Body -> api() wirft (json.error). Ohne per-handler
  // catch wuerde das im stdio-Pfad zur process-level unhandled rejection. Mit Wrapper:
  // sauberes isError-Tool-Ergebnis. Wir verifizieren zusaetzlich, dass KEIN
  // unhandledRejection-Event feuert.
  const mock = await startGatewayMock({ body: { error: "boom" }, status: 500 });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  const rejections = [];
  const onRejection = (e) => rejections.push(e);
  process.on("unhandledRejection", onRejection);
  try {
    const handlers = captureTools({ identity: null, allowCalendar: true });
    let result;
    await assert.doesNotReject(async () => {
      result = await handlers.get("get_my_number")();
    }, "Handler-Throw darf nicht als Rejection entkommen");
    assert.ok(result?.isError, "Gateway-Fehler -> isError-Tool-Antwort");
    // dem Tick Zeit geben, eine etwaige Rejection zu feuern
    await new Promise((r) => setImmediate(r));
    assert.equal(rejections.length, 0, "keine unhandled rejection");
  } finally {
    process.removeListener("unhandledRejection", onRejection);
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

test("T-C3-01: duration_s springt bei markAnswered nicht zurueck (Monotonie)", async () => {
  // Anker-Beweis ueber zwei Polls. Zeitstempel relativ zu 'jetzt', sodass die Dauer
  // ueber 'end = now' laeuft (genau der Live-Pfad, in dem der Bug auftrat). Die Luecke
  // 10s (seit Start) vs 1s (seit Antwort) ist um Groessenordnungen groesser als die
  // Sub-ms-Jitter zwischen den beiden Mock-Requests -> deterministisch.
  const base = Date.now();
  const startedAt = new Date(base - 10_000).toISOString();
  const dialing = { status: "active", startedAt, transcript: [] }; // kein answeredAt
  const answered = {
    status: "active",
    startedAt,
    answeredAt: new Date(base - 1_000).toISOString(),
    transcript: [],
  };
  const mock = await startGatewayMockSequence([dialing, answered]);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null, allowCalendar: true });
    const poll1 = await handlers.get("get_call_status")({ call_id: "call_1" });
    const poll2 = await handlers.get("get_call_status")({ call_id: "call_1" });
    const d1 = poll1.structuredContent.duration_s;
    const d2 = poll2.structuredContent.duration_s;
    assert.equal(poll1.structuredContent.status, "dialing");
    assert.equal(poll2.structuredContent.status, "in_progress");
    assert.ok(d1 >= 9, `Poll 1 misst seit startedAt (~10s), war ${d1}`);
    assert.ok(d2 >= d1, `Monotonie verletzt: Poll 2 (${d2}) < Poll 1 (${d1})`);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});

// ---- S1-5: list_action_items gegen 3 Fixtures (gemischt/leer/Termin-Praefix) ----

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
    const handlers = captureTools({ identity: null, allowCalendar: true });
    const result = await handlers.get("list_action_items")();
    const text = toolText(result);
    assert.match(text, /\[a1\] Rueckruf/);
    assert.match(text, /\[a2\] \(Termin\) Zahnarzt/);
    assert.doesNotMatch(text, /a3/, "erledigtes Item (done:true) darf nicht auftauchen");
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
    const handlers = captureTools({ identity: null, allowCalendar: true });
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
    const handlers = captureTools({ identity: null, allowCalendar: true });
    const result = await handlers.get("list_action_items")();
    const lines = toolText(result).split("\n");
    const todoLine = lines.find((l) => l.startsWith("[b1]"));
    const apptLine = lines.find((l) => l.startsWith("[b2]"));
    assert.equal(todoLine, "[b1] Einkaufen");
    assert.equal(apptLine, "[b2] (Termin) Friseur");
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
    answeredAt: "2026-06-26T10:00:05.000Z", // 5s nach Start
    endedAt: "2026-06-26T10:01:05.000Z", // 65s nach Start, 60s nach Antwort
    transcript: [],
  };
  const mock = await startGatewayMock({ body });
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    const handlers = captureTools({ identity: null, allowCalendar: true });
    const r = await handlers.get("get_call_status")({ call_id: "call_1" });
    assert.equal(
      r.structuredContent.duration_s,
      65,
      "Anker = startedAt (nicht 60 = answeredAt)",
    );
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
});
