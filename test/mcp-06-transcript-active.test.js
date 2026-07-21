// MCP-06 (PLAN-LAUNCH-TESTS.md): get_transcript waehrend status=active vs. outputSchema.
//
// get_transcript traegt ein outputSchema (TRANSCRIPT_OUTPUT, mcp-tools.js). Der
// "Call laeuft noch"-Hinweispfad (status === "active") liefert aber NUR content
// (ueber den text()-Helper) OHNE structuredContent. Der echte MCP-SDK-Server
// validiert nach jedem Tool-Aufruf per validateToolOutput(): hat das Tool ein
// outputSchema UND ist isError NICHT gesetzt, verlangt er structuredContent -
// fehlt es, wirft er einen McpError("Output validation error: ... hat ein
// outputSchema aber keinen structuredContent geliefert"), der Server faengt ihn
// intern ab und liefert ihn als isError:true-Tool-Ergebnis zurueck (siehe
// node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js,
// validateToolOutput + der CallToolRequestSchema-Handler).
//
// Diese Kollision laesst sich NUR ueber den echten MCP-Transport beobachten - der
// in mcp-tools.test.js/mcp-ui.test.js verwendete Fake-Server (server.tool/
// registerTool als reine Erfassung) ruft KEINE SDK-Validierung auf. Deshalb nutzt
// dieser Test den echten Spawn-Server + die echte POST /mcp-Route (routes/mcp.js:
// echter McpServer + StreamableHTTPServerTransport pro Request), wie
// am6-oauth-tenant.test.js.
//
// Erwartet (Plan): "Hinweismeldung ohne SDK-Validierungsfehler; Live-Client sieht
// Hinweis, keinen Fehler". Der Test prueft GENAU das - und dokumentiert damit,
// falls er rot ist, eine echte Produktluecke (siehe Kommentar im Testfall).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, mcpPost, toolCall, readToolResult } from "./helpers.js";

function toolText(result) {
  return (result?.content || []).map((c) => c.text).join("\n");
}

test("MCP-06: get_transcript waehrend status=active liefert Hinweis OHNE SDK-outputSchema-Fehler", async () => {
  const seed = seedState({
    calls: [seedCall({ id: "call_active", status: "active" })],
  });
  const srv = await startServer({ seed });
  try {
    const res = await mcpPost(
      `${srv.localUrl}/mcp`,
      null, // Legacy-Socket-Bypass (MCP_AUTH="" + localhost, s. auth.js) - kein Token noetig
      toolCall("get_transcript", { call_id: "call_active" }),
    );
    assert.notEqual(res.status, 401, "lokaler Aufruf ohne Token muss den Bypass treffen");
    const result = await readToolResult(res);

    // GAP-DOKUMENTATION (MCP-06): faellt diese Assertion, hat der aktive-Call-
    // Hinweispfad den SDK-Output-Validierungsfehler ausgeloest statt der
    // freundlichen Meldung - ein echter Produktbug (kein Test-Artefakt), siehe
    // Datei-Kommentar oben. Fix waere in src/mcp-tools.js (get_transcript, aktiver
    // Zweig braeuchte structuredContent ODER isError:true statt eines blossen
    // text()-Hinweises), NICHT Teil dieser Test-Session.
    assert.ok(
      !result?.isError,
      `MCP-06: get_transcript(status=active) loeste einen SDK-Output-Validierungsfehler aus ` +
        `statt einer reinen Hinweismeldung. Ergebnis: ${JSON.stringify(result)}`,
    );
    assert.match(
      toolText(result),
      /Anruf laeuft noch/,
      "Hinweistext fuer einen noch aktiven Call erwartet",
    );
  } finally {
    await srv.stop();
  }
});
