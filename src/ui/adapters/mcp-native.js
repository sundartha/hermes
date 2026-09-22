import { UI_MIME, UI_META_KEY, makeUiRenderer } from "../contract.js";
import { WIDGET_AGENT_STATUS, WIDGET_CALL } from "../widget-catalog.js";

// Re-Export der Widget-Ids: mcp-tools.js + Tests beziehen sie historisch ueber diesen
// Adapter. Reiner Durchreich aus dem host-agnostischen Katalog (keine zweite Quelle).
export { WIDGET_AGENT_STATUS, WIDGET_CALL };

// MCP-nativ (SEP-1865): verschachteltes Objekt unter UI_META_KEY -> _meta.ui.resourceUri.
// Seit T2-01 traegt der Tool-Deskriptor NUR noch resourceUri - csp/Origin (T-30/T-31)
// sitzen am Resource-Inhalt (uiResourceMeta() in contract.js, ueber registerResource),
// nicht mehr hier (kein MCP-Apps-Host liest csp/domain am Tool-Deskriptor).
/** @type {import("../ports.js").UiRenderer} */
export const mcpNativeRenderer = makeUiRenderer({
  mimeType: UI_MIME,
  metaKey: UI_META_KEY,
  buildMeta: (uri) => ({ resourceUri: uri }),
});
