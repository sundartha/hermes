// EINE Quelle fuer die MCP-serverInfo (name/version/icons) - geteilt zwischen dem
// stdio-Server (mcp-server.js, Claude Desktop) und dem HTTP-Server (server.js, POST
// /mcp, Custom Connector claude.ai/ChatGPT). mcp-server.js selbst ist nicht
// importierbar (Top-Level-Seiteneffekt: verbindet einen StdioServerTransport an
// stdin/stdout) - daher dieses eigene Modul statt eines Re-Exports (G5/S2: ohne
// diese Naht muesste ein Versions- oder Icon-Update in zwei Dateien synchron
// gepflegt werden - beide trugen bisher denselben {name,version}-Literal).
//
// icons macht dem MCP-Host im initialize-Handshake ein Hermes-Marken-Icon bekannt
// (ImplementationSchema.icons, SDK bereits installiert, kein Versions-Bump). Ohne
// icons zeigt der Host einen generischen Platzhalter (verifiziert gegen
// claude.ai/customize/connectors). Ob ein Host das Icon in Produktion tatsaechlich
// laden kann (DASHBOARD_PASSWORD sperrt public/ per Basic-Auth), ist NICHT Teil
// dieser Phase - eine Auslieferungs-Ausnahme dafuer braucht eine eigene, separat
// gepruefte Aenderung an server.js.
import { config } from "./config.js";

// Pfad-Praefix + Dateiname fuer das selbst gehostete Marken-Asset unter public/
// (kein Magic-String, G25) - nur innerhalb dieses Moduls gebraucht.
const BRAND_ASSETS_PREFIX = "/brand/";
const HERMES_ICON_FILENAME = "hermes-icon.png";

export const HERMES_SERVER_INFO = {
  name: "hermes",
  version: "0.2.0",
  icons: [
    {
      src: `${config.publicUrl}${BRAND_ASSETS_PREFIX}${HERMES_ICON_FILENAME}`,
      mimeType: "image/png",
      sizes: ["1024x1024"],
    },
  ],
};
