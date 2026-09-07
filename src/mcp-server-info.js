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
// Die https-Variante bleibt als icons[1] fuer Hosts, die adressierbare/grosse Icons
// bevorzugen; ein MCP-Host laedt sie OHNE Dashboard-Credentials - sie liegt unter
// public/ und wird von express.static ohne jede Vorschaltung ausgeliefert (AUTH-P7:
// die frueher dafuer noetige Basic-Auth-Ausnahme fuer BRAND_ASSETS_PREFIX ist mit dem
// Gate selbst entfallen).
import { config } from "./config.js";
import { HERMES_ICON_DATA_URI, HERMES_ICON_SIZE } from "./brand-icon-data.js";
import { uiServerExtension } from "./ui/contract.js";
// G22: dasselbe Basis-Token wie mail-not-placed.js - EINE Quelle statt zweimal
// getippt, sonst deaktiviert eine Umbenennung des Tokens den Wiederhol-Riegel still.
import { NOT_PLACED } from "./telephony/failure-reason.js";

// Pfad-Praefix fuer selbst gehostete Marken-Assets unter public/ (kein Magic-String,
// G25) - server.js braucht denselben Wert fuer icons[1].src oben.
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
  // in unsere damalige Basic-Auth (401, in der Search Console sichtbar) - Google hat
  // deshalb nie ein Favicon fuer diesen Origin. Die Ursache existiert seit AUTH-P7
  // nicht mehr (kein Gate, das 401 antwortet); der Search-Console-Handgriff (http-
  // Property + Recrawl) steht trotzdem weiterhin aus, das behebt sich nicht von selbst.
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
  "When it returns event=\"consult\", " +
  // P2 (SCOPE 2): das Ausbleiben der Quittung IST der Berechtigungstest - deshalb steht
  // die Pflicht an BEIDEN Orten, Werkzeugbeschreibung UND Instruktionsblock. Bewusst
  // OHNE Sekundenzahl (Muster GQ-B1): die Fristen liegen in der Konfiguration und
  // wuerden im Text veralten.
  "the instant a consult arrives, call answer_consult once with status=\"working\" and no " +
  "answers - if that acknowledgement does not arrive within seconds, the server assumes " +
  "nobody can answer and lets the agent move on. Then answer the questions briefly and " +
  "factually with " +
  // GQ-B2: Der Owner ist waehrend des Anrufs ABWESEND (Normalfall). Der Wert dieses Kanals
  // liegt in den EIGENEN Quellen des auftraggebenden Assistenten (Kalender, Mail, Dateien,
  // Chat-Kontext), nicht im Durchreichen an den Menschen - deshalb steht der eigene Weg
  // zuerst und die Nutzer-Rueckfrage nur noch unter der Bedingung echter Anwesenheit.
  "answer_consult - answer from your own tools and context first (calendar, mail, files, " +
  "this chat); only ask the user when they are actually present right now, and never " +
  "invent an answer. " +
  "Staying in that loop pays off: the final \"done\" answer carries the summary of the " +
  "call and whether the objective was achieved. " +
  // GQ-B1: Die Rueckfrage hat eine Wanduhr-Frist (CONSULT_OPEN_MS) - eine Antwort nach einer
  // gemuetlichen Chat-Runde kommt zu spaet. BEWUSST OHNE Sekundenzahl: der Wert liegt in der
  // Konfiguration und wuerde im Text veralten.
  // GQ-B2: Die Frist bleibt, ihr Ausgang wird explizit - Schweigen laesst den Agenten in den
  // Zeitablauf laufen, ein ausdrueckliches "weiss ich nicht" laesst ihn im Gespraech sauber
  // ausrichten, dass der Auftraggeber sich meldet.
  "The agent is on the phone while it waits, so answer within seconds - if you cannot " +
  "find the answer that fast, say with answer_consult that you do not know instead of " +
  "waiting, so the agent can tell the other party that the principal will get back on it. " +
  // OUTBOUND-E3a: ohne diesen Satz sieht das Modell ab E3a ein Token wie
  // "not-placed:invite-403-D51", weiss nichts damit anzufangen und wiederholt den Anruf -
  // jedes Mal mit echten Anbieterkosten.
  `If await_call_event returns a failure_reason starting with "${NOT_PLACED}", the call ` +
  "could not be placed because of a problem on our side. Do NOT retry the call: tell the " +
  "user what failed, using the result_summary text as it is.";

// serverOptions traegt inzwischen ZWEI Dinge (UI-Capabilities + instructions). Byte-
// identisch zum Bestand, solange beide Schalter aus sind: undefined. Nur so bleibt das
// Verhalten bei ausgeschaltetem Flag unveraendert.
export function mcpServerOptions({ uiEnabled, consultLoop }) {
  const options = {};
  if (uiEnabled) options.capabilities = { extensions: uiServerExtension() };
  if (consultLoop) options.instructions = MCP_CONSULT_INSTRUCTIONS;
  return Object.keys(options).length ? options : undefined;
}
