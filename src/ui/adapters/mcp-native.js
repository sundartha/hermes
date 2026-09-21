import {
  UI_MIME,
  UI_META_KEY,
  makeUiRenderer,
  uiSubmissionMeta,
  openAiResourceMeta,
} from "../contract.js";
import { WIDGET_AGENT_STATUS, WIDGET_CALL } from "../widget-catalog.js";

// Re-Export der Widget-Ids: mcp-tools.js + Tests beziehen sie historisch ueber diesen
// Adapter. Reiner Durchreich aus dem host-agnostischen Katalog (keine zweite Quelle).
export { WIDGET_AGENT_STATUS, WIDGET_CALL };

// MCP-nativ (SEP-1865): verschachteltes Objekt unter UI_META_KEY -> _meta.ui.resourceUri.
/** @type {import("../ports.js").UiRenderer} */
export const mcpNativeRenderer = makeUiRenderer({
  mimeType: UI_MIME,
  metaKey: UI_META_KEY,
  // Tool-Deskriptor-Haelfte von T-30/T-31 (Standardort fuer Claude/Copilot/Goose; OpenAI
  // liest sie NICHT, s. contract.js beim CHATGPT_UI_MIME-Kommentar und bei
  // uiSubmissionMeta). Zur Aufrufzeit ausgewertet (publicUrl kann pro Prozess/Test
  // variieren), nicht zur Modul-Ladezeit.
  buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() }),
  // P8 (T-30/T-31, wirksame Haelfte fuer OpenAI): openai/widgetCSP + openai/widgetDomain
  // am RESOURCE-Inhalt (resources/read), nicht am Tool-Deskriptor - dort liest OpenAI sie
  // tatsaechlich (contract.js openAiResourceMeta). Der ChatGPT-Adapter uebergibt dieses
  // Feld NICHT (bleibt unveraendert, Test P8-H).
  buildResourceMeta: openAiResourceMeta,
});
