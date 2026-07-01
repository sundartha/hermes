import { UI_MIME, UI_META_KEY, uiResourceUri } from "../contract.js";
import {
  WIDGET_CALL_STATUS,
  WIDGET_CALL_RESULT,
  WIDGET_TRANSCRIPT,
  WIDGET_AGENT_STATUS,
  WIDGET_CALL,
  hasWidget,
  widgetHtml,
  widgetTitle,
} from "../widget-catalog.js";

// Re-Export der Widget-Ids: mcp-tools.js + Tests beziehen sie historisch ueber diesen
// Adapter. Reiner Durchreich aus dem host-agnostischen Katalog (keine zweite Quelle).
export { WIDGET_CALL_STATUS, WIDGET_CALL_RESULT, WIDGET_TRANSCRIPT, WIDGET_AGENT_STATUS, WIDGET_CALL };

/** @type {import("../ports.js").UiRenderer} */
export const mcpNativeRenderer = {
  mimeType: UI_MIME,
  hasWidget: (widgetId) => hasWidget(widgetId),
  resourceUri: (widgetId) => uiResourceUri(widgetId),
  registerResource(server, widgetId) {
    const uri = uiResourceUri(widgetId);
    server.registerResource(
      widgetId,
      uri,
      { title: widgetTitle(widgetId), mimeType: UI_MIME },
      async () => ({ contents: [{ uri, mimeType: UI_MIME, text: widgetHtml(widgetId) }] }),
    );
  },
  // MCP-nativ (SEP-1865): verschachteltes Objekt unter UI_META_KEY -> _meta.ui.resourceUri.
  toolMeta: (widgetId) => ({ [UI_META_KEY]: { resourceUri: uiResourceUri(widgetId) } }),
};
