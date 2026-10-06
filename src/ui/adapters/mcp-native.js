import { UI_MIME, UI_META_KEY, makeUiRenderer } from "../contract.js";
import { WIDGET_AGENT_STATUS, WIDGET_CALL } from "../widget-catalog.js";

export { WIDGET_AGENT_STATUS, WIDGET_CALL };

export const mcpNativeRenderer = makeUiRenderer({
  mimeType: UI_MIME,
  metaKey: UI_META_KEY,
  buildMeta: (uri) => ({ resourceUri: uri }),
});
