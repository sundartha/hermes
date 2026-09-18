import { UI_MIME, UI_META_KEY, makeUiRenderer, uiSubmissionMeta } from "../contract.js";
import { WIDGET_AGENT_STATUS, WIDGET_CALL } from "../widget-catalog.js";

// Re-Export der Widget-Ids: mcp-tools.js + Tests beziehen sie historisch ueber diesen
// Adapter. Reiner Durchreich aus dem host-agnostischen Katalog (keine zweite Quelle).
export { WIDGET_AGENT_STATUS, WIDGET_CALL };

// MCP-nativ (SEP-1865): verschachteltes Objekt unter UI_META_KEY -> _meta.ui.resourceUri.
/** @type {import("../ports.js").UiRenderer} */
export const mcpNativeRenderer = makeUiRenderer({
  mimeType: UI_MIME,
  metaKey: UI_META_KEY,
  // T-30/T-31: die zwei Einreichungs-Pflichtfelder liegen dort, wo resourceUri schon
  // liegt - EINE Stelle. Zur Aufrufzeit ausgewertet (publicUrl kann pro Prozess/Test
  // variieren), nicht zur Modul-Ladezeit.
  buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() }),
});
