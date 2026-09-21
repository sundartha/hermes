import { CHATGPT_UI_MIME, CHATGPT_META_KEY, makeUiRenderer } from "../contract.js";

// ChatGPT-Apps-Adapter (OpenAI "skybridge") - AUF DEM DRAHT PRAKTISCH TOT (P8,
// tasks/openai-p8-spec.md §0.3 M-1/§1): gewaehlt wird er, wenn der Request, der die
// Tool-/Resource-Antwort erzeugt, die Skybridge-Capability traegt. Am zustandslosen
// Transport kommt eine im initialize-POST gesendete Capability beim naechsten Request
// nicht mehr an - kein standardkonformer Client (Claude, ChatGPT) sendet sie ausserhalb
// des initialize, also erreicht ihn in der Praxis niemand. OpenAIs aktuelle Doku
// beschreibt zudem den MCP-Apps-Standard (mimeType text/html;profile=mcp-app,
// contract.js UI_MIME), nicht dieses Format. Gleicher UiRenderer-Vertrag wie
// mcp-native; host-spezifisch sind NUR mimeType
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
