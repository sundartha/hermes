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
  // Tool-Deskriptor-Haelfte von T-30/T-31. RICHTIGGESTELLT (Pruefer-Befund Runde 1,
  // 2026-09-21): das ist KEIN Standardort fuer Claude/Copilot/Goose - kein MCP-Apps-Host
  // liest csp/domain an dieser Stelle (spec.types.d.ts McpUiToolMeta.csp = `never`, s.
  // contract.js beim UI_META_KEY-Kommentar). Bleibt trotzdem stehen: ohne Wirkung fuer
  // jeden Host, nur aus Byte-Stabilitaetsgruenden (Regel 1). Zur Aufrufzeit ausgewertet
  // (publicUrl kann pro Prozess/Test variieren), nicht zur Modul-Ladezeit.
  buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() }),
  // P8 (T-30/T-31, bislang einzige wirksame Haelfte - und die deckt nur den von OpenAI
  // selbst als "Legacy" bezeichneten Alias-Pfad ab, s. contract.js openAiResourceMeta
  // fuer die woertlichen Zitate): openai/widgetCSP + openai/widgetDomain am
  // RESOURCE-Inhalt (resources/read), nicht am Tool-Deskriptor. Weil der ChatGPT-Adapter
  // auf dem Draht tot ist (registry.js, M-1), ist DIESER Renderer hier der einzige, den
  // JEDER Client sieht - auch ein heutiger Claude-Aufruf bekommt dieses zusaetzliche
  // _meta-Feld (Byte-Beweis PLAN-SECURITY.md OpenAI-P8: resources/read ist NICHT mehr
  // byte-identisch, nur tools/list und resources/list sind es noch). Ob ein
  // MCP-Apps-Client dieses zusaetzliche Feld schadlos ignoriert, ist schema-seitig belegt
  // (contract.js, SDK-ResourceContentsSchema), verhaltensseitig aber ohne Live-Probe
  // gegen einen echten Claude-Host weiterhin UNKNOWN (O-P8-2, NICHT erledigt). Der
  // ChatGPT-Adapter uebergibt dieses Feld NICHT (bleibt unveraendert, Test P8-H).
  buildResourceMeta: openAiResourceMeta,
});
