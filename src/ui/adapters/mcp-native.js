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
  // Tool-Deskriptor-Haelfte von T-30/T-31. RICHTIGGESTELLT (Pruefer-Befund Runde 1,
  // 2026-09-21): das ist KEIN Standardort fuer Claude/Copilot/Goose - kein MCP-Apps-Host
  // liest csp/domain an dieser Stelle (spec.types.d.ts McpUiToolMeta.csp = `never`, s.
  // contract.js beim UI_META_KEY-Kommentar). Bleibt trotzdem stehen: ohne Wirkung fuer
  // jeden Host, nur aus Byte-Stabilitaetsgruenden (Regel 1). Zur Aufrufzeit ausgewertet
  // (publicUrl kann pro Prozess/Test variieren), nicht zur Modul-Ladezeit.
  buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() }),
  // KEIN buildResourceMeta (Pruefer-Befund Runde 2, 2026-09-21 - zurueckgenommen, s.
  // contract.js beim OPENAI_WIDGET_*-Absatz fuer die vollstaendige Begruendung): dieser
  // Renderer ist der EINZIGE, den je ein realer Client sieht (der ChatGPT-Adapter ist
  // tot, s.o.) - jedes zusaetzliche _meta hier ginge unconditional an heutige
  // Claude-Nutzer, ohne Live-Beleg, dass ein MCP-Apps-Host es unveraendert schluckt
  // (Regel 1). resources/read bleibt deshalb exakt { uri, mimeType, text } wie vor P8.
});
