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
// claude.ai/customize/connectors). Ein MCP-Host laedt icons[0].src OHNE Dashboard-
// Credentials - server.js braucht dafuer eine eng begruendete Basic-Auth-Ausnahme
// fuer BRAND_ASSETS_PREFIX (siehe dort), sonst waere dieses Feld in Produktion
// (DASHBOARD_PASSWORD gesetzt) wirkungslos.
import { config } from "./config.js";

// Pfad-Praefix fuer selbst gehostete Marken-Assets unter public/ (kein Magic-String,
// G25) - server.js braucht denselben Wert fuer die Basic-Auth-Ausnahme.
export const BRAND_ASSETS_PREFIX = "/brand/";
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
