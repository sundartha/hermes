// T-15: securitySchemes an der SDK-Grenze (Weg B, Low-Level-Override).
//
// Warum kein SDK-Andockpunkt existiert: registerTool() destrukturiert eine FESTE
// Feldliste ({ title, description, inputSchema, outputSchema, annotations, _meta },
// node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:702-703) und verwirft
// alles andere still; der ListTools-Handler baut den Deskriptor aus derselben festen
// Feldliste neu (mcp.js:67-95). `grep -rl securitySchemes node_modules/` liefert 0
// Treffer - das Feld existiert im installierten SDK (1.29.0) und in der neuesten
// Version (1.30.0, geprueft in Phase 0/P3) nirgends.
//
// Der Original-Handler wird AUFGERUFEN und angereichert, die Liste wird NICHT neu
// gebaut - sonst gingen die Zod-Normalisierung und das outputSchema verloren (Pre-
// Mortem #1 der Spec). Der einzige erreichbare Andockpunkt fuer den Original-Handler
// ist das PRIVATE Feld server.server._requestHandlers: setRequestHandler()
// ueberschreibt nur (shared/protocol.js:886-892), removeRequestHandler() loescht, gibt
// aber nichts zurueck. Der Lerntest (test/openai-p3-security-schemes.test.js) pinnt
// diese Naht gegen ein SDK-Update, das das Feld umbenennt.
//
// Der Wert ist fuer alle Werkzeuge identisch: es gibt genau einen Auth-Mount-Punkt
// (POST /mcp, src/routes/mcp.js), kein Werkzeug ist ohne Token erreichbar, also ist
// "noauth" falsch. Die Scope-Liste bleibt leer, weil der Anbieter keinen fachlichen
// Scope-Claim liest oder ausstellt - eine erfundene Scope-Liste waere eine
// Falschangabe (E1, D0-7).
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const TOOL_SECURITY_SCHEMES = Object.freeze([
  Object.freeze({ type: "oauth2", scopes: Object.freeze([]) }),
]);

const LIST_TOOLS_METHOD = "tools/list";

// Dasselbe (eingefrorene) Array wird jedem Deskriptor angehaengt - es gibt keinen
// fachlichen Unterschied zwischen den Werkzeugen, ein neues Array pro Werkzeug waere
// nur Zuweisungsrauschen um denselben Wert.
const mitSecuritySchemes = (tool) => ({ ...tool, securitySchemes: TOOL_SECURITY_SCHEMES });

// Reichert den tools/list-Handler eines bereits mit registerTools() befuellten
// McpServer um securitySchemes an. Wird NACH registerTools() aufgerufen - NUR an der
// HTTP-Zusammenbau-Stelle (src/routes/mcp.js), wo mcpAuth tatsaechlich eine
// Client-Identitaet prueft. src/mcp-server.js (stdio) ruft diese Funktion bewusst
// NICHT auf: stdio hat keine Client-Auth, "oauth2" waere dort eine Falschangabe, und
// OpenAI (T-15) erreicht den Server nie ueber stdio. Siehe Kommentar dort.
export function applyToolSecuritySchemes(server) {
  const protokoll = server.server;
  const original = protokoll._requestHandlers?.get(LIST_TOOLS_METHOD);
  if (!original)
    throw new Error(
      "MCP-SDK-Naht verloren: kein tools/list-Handler zum Anreichern (securitySchemes, T-15)",
    );
  protokoll.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const ergebnis = await original(request, extra);
    return { ...ergebnis, tools: ergebnis.tools.map(mitSecuritySchemes) };
  });
}
