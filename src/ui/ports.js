// UI-Ports: host-abstrakter Vertrag fuer Rich-UI-Resources (DIP, analog telephony).
// P1 hat genau EINEN Adapter (MCP-nativ). Reine JSDoc-Typdefs, keine Laufzeit-Logik.

/**
 * @typedef {Object} UiRenderer
 * @property {string} mimeType  - mimeType der erzeugten Resource (P1: UI_MIME).
 * @property {(widgetId: string) => boolean} hasWidget
 *   Kennt dieser Renderer das Widget? (unbekannt -> false -> Stufe 0).
 * @property {(widgetId: string) => string} resourceUri
 *   ui://-URI fuer das Tool-_meta (_meta.ui.resourceUri).
 * @property {(server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer, widgetId: string) => void} registerResource
 *   Registriert die STATISCHE ui://-Resource (self-contained HTML) am McpServer.
 *   Die Resource traegt KEINE Tenant-Daten (Daten -> structuredContent, P0-Befund).
 */
export {};
