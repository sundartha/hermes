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
// icons zeigt der Host einen generischen Platzhalter. icons[0] ist ein data-URI
// (brand-icon-data.js): Hosts validieren http(s)-Icon-URLs gegen den
// Connector-Origin, und der Dienst laeuft unter mehreren Origins (onrender.com +
// app.sundartha.com) - empirischer Befund 2026-07-02: der Connector laeuft ueber
// app.sundartha.com, die http(s)-Icon-URL zeigte via PUBLIC_URL auf onrender.com,
// claude.ai zeigte den Default-Wuerfel. Die eingebettete Ressource ist
// origin-unabhaengig und funktioniert auch im stdio-Transport (Claude Desktop).
// Die https-Variante bleibt als icons[1] fuer Hosts, die adressierbare/grosse
// Icons bevorzugen; ein MCP-Host laedt sie OHNE Dashboard-Credentials -
// server.js braucht dafuer die eng begruendete Basic-Auth-Ausnahme fuer
// BRAND_ASSETS_PREFIX (siehe dort), sonst waere sie in Produktion
// (DASHBOARD_PASSWORD gesetzt) wirkungslos.
import { config } from "./config.js";
import { HERMES_ICON_DATA_URI, HERMES_ICON_SIZE } from "./brand-icon-data.js";
import { uiServerExtension } from "./ui/contract.js";

// Pfad-Praefix fuer selbst gehostete Marken-Assets unter public/ (kein Magic-String,
// G25) - server.js braucht denselben Wert fuer die Basic-Auth-Ausnahme.
export const BRAND_ASSETS_PREFIX = "/brand/";
const HERMES_ICON_FILENAME = "hermes-icon.png";

export const HERMES_SERVER_INFO = {
  name: "hermes",
  version: "0.2.0",
  // Marken-Homepage (Implementation.websiteUrl): manche Hosts leiten ihr
  // Connector-Branding (Icon/Link) von der Website-Domain ab statt aus icons -
  // deshalb liegt dort zusaetzlich ein favicon.ico (apps/web/public).
  //
  // Bewusst die www-Variante (301 auf den Apex - dieselbe Site): Hosts, die ihr
  // Icon ueber Googles Favicon-Dienst aufloesen, treffen damit einen sauberen
  // Cache-Schluessel.
  //
  // FUER claude.ai bringt websiteUrl NICHTS - empirisch belegt 2026-07-13
  // (Connector neu verbunden, serverInfo also frisch gelesen): der Host leitet
  // die Icon-Domain aus der Connector-URL ab (app.sundartha.com -> eTLD+1) und
  // rendert google.com/s2/favicons?domain=sundartha.com; websiteUrl und icons
  // werden ignoriert. Nicht wieder als Icon-Hebel probieren.
  //
  // Der graue Wuerfel dort ist KEIN Code-Problem: s2 loest hart auf den
  // http-Origin auf, und Googlebot lief am 23.06.2026 auf http://sundartha.com/
  // in unsere Basic-Auth (401, in der Search Console sichtbar) - Google hat
  // deshalb nie ein Favicon fuer diesen Origin. Behoben wird das ausserhalb des
  // Codes (Search Console: http-Property + Recrawl), nicht hier.
  websiteUrl: "https://www.sundartha.com",
  icons: [
    {
      src: HERMES_ICON_DATA_URI,
      mimeType: "image/png",
      sizes: [HERMES_ICON_SIZE],
    },
    {
      src: `${config.server.publicUrl}${BRAND_ASSETS_PREFIX}${HERMES_ICON_FILENAME}`,
      mimeType: "image/png",
      sizes: ["1024x1024"],
    },
  ],
};

// AL-P13: Server-Instruktionen fuer den MCP-Host. ACHTUNG: `instructions` ist ein Feld
// von ServerOptions, NICHT von Implementation - in HERMES_SERVER_INFO gesetzt wuerde es
// still verworfen. Deshalb liegt hier NUR der Text plus der Options-Bauer; eingesetzt
// wird er in routes/mcp.js.
// EINSPRACHIG ENGLISCH (O14): nur das Client-Modell liest ihn, nie der Tenant.
export const MCP_CONSULT_INSTRUCTIONS =
  "While a call placed with place_call is running, keep calling await_call_event with " +
  "that call_id, again and again, until it returns event=\"done\". " +
  "When it returns event=\"consult\", answer the questions briefly and factually with " +
  "answer_consult - if you do not know an answer, ask the user first rather than " +
  "inventing one. " +
  "Staying in that loop pays off: the final \"done\" answer carries the summary of the " +
  "call and whether the objective was achieved.";

// serverOptions traegt inzwischen ZWEI Dinge (UI-Capabilities + instructions). Byte-
// identisch zum Bestand, solange beide Schalter aus sind: undefined. Nur so bleibt das
// Verhalten bei ausgeschaltetem Flag unveraendert.
export function mcpServerOptions({ uiEnabled, consultLoop }) {
  const options = {};
  if (uiEnabled) options.capabilities = { extensions: uiServerExtension() };
  if (consultLoop) options.instructions = MCP_CONSULT_INSTRUCTIONS;
  return Object.keys(options).length ? options : undefined;
}
