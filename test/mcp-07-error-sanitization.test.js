// MCP-07 (PLAN-LAUNCH-TESTS.md): MCP 404/Fehlerpfad reicht keinen rohen
// Gateway-Text/Stack durch.
//
// Zwei Fehlerquellen fuer get_call_status/get_transcript/cancel_call:
//   (a) eine nie-existente call_id -> die REST-Routen (routes/api-read.js GET
//       /api/calls/:id, routes/api-calls.js POST /api/calls/:id/cancel) liefern
//       jeweils { error: "not found" }; mcp-tools.js api() wirft
//       new Error(json.error) und der per-handler-Wrapper (wrapHandler)
//       verwandelt das in errText(err.message) -> isError:true, Text = "not found".
//   (b) ein Netzwerkfehler beim Gateway-Fetch (z.B. ECONNREFUSED): fetch() wirft
//       ein TypeError("fetch failed") - die eigentliche Ursache steckt in
//       err.cause (z.B. "connect ECONNREFUSED 127.0.0.1:<port>"), NICHT in
//       err.message. wrapHandler liest nur err.message -> ebenfalls generisch.
//
// Teil (a) laeuft gegen den ECHTEN Spawn-Server (belegt die tatsaechliche
// Routen-Fehlerantwort, kein Mock-Rateraten). Teil (b) nutzt denselben
// Fake-Server-Capture-Seam wie mcp-tools.test.js (server.tool/registerTool als
// reine Erfassung + ein lokaler HTTP-Mock/geschlossener Port spielt das Gateway),
// weil ein echter ECONNREFUSED nur ueber einen bewusst geschlossenen Port
// reproduzierbar ist.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { startServer, mcpPost, toolCall, readToolResult } from "./helpers.js";

const NONEXISTENT_CALL_ID = "call_doesnotexist";

// Verdaechtige Muster, die NIE im Tool-Fehlertext auftauchen duerfen (Stack-Trace,
// Dateipfad, Store-internes Feld, roher Error-Typname).
const LEAK_PATTERNS = [
  /at .*\(.*:\d+:\d+\)/, // Stack-Trace-Zeile
  /\/src\//, // interner Dateipfad
  /node_modules/,
  /TypeError|ReferenceError/,
  /store\.json/,
  /ECONNREFUSED/, // Netzwerk-Detail (steckt in err.cause, darf NICHT durchsickern)
];

function assertNoLeak(text) {
  for (const p of LEAK_PATTERNS) assert.doesNotMatch(text, p, `Leak-Muster ${p} im Fehlertext`);
}

function toolText(result) {
  return (result?.content || []).map((c) => c.text).join("\n");
}

// Fake-MCP-Server-Capture (Muster mcp-tools.test.js): faengt server.tool/registerTool
// als reine Erfassung ab, KEINE SDK-Output-Validierung (fuer Teil (b) irrelevant, da
// isError=true die Validierung ohnehin ueberspringt - s. validateToolOutput im SDK).
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    tool(name, _desc, _schema, handler) {
      handlers.set(name, handler);
    },
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

// Liefert eine URL, auf der garantiert NIEMAND mehr hoert (Server oeffnen, Port
// merken, sofort schliessen) - der naechste fetch() dorthin wirft ECONNREFUSED.
async function closedPortUrl() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return `http://127.0.0.1:${port}`;
}

test("MCP-07a: unbekannte call_id -> get_call_status/get_transcript/cancel_call liefern generischen 'not found'-Text (kein Leak)", async () => {
  const srv = await startServer({});
  try {
    for (const [name, args] of [
      ["get_call_status", { call_id: NONEXISTENT_CALL_ID }],
      ["get_transcript", { call_id: NONEXISTENT_CALL_ID }],
      ["cancel_call", { call_id: NONEXISTENT_CALL_ID }],
    ]) {
      const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall(name, args));
      assert.notEqual(res.status, 401, `${name}: lokaler Aufruf ohne Token muss den Bypass treffen`);
      const result = await readToolResult(res);
      assert.ok(result?.isError, `${name}: unbekannte call_id muss isError=true liefern`);
      const txt = toolText(result);
      assert.match(txt, /not found/i, `${name}: generischer 'not found'-Text erwartet`);
      assertNoLeak(txt);
    }
  } finally {
    await srv.stop();
  }
});

test("MCP-07b: Gateway-Fetch-Fehler (ECONNREFUSED) -> generischer Text, kein err.cause/Netzwerkdetail-Leak", async () => {
  const gatewayUrl = await closedPortUrl();
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = gatewayUrl;
  try {
    const handlers = captureTools({ identity: null, allowCalendar: true });
    for (const name of ["get_call_status", "get_transcript", "cancel_call"]) {
      let result;
      await assert.doesNotReject(async () => {
        result = await handlers.get(name)({ call_id: "call_x" });
      }, `${name}: ECONNREFUSED darf nicht als unhandled throw entkommen`);
      assert.ok(result?.isError, `${name}: ECONNREFUSED muss isError=true liefern`);
      assertNoLeak(toolText(result));
    }
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

