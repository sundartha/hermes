import { CHATGPT_UI_MIME, CHATGPT_META_KEY, makeUiRenderer } from "../contract.js";

// ChatGPT-Apps-Adapter (OpenAI "skybridge"). Gleicher UiRenderer-Vertrag wie mcp-native;
// host-spezifisch sind NUR mimeType ("text/html+skybridge") + die _meta-Form (P0-Befund):
// flacher String unter "openai/outputTemplate" (NICHT das verschachtelte _meta.ui.resourceUri
// der MCP-nativen Konvention). Widget-HTML kommt host-agnostisch aus dem Katalog (via Fabrik).
/** @type {import("../ports.js").UiRenderer} */
export const chatgptRenderer = makeUiRenderer({
  mimeType: CHATGPT_UI_MIME,
  metaKey: CHATGPT_META_KEY,
  buildMeta: (uri) => uri,
});
