import { CHATGPT_UI_MIME, CHATGPT_META_KEY, makeUiRenderer } from "../contract.js";

// ChatGPT-Apps-Adapter (OpenAI "skybridge") - AUF DEM DRAHT TOT (P8,
// tasks/openai-p8-spec.md §0.3 M-1/§1): wird nur gewaehlt, wenn der initialize-POST die
// Skybridge-Capability traegt, aber genau dieser Response enthaelt keine Tool-Deskriptoren
// und keine Resource-Inhalte; der stateless Transport fuehrt sie nicht zum spaeteren
// tools/list-/resources/read-POST mit. OpenAIs aktuelle Doku beschreibt den MCP-Apps-
// Standard (mimeType text/html;profile=mcp-app, contract.js UI_MIME), nicht dieses
// Format. Gleicher UiRenderer-Vertrag wie mcp-native; host-spezifisch sind NUR mimeType
// ("text/html+skybridge") + die _meta-Form: flacher String unter "openai/outputTemplate"
// (NICHT das verschachtelte _meta.ui.resourceUri der MCP-nativen Konvention). Widget-HTML
// kommt host-agnostisch aus dem Katalog (via Fabrik). Bleibt unveraendert (Owner-Auftrag
// noetig fuer Rueckbau, s. registry.js; Regressions-Pin Test P8-H).
/** @type {import("../ports.js").UiRenderer} */
export const chatgptRenderer = makeUiRenderer({
  mimeType: CHATGPT_UI_MIME,
  metaKey: CHATGPT_META_KEY,
  buildMeta: (uri) => uri,
});
