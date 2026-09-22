// UI-Ports: host-abstrakter Vertrag fuer Rich-UI-Resources (DIP, analog telephony).
// Seit T2-01 genau ein Adapter (mcp-native, MCP-Apps-Standard fuer JEDEN Host). Reine
// JSDoc-Typdefs, keine Laufzeit-Logik.

/**
 * @typedef {Object} UiRenderer
 * @property {string} mimeType  - mimeType der erzeugten Resource (host-spezifisch).
 * @property {(widgetId: string) => boolean} hasWidget
 *   Kennt dieser Renderer das Widget? (unbekannt -> false -> Stufe 0).
 * @property {(widgetId: string) => string} resourceUri
 *   ui://-URI fuer das Tool-_meta (geteiltes Schema ueber alle Hosts).
 * @property {(server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer, widgetId: string, options?: {language?: string, chatgptEgress?: boolean}) => void} registerResource
 *   Registriert die STATISCHE ui://-Resource (self-contained HTML) am McpServer, in
 *   der uebergebenen Agentensprache (P13/E4; fehlend -> englische Fassung).
 *   Die Resource traegt KEINE Tenant-Daten (Daten -> structuredContent, P0-Befund).
 *   options.chatgptEgress (T2-01 Nachbau, Default false): NUR wenn true, traegt der
 *   Resource-Inhalt zusaetzlich zum Alias openai/widgetDomain auch `_meta.ui.domain`
 *   (contract.js uiResourceMeta) - true kommt ausschliesslich aus einer serverseitigen
 *   ChatGPT-Egress-IP-Erkennung (chatgpt-egress.js), NIE aus Client-Eingabe.
 * @property {(widgetId: string) => object} toolMeta
 *   _meta-Fragment fuer den Tool-Deskriptor (_meta.ui.resourceUri). csp/Origin (T-30/T-31)
 *   liegen NICHT hier, sondern am Resource-Inhalt (s. contract.js uiResourceMeta).
 */
export {};
