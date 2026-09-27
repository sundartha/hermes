// UI-Registry: waehlt hinter dem Master-Schalter (config.tenancy.mcpUiEnabled) den EINEN
// Renderer. Seit T2-01 gibt es nur noch mcpNativeRenderer (MCP-Apps-Standard) - der
// ChatGPT-/Skybridge-Adapter ist ersatzlos entfernt (er war auf dem Draht praktisch tot,
// s. Historie in git; der Resource-Inhalt traegt fuer JEDEN Host denselben _meta-Alias
// openai/widgetDomain, s. contract.js uiResourceMeta). Keine Host-Erkennung AUF DIESER
// EBENE: es gibt weiterhin nur EINEN Renderer, keine Auswahl zwischen mehreren Adaptern
// je Host. Seit dem T2-01-Nachbau (ChatGPT-Egress-Erkennung, chatgpt-egress.js) ist der
// von diesem EINEN Renderer erzeugte Resource-INHALT trotzdem nicht mehr zwingend
// byte-identisch: registerResource() bekommt ein zusaetzliches chatgptEgress-Flag
// (ueber mcp-tools.js/routes/mcp.js durchgereicht, NICHT hier aufgeloest), das
// ausschliesslich steuert, ob `_meta.ui.domain` ZUSAETZLICH zum Alias gesetzt wird.
// Master-Schalter aus -> null (Stufe 0, byte-identisch). stdio (mcp-server.js) liefert
// ebenfalls ein hostHint-Objekt (enabled: config.tenancy.mcpUiEnabled) - dort entscheidet
// allein der Master-Schalter, und chatgptEgress wird nie gesetzt (keine Client-IP).
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
