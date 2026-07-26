// UI-Ports: host-abstrakter Vertrag fuer Rich-UI-Resources (DIP, analog telephony).
// Mehrere Adapter (mcp-native, chatgpt) erfuellen denselben Vertrag. Reine JSDoc-
// Typdefs, keine Laufzeit-Logik.

/**
 * @typedef {Object} UiRenderer
 * @property {string} mimeType  - mimeType der erzeugten Resource (host-spezifisch).
 * @property {(widgetId: string) => boolean} hasWidget
 *   Kennt dieser Renderer das Widget? (unbekannt -> false -> Stufe 0).
 * @property {(widgetId: string) => string} resourceUri
 *   ui://-URI fuer das Tool-_meta (geteiltes Schema ueber alle Hosts).
 * @property {(server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer, widgetId: string, language?: string) => void} registerResource
 *   Registriert die STATISCHE ui://-Resource (self-contained HTML) am McpServer, in
 *   der uebergebenen Agentensprache (P13/E4; fehlend -> englische Fassung).
 *   Die Resource traegt KEINE Tenant-Daten (Daten -> structuredContent, P0-Befund).
 * @property {(widgetId: string) => object} toolMeta
 *   Host-spezifisches _meta-Fragment fuer den Tool-Deskriptor (mcp-nativ:
 *   _meta.ui.resourceUri; ChatGPT: _meta["openai/outputTemplate"]).
 */
export {};
