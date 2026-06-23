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
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

// Startet ein Gateway-Mock, das fuer JEDEN Pfad denselben Body liefert. body=null ->
// leerer 200-Body (-> api() degradiert via res.json().catch zu `{}`): genau der
// still-degradierte Pfad, den AC5 absichert.
async function startGatewayMock({ body = null, status = 200 } = {}) {
  const server = http.createServer((req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(body == null ? "" : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
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
