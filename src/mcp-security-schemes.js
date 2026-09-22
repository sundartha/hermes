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
// Der Wert ist fuer alle Werkzeuge identisch (innerhalb eines Modus): es gibt genau
// einen Auth-Mount-Punkt (POST /mcp, src/routes/mcp.js). Die Scope-Liste (T-16, T2-23)
// ist die vom Auth-Server beworbene Identitaets-Scope-Menge S (src/auth.js
// OAUTH_SCOPES, einzige Quelle der Literale) - KEIN fachlicher Hermes-
// Berechtigungs-Scope; D0-7 ("kein Scope konsumiert/beworben") ist durch T-16
// ueberholt. Die fachliche Zugriffsgrenze bleibt unveraendert Audience +
// Mandantenbindung (rejectIfNoTenant, src/routes/mcp.js).
//
// T2-23-Nachtrag (unabhaengiger Pruefer, 2026-09-22): der obige Satz "kein Werkzeug
// ist ohne Token erreichbar, also ist noauth falsch" galt nur fuer den oauth-Modus -
// im Token-/Legacy-Modus (MCP_AUTH=token oder "") wurde trotzdem IMMER "oauth2" mit
// der vollen Scope-Menge gemeldet, obwohl dort gar kein OAuth-Flow existiert
// (Ist-Zustand VOR diesem Nachtrag: eine ueberzeichnete Angabe, Regression dieser
// Phase). securitySchemes muss den TATSAECHLICH aktiven Modus abbilden.
//
// Spec-Beleg (developers.openai.com/apps-sdk/build/auth, Abschnitt "Security
// Schemes", woertlich): "Two scheme types are available today, [...]: `noauth`: The
// tool is callable anonymously; ChatGPT can run it immediately. `oauth2`: The tool
// needs an OAuth 2.0 access token; include the scopes you will request so the
// consent screen is accurate." Einen dritten Typ (z.B. fuer einen statischen
// Bearer-Token/API-Key) kennt die Spec NICHT.
//
// Modus-Abbildung (mcpAuth, src/auth.js):
// - MCP_AUTH=oauth: "oauth2" mit der vollen beworbenen Scope-Menge S (unveraendert).
// - MCP_AUTH=off: mcpAuth laesst hier JEDEN Request unbedingt durch (auth.js:226,
//   `if (config.auth.mcpAuth === "off") return next();`, kein Bypass-Vorbehalt wie
//   beim Legacy-Zweig) - das ist die einzige Konstellation, in der "noauth" wahr ist:
//   echt anonym erreichbar, in jeder Umgebung.
// - MCP_AUTH=token / Legacy (statischer Bearer-Token per safeEqual ODER, ausserhalb
//   Produktion ohne gesetzten Token, der lokale Socket-Bypass): weder "noauth" (ein
//   Request ohne das richtige Credential wird abgelehnt, safeEqual-Vergleich oder
//   401) noch "oauth2" (kein Autorisierungsserver, kein Token-Flow, keine Scopes) ist
//   wahr. Da die Spec keinen dritten Typ anbietet, ist die einzig ehrliche Angabe
//   dasselbe Muster wie am stdio-Pfad (src/mcp-server.js, das den Override seit der
//   T-15-Korrektur bewusst NICHT aufruft): securitySchemes bleibt WEG, statt einen
//   der beiden falschen Typen zu waehlen.
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { OAUTH_SCOPES } from "./auth.js";

export const TOOL_SECURITY_SCHEMES = Object.freeze([
  Object.freeze({ type: "oauth2", scopes: OAUTH_SCOPES }),
]);

// MCP_AUTH=off: echt anonym erreichbar (s. Kommentar oben) - der einzige Fall, in dem
// der zweite von der Spec definierte Typ zutrifft.
export const NOAUTH_TOOL_SECURITY_SCHEMES = Object.freeze([Object.freeze({ type: "noauth" })]);

const LIST_TOOLS_METHOD = "tools/list";

// Liefert die fuer einen mcpAuth-Modus ehrliche Angabe, oder null, wenn keine der
// beiden Spec-Typen zutrifft (Token-/Legacy-Modus - Feld bleibt dann weg, s.
// Kommentar oben). Reine Funktion des uebergebenen Modus (kein Config-Zugriff) -
// leicht zu testen ohne Server/Prozess.
function activeSecuritySchemes(mcpAuthMode) {
  if (mcpAuthMode === "oauth") return TOOL_SECURITY_SCHEMES;
  if (mcpAuthMode === "off") return NOAUTH_TOOL_SECURITY_SCHEMES;
  return null;
}

// Dasselbe (eingefrorene) Array wird jedem Deskriptor angehaengt - es gibt keinen
// fachlichen Unterschied zwischen den Werkzeugen, ein neues Array pro Werkzeug waere
// nur Zuweisungsrauschen um denselben Wert. schemes=null (Token-/Legacy-Modus) laesst
// das Tool unveraendert - kein Feld ist ehrlicher als ein falsches.
const mitSecuritySchemes = (tool, schemes) => (schemes ? { ...tool, securitySchemes: schemes } : tool);

// Reichert den tools/list-Handler eines bereits mit registerTools() befuellten
// McpServer um securitySchemes an. Wird NACH registerTools() aufgerufen - NUR an der
// HTTP-Zusammenbau-Stelle (src/routes/mcp.js), wo mcpAuth tatsaechlich eine
// Client-Identitaet prueft. src/mcp-server.js (stdio) ruft diese Funktion bewusst
// NICHT auf: stdio hat keine Client-Auth, "oauth2" waere dort eine Falschangabe, und
// OpenAI (T-15) erreicht den Server nie ueber stdio. Siehe Kommentar dort.
//
// mcpAuthMode injizierbar mit Produktions-Default aus config.auth.mcpAuth (gleiches
// Muster wie legacyLocalBypassAllowed in src/auth.js, dort "productionFootguns"
// genannt) - unit-testbar ohne Server/Prozessneustart, obwohl config.js den echten
// Wert nur einmal beim Modul-Import aus process.env liest.
export function applyToolSecuritySchemes(server, mcpAuthMode = config.auth.mcpAuth) {
  const protokoll = server.server;
  const original = protokoll._requestHandlers?.get(LIST_TOOLS_METHOD);
  if (!original)
    throw new Error(
      "MCP-SDK-Naht verloren: kein tools/list-Handler zum Anreichern (securitySchemes, T-15)",
    );
  const schemes = activeSecuritySchemes(mcpAuthMode);
  protokoll.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const ergebnis = await original(request, extra);
    return { ...ergebnis, tools: ergebnis.tools.map((tool) => mitSecuritySchemes(tool, schemes)) };
  });
}
