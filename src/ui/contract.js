// SEP-1865 "MCP Apps"-Vertrag, schlank nachgebildet (Owner-Entscheidung 2026-06-26:
// kein @modelcontextprotocol/ext-apps-Dep). EINZIGE Stelle, die die Protokoll-Strings
// kennt - der Rest des Seams referenziert nur diese Konstanten (G5/G17/G35).

// mimeType der UI-Resource: exakt dieser String, sonst rendert kein Host (P0-Befund).
export const UI_MIME = "text/html;profile=mcp-app";
// Client-Capability-Schluessel im initialize-Handshake (capabilities.extensions[...]).
export const UI_CAPABILITY_KEY = "io.modelcontextprotocol/ui";
// _meta-Schluessel am Tool-Deskriptor, der auf die ui://-Resource zeigt.
// In EINER Konstante, falls der reale Namespace spaeter angepasst werden muss (P3).
export const UI_META_KEY = "ui"; // -> _meta.ui.resourceUri

// ui://-URI-Schema fuer Hermes-Widgets. EIN Tenant-freier, statischer URI je Widget
// (die Resource traegt KEINE Daten; Daten fliessen ueber structuredContent, P0-Befund).
const UI_URI_PREFIX = "ui://hermes/";
export const uiResourceUri = (widgetId) => `${UI_URI_PREFIX}${widgetId}`;

// fail-closed: true NUR wenn der Client die UI-Capability mit UI_MIME deklariert.
// Unbekannte/fehlende Struktur -> false (nie werfen, nie fail-open).
export function capabilityDeclaresUi(clientCapabilities) {
  const mimeTypes = clientCapabilities?.extensions?.[UI_CAPABILITY_KEY]?.mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.includes(UI_MIME);
}

// ChatGPT Apps SDK (OpenAI "skybridge"), P0-Befund. Zweiter Host neben MCP-nativ.
// mimeType der UI-Resource in dieser Host-Konvention (disjunkt zu UI_MIME).
export const CHATGPT_UI_MIME = "text/html+skybridge";
// _meta-Schluessel am Tool-Deskriptor; Wert = die ui://-Resource-URI (flacher String,
// NICHT das verschachtelte _meta.ui.resourceUri der MCP-nativen Konvention).
export const CHATGPT_META_KEY = "openai/outputTemplate";

// fail-closed: true NUR wenn der Host die UI-Capability mit CHATGPT_UI_MIME deklariert.
// Symmetrisch zu capabilityDeclaresUi; disjunkter mimeType -> eindeutige Adapter-Wahl.
// Bei abweichendem P0-Beleg aendert sich AUSSCHLIESSLICH dieser Body (fail-closed bleibt
// invariant: kein belegter Marker -> false -> Stufe 0).
export function capabilityDeclaresChatgptUi(clientCapabilities) {
  const mimeTypes = clientCapabilities?.extensions?.[UI_CAPABILITY_KEY]?.mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.includes(CHATGPT_UI_MIME);
}
