// UI-Registry: waehlt hinter dem Master-Schalter (config.tenancy.mcpUiEnabled) den EINEN
// Renderer. Seit T2-01 gibt es nur noch mcpNativeRenderer (MCP-Apps-Standard) - der
// ChatGPT-/Skybridge-Adapter ist ersatzlos entfernt (er war auf dem Draht praktisch tot,
// s. Historie in git; der Resource-Inhalt traegt jetzt fuer JEDEN Host denselben _meta-
// Alias openai/widgetDomain, s. contract.js uiResourceMeta). Keine Host-Erkennung mehr:
// der Inhalt ist fuer Claude UND ChatGPT identisch (Plan 2.1).
// Master-Schalter aus -> null (Stufe 0, byte-identisch). stdio (mcp-server.js) liefert
// ebenfalls ein hostHint-Objekt (enabled: config.tenancy.mcpUiEnabled) - dort entscheidet
// allein der Master-Schalter.
import { mcpNativeRenderer } from "./adapters/mcp-native.js";

/**
 * @param {{enabled?: boolean}} hostHint
 * @returns {import("./ports.js").UiRenderer | null}
 */
export function uiRendererFor(hostHint) {
  // Master-Schalter aus / kein Hinweis -> gesamter Rich-UI-Pfad inaktiv (Stufe 0).
  if (!hostHint?.enabled) return null;
  return mcpNativeRenderer;
}
