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

// Ausgeschlossene Anrufzwecke: EINE Tabelle, aus der die volle Zweckregel UND ihre
// Kurzfassung in der place_call-Beschreibung gebaut werden. Jeder Eintrag MUSS `short`
// ausdruecklich setzen: den Wortlaut in der Kurzfassung oder null, wenn er dort fehlt (der
// Zeichen-Deckel der place_call-Texte, test/gq-b1-briefing-openness.test.js, ist knapp).
// Eine neue Kategorie kann deshalb nicht still an der Kurzfassung vorbeilaufen; welche
// Eintraege dort fehlen, pinnt test/openai-t2-16-place-call-texte.test.js, und
// docs/OPENAI-POLICY-ABGLEICH.md nennt dieselben Luecken.
export const CALL_PURPOSE_EXCLUSIONS = Object.freeze([
  Object.freeze({ full: "telemarketing", short: "telemarketing" }),
  Object.freeze({ full: "unsolicited advertising or sales calls", short: "unsolicited advertising" }),
  Object.freeze({ full: "political campaigning", short: "political campaign calls" }),
  Object.freeze({ full: "mass or automated dialling of many numbers", short: null }),
]);

// Aufzaehlung "a, b or c" (Kurzfassung) bzw. "a, b, or c" (volle Regel) - der Trenner vor
// dem letzten Glied ist der einzige Unterschied, byte-identisch zum bisherigen Wortlaut. Ein
// einzelnes Glied steht allein (kein fuehrendes "or"), eine leere Liste ergibt "".
const LIST_SEPARATOR = ", ";
const LAST_OR_FULL = ", or ";
const LAST_OR_SHORT = " or ";
export function listWithOr(items, lastSeparator) {
  if (items.length <= 1) return items.join("");
  if (lastSeparator === undefined) return items.join(LIST_SEPARATOR);
  return items.slice(0, -1).join(LIST_SEPARATOR) + lastSeparator + items.at(-1);
}

// Zweckbindung: EINE Quelle fuer die Server-Instructions (unten) UND die Beschreibung von
// prepare_call (src/mcp-tools.js importiert sie) - wortgleich, keine zweite Formulierung.
// Eine NUTZUNGSREGEL an das Modell, keine Pruefung: der Server prueft den Zweck eines Anrufs
// nicht, der Satz traegt deshalb kein Durchsetzungs-Verb. Bewusst ENG, damit das Modell
// legitime Anrufe nicht verweigert: erst die Positivliste (Termin, Verschiebung, Anfrage,
// Reklamation), Auftrag auch fuer jemanden, fuer den der Nutzer handelt (Angehoerige);
// ausgeschlossen nur Unaufgefordertes und MASSEN-/automatische Anwahl - mehrere gezielte
// Anrufe (drei Friseure abtelefonieren) bleiben erlaubt.
export const CALL_PURPOSE_RULE =
  "Place calls only when the user asks for them, for themselves or someone they act for, " +
  "such as booking, rescheduling, enquiring or complaining - not for " +
  listWithOr(
    CALL_PURPOSE_EXCLUSIONS.map((entry) => entry.full),
    LAST_OR_FULL,
  ) +
  ".";

// Kurzfassung fuer die place_call-Beschreibung (src/mcp-tools.js), aus derselben Tabelle:
// nur die Eintraege mit `short`. Ebenfalls eine Nutzungsregel ohne Durchsetzungs-Verb.
export const CALL_PURPOSE_SHORT_RULE = `Not for ${listWithOr(
  CALL_PURPOSE_EXCLUSIONS.filter((entry) => entry.short !== null).map((entry) => entry.short),
  LAST_OR_SHORT,
)}.`;

// T2-17 (T-21): Kern-Vorspann. OpenAI ("Keep the most important details in the first
// 512 characters") sagt nicht, was "wichtig" heisst - hier: die Bestaetigungs-Sequenz
// (die Karte waehlt, nie selbst mit einem Code), die Zweckbindung (Kurzform aus
// derselben Tabelle wie CALL_PURPOSE_SHORT_RULE oben) und der Geld-Riegel (nicht
// erneut waehlen bei "not-placed"); im Consult-Fall zusaetzlich die sofortige
// Quittung. Die vollen Bestandssaetze bleiben byte-identisch HINTER dem Kern
// (BASE_DETAILS unten) - Doku-Zitate und Bestandspins auf ihren Wortlaut bleiben
// gueltig, nur die Reihenfolge im Gesamttext aendert sich.
//
// Die Sequenz nennt das Schema-Feld `confirmation_code` NUR als Verbot: place_call
// verlangt es laut eigener Beschreibung ("REQUIRES a confirmation_code"), und ohne den
// exakten Feldnamen im Verbot liegt es nahe, den Nutzer nach dem Code zu fragen. Der
// Code steht nur im _meta der Karte; das Modell kennt ihn nie, fragt nie danach und
// ruft place_call nie selbst auf. Bewusst NICHT uebernommen aus der fruehen Planfassung:
// "place_call mit dem Code aus der Nachricht des Nutzers" (seit der Karten-Bestaetigung
// ruft die Karte place_call selbst - die Positivform waere eine Anleitung zur
// Selbstbestaetigung) und await_call_event im Basis-Kern (dort nicht registriert, s.
// CORE_CONSULT_LOOP). Der Consult-Kern liegt knapp unter 512 Zeichen - der Draht-Test
// test/openai-t2-17-instructions-kern.test.js schlaegt an, sobald er darueber waechst.
const CORE_SEQUENCE =
  "Call prepare_call before every phone call; only the Hermes card places it, after " +
  "the user confirms - never call place_call yourself, never ask the user for or " +
  "invent a confirmation_code.";
// NUR im Consult-Kern: ohne Consult-Freigabe ist await_call_event nicht registriert,
// dieselbe Regel wie beim Bestandstext (Pins P4 Fall 4/5, Kommentar unten).
const CORE_CONSULT_LOOP =
  'While a call runs, call await_call_event until event="done"; answer a consult at ' +
  'once: answer_consult status="working".';
// Aus der Tabelle CALL_PURPOSE_EXCLUSIONS gebaut (eine Quelle, wie CALL_PURPOSE_RULE/
// CALL_PURPOSE_SHORT_RULE oben): eine neue Kategorie verlaengert automatisch auch den
// Kern und laesst den 512-Zeichen-Test anschlagen, statt still dahinter zu rutschen.
const CORE_PURPOSE = `Only place calls the user asks for, never ${listWithOr(
  CALL_PURPOSE_EXCLUSIONS.map((entry) => entry.full),
  LAST_OR_FULL,
)}.`;
// G22: dasselbe NOT_PLACED-Token wie der Geld-Satz in BASE_DETAILS unten - eine
// Umbenennung des Tokens verschiebt beide Stellen gemeinsam.
const CORE_MONEY = `Never retry a "${NOT_PLACED}" call.`;

// Baut den Kern je Modus: im Consult-Fall steht CORE_CONSULT_LOOP zwischen Sequenz und
// Zweckbindung, im Basis-Fall entfaellt er (await_call_event ist dort nicht registriert).
function instructionsCore(consultLoop) {
  const sentences = consultLoop
    ? [CORE_SEQUENCE, CORE_CONSULT_LOOP, CORE_PURPOSE, CORE_MONEY]
    : [CORE_SEQUENCE, CORE_PURPOSE, CORE_MONEY];
  return sentences.join(" ");
}

// AL-P13/T-21: Server-Instruktionen fuer den MCP-Host. ACHTUNG: `instructions` ist ein
// Feld von ServerOptions, NICHT von Implementation - in HERMES_SERVER_INFO gesetzt
// wuerde es still verworfen. Deshalb liegt hier NUR der Text plus der Options-Bauer;
// eingesetzt wird er in routes/mcp.js UND (T-21/DP-1) in mcp-server.js (stdio).
// EINSPRACHIG ENGLISCH (O14): nur das Client-Modell liest ihn, nie der Tenant.
//
// T-21: instructions gelten jetzt IMMER, auch ohne Consult-Freigabe - deshalb zwei
// Bausteine statt eines Textes. BASE_DETAILS (der bisherige Wortlaut, unten) nennt nur
// Werkzeuge, die JEDER Tenant registriert bekommt (await_call_event/answer_consult tun
// das nicht - die bleiben daher ungenannt und stecken nur im Consult-Kern/-Block).
//
// OUTBOUND-E3a: ohne den ersten Satz sieht das Modell nur das Basis-Token "not-placed"
// (callOutcomeView kuerzt das Detail an der MCP-Kante weg), weiss nichts damit
// anzufangen und wiederholt den Anruf - jedes Mal mit echten Anbieterkosten. Ohne
// Consult-Werkzeug liefert get_call_status
// dasselbe Feld (CALL_STATUS_OUTPUT), deshalb "a call" statt "await_call_event".
//
// Review-Runde 2 (P4): ohne Namensnennung landete das Modell bei get_call_result's eigener
// Beschreibung ("call this only once status=completed") und rief das Werkzeug fuer einen
// NICHT platzierten Anruf (status=failed, kein Consult noetig) gar nicht erst auf -
// result_summary blieb unerreichbar, obwohl get_call_result es fuer genau diesen Fall
// liefert (pickTranscript/callFailedSummary). get_call_result IST fuer jeden Tenant
// registriert (kein Consult-Gate) - die Nennung hier ist deshalb sicher, anders als bei
// await_call_event/answer_consult oben.
// T2-11 (N-12): der fruehere Toolname (versprach ein Transkript, das nie geliefert wurde)
// ist auf get_call_result umbenannt, Wortlaut sonst unveraendert.
// T2-17: modul-intern statt exportiert - der Kern (oben) steht jetzt VOR diesem Text,
// beide Tests und Doku lesen nur noch die zusammengesetzten Exporte unten.
const BASE_DETAILS =
  `If a call reports a failure_reason starting with "${NOT_PLACED}", the call could not ` +
  "be placed because of a problem on our side. Do NOT retry the call: call get_call_result " +
  "for that call_id - it works for a failed call, not only a completed one - and tell the " +
  "user what failed, using its result_summary text as it is. " +
  "Never invent facts about the principal or the call: if you do not know something, say so. " +
  // T2-13 (N-10): die Bestaetigungs-Sequenz vor jedem place_call - ein Satz, damit das
  // Modell nicht rein aus der Tool-Beschreibung raet, wann prepare_call an der Reihe ist.
  // KORRIGIERT (Safety-Review T2-13): "reveals a confirmation_code" liess offen, ob das
  // Modell den Code selbst aus der Karte nimmt - die Karte SENDET ihn nach der Bestaetigung.
  // KORRIGIERT (T2-14-Nachbesserung, Safety-Review): "then pass it to place_call" wies das
  // Modell direkt an, place_call SELBST mit dem Code aufzurufen - das kann es nicht, der
  // Code erreicht es nie. Tatsaechlich ruft die Karte place_call fuer den bestaetigten
  // Anruf selbst auf (ueber die Host-Tool-Bruecke) und meldet die call_id per Chat-Nachricht
  // zurueck; das Modell wartet auf diese Nachricht, statt place_call selbst aufzurufen.
  "Before every place_call, call prepare_call first with the exact same arguments and let " +
  "the user confirm in the Hermes card; if they confirm, the card places the call itself " +
  "and reports the call_id back in a chat message - do not call place_call for that call " +
  "yourself, and never guess or invent a confirmation code. The confirmation covers every " +
  "argument, briefing and context included: after changing any of them, call " +
  "prepare_call again and let the user confirm again. If this host does not show " +
  "the Hermes card, or card confirmation is switched off for this server, no call can be " +
  "placed from here - tell the user so honestly. " +
  // Volle Zweckregel: die Kurzform (CORE_PURPOSE) steht bereits im Kern vor diesem Text
  // (OpenAI: "Keep the most important details in the first 512 characters"); die volle
  // Fassung mit Positivliste folgt hier unveraendert. Steht in BASE_DETAILS, damit sie
  // ueber MCP_CONSULT_INSTRUCTIONS auch im Consult-Fall gilt.
  CALL_PURPOSE_RULE;

// Consult-Block bleibt modul-intern (kein dritter Export, keine dritte Wahrheit) - er
// gilt NUR, wenn der Tenant await_call_event/answer_consult registriert bekommt.
const CONSULT_BLOCK =
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
  // liegt in den EIGENEN Quellen des auftraggebenden Assistenten, nicht im Durchreichen
  // an den Menschen - deshalb steht der eigene Weg zuerst und die Nutzer-Rueckfrage nur
  // noch unter der Bedingung echter Anwesenheit. O-27: die Aufzaehlung der Quellen
  // (calendar, mail, files, chat) entfaellt - sie nennt fremde Werkzeugklassen, die der
  // Host nicht kennen muss; die WIRKUNG (eigene Quellen zuerst) bleibt.
  "answer_consult - answer from your own tools and context first; only ask the user when " +
  "they are actually present right now, and never invent an answer. " +
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
  "waiting, so the agent can tell the other party that the principal will get back on it.";

// T2-17: die zwei ausgelieferten Texte. Name/Bedeutung bleiben (T-21 W-7): die
// Konstanten heissen nach dem FALL, in dem sie ausgeliefert werden, nicht nach ihrem
// letzten Absatz - sonst brechen die Pruefkommandos aus dem Plan und die Bestandspins
// auf diesen Konstanten (test/mcp-fehlergrund-rueckweg.test.js,
// test/gq-b1-briefing-openness.test.js). Komposition statt Ersatz: der Geld-Satz und
// der Nicht-Erfinden-Satz (in BASE_DETAILS) gelten AUCH im Consult-Fall. Anders als vor
// T2-17 beginnt MCP_CONSULT_INSTRUCTIONS NICHT mehr mit MCP_BASE_INSTRUCTIONS - jeder
// Modus bekommt seinen eigenen Kern (instructionsCore), BASE_DETAILS ist die geteilte
// Fortsetzung dahinter.
export const MCP_BASE_INSTRUCTIONS = `${instructionsCore(false)} ${BASE_DETAILS}`;
export const MCP_CONSULT_INSTRUCTIONS = `${instructionsCore(true)} ${BASE_DETAILS} ${CONSULT_BLOCK}`;

// serverOptions traegt inzwischen ZWEI Dinge (UI-Capabilities + instructions).
// T-21: instructions sind IMMER gesetzt - der Basis-Block gilt auch fuer einen Tenant
// ohne Consult-Freigabe. Der Rueckgabewert ist deshalb nie mehr undefined.
export function mcpServerOptions({ uiEnabled, consultLoop }) {
  const options = {};
  if (uiEnabled) options.capabilities = { extensions: uiServerExtension() };
  options.instructions = consultLoop ? MCP_CONSULT_INSTRUCTIONS : MCP_BASE_INSTRUCTIONS;
  return options;
}
