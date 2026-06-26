import { CHATGPT_UI_MIME, CHATGPT_META_KEY, uiResourceUri } from "../contract.js";
import { hasWidget, widgetHtml, widgetTitle } from "../widget-catalog.js";

// ChatGPT-Apps-Adapter (OpenAI "skybridge"). Gleicher UiRenderer-Vertrag wie mcp-native;
// host-spezifisch sind NUR mimeType + die _meta-Form (P0-Befund). Widget-HTML kommt
// host-agnostisch aus dem Katalog (dasselbe Widget rendert in beiden Hosts).
/** @type {import("../ports.js").UiRenderer} */
export const chatgptRenderer = {
  mimeType: CHATGPT_UI_MIME, // "text/html+skybridge"
  hasWidget: (widgetId) => hasWidget(widgetId),
  resourceUri: (widgetId) => uiResourceUri(widgetId), // ui://hermes/<id> (geteiltes Schema)
  registerResource(server, widgetId) {
    const uri = uiResourceUri(widgetId);
    server.registerResource(
      widgetId,
      uri,
      { title: widgetTitle(widgetId), mimeType: CHATGPT_UI_MIME },
      async () => ({ contents: [{ uri, mimeType: CHATGPT_UI_MIME, text: widgetHtml(widgetId) }] }),
    );
  },
  // ChatGPT-Apps: flacher String unter "openai/outputTemplate" (NICHT _meta.ui.resourceUri).
  toolMeta: (widgetId) => ({ [CHATGPT_META_KEY]: uiResourceUri(widgetId) }),
};
