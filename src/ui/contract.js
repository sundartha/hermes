// SEP-1865 "MCP Apps"-Vertrag, schlank nachgebildet (Owner-Entscheidung 2026-06-26:
// kein @modelcontextprotocol/ext-apps-Dep). EINZIGE Stelle, die die Protokoll-Strings
// kennt - der Rest des Seams referenziert nur diese Konstanten (G5/G17/G35). Enthaelt
// zusaetzlich die geteilten Fabriken makeCapabilityDetector + makeUiRenderer, die genau
// diese Konstanten je Host-Konvention zu Detektoren/Renderern binden (EINE Quelle je
// Cluster statt Copy-Paste pro Host, G5); Widget-HTML/-Titel host-agnostisch aus dem Katalog.
import { hasWidget, widgetHtml, widgetTitle } from "./widget-catalog.js";
import { config } from "../config.js";

// mimeType der UI-Resource: exakt dieser String, sonst rendert kein Host (P0-Befund).
export const UI_MIME = "text/html;profile=mcp-app";
// Client-Capability-Schluessel im initialize-Handshake (capabilities.extensions[...]).
export const UI_CAPABILITY_KEY = "io.modelcontextprotocol/ui";
// _meta-Schluessel am Tool-Deskriptor, der auf die ui://-Resource zeigt.
// In EINER Konstante, falls der reale Namespace spaeter angepasst werden muss (P3).
export const UI_META_KEY = "ui"; // -> _meta.ui.resourceUri

// ui://-URI-Schema fuer Hermes-Widgets. EIN Tenant-freier, statischer URI je Widget
// (die Resource traegt KEINE Daten; Daten fliessen ueber structuredContent, P0-Befund).
const UI_URI_PREFIX = "ui://hermes/";
export const uiResourceUri = (widgetId) => `${UI_URI_PREFIX}${widgetId}`;

// Baut einen fail-closed Capability-Detektor fuer genau einen mimeType: true NUR wenn der
// Client die UI-Capability (UI_CAPABILITY_KEY) mit diesem mimeType deklariert; unbekannte/
// fehlende Struktur -> false (nie werfen, nie fail-open). EINE Quelle fuer beide Host-
// Konventionen - nur die mimeType-Konstante variiert (G5). Bei abweichendem P0-Beleg
// aendert sich AUSSCHLIESSLICH die uebergebene Konstante, nicht diese Logik.
function makeCapabilityDetector(mimeType) {
  return (clientCapabilities) => {
    const mimeTypes = clientCapabilities?.extensions?.[UI_CAPABILITY_KEY]?.mimeTypes;
    return Array.isArray(mimeTypes) && mimeTypes.includes(mimeType);
  };
}

// fail-closed: true NUR wenn der Client die UI-Capability mit UI_MIME deklariert.
export const capabilityDeclaresUi = makeCapabilityDetector(UI_MIME);

// Server-Seite (MCP Apps / SEP-1865): der Server MUSS die Extension im initialize-
// Response deklarieren, sonst rendert der Host (Claude/Copilot/...) das ui://-Widget
// nicht - auch wenn das Tool-_meta korrekt ist. Inhalt fuer capabilities.extensions,
// spiegelt UI_CAPABILITY_KEY + UI_MIME (EINE Quelle, symmetrisch zu capabilityDeclaresUi).
export function uiServerExtension() {
  return { [UI_CAPABILITY_KEY]: { mimeTypes: [UI_MIME] } };
}

// ChatGPT Apps SDK (OpenAI "skybridge"). Zweiter Host-Adapter neben MCP-nativ - AUF DEM
// DRAHT PRAKTISCH TOT, fuer Claude wie fuer OpenAI (P8, tasks/openai-p8-spec.md §0.3
// M-1): der Detektor unten greift auf JEDEM Request, dessen params.capabilities die
// Skybridge-Capability traegt - auch auf tools/list/resources/read selbst, wenn sie
// dort steht. Nur bringt das nichts, weil der stateless Transport (sessionIdGenerator
// =undefined) die im initialize-POST deklarierten Capabilities nicht zum spaeteren
// tools/list- oder resources/read-POST mitfuehrt und kein standardkonformer Client sie
// ausserhalb des initialize sendet. OpenAIs eigene, aktuell gelesene Doku
// (developers.openai.com/apps-sdk/*) nennt "text/html+skybridge" nicht mehr und
// beschreibt statt dessen den MCP-Apps-Standard (mimeType unten bei UI_MIME). Test P8-A
// pinnt "Skybridge-initialize -> mcp-nativer Pfad auf tools/list". Rueckbau ist trotzdem
// KEIN Teil von P8 (Owner-Auftrag noetig, s. registry.js, O-P8-1).
// mimeType der UI-Resource in dieser (toten) Host-Konvention (disjunkt zu UI_MIME).
export const CHATGPT_UI_MIME = "text/html+skybridge";
// _meta-Schluessel am Tool-Deskriptor; Wert = die ui://-Resource-URI (flacher String,
// NICHT das verschachtelte _meta.ui.resourceUri der MCP-nativen Konvention).
export const CHATGPT_META_KEY = "openai/outputTemplate";

// fail-closed: true NUR wenn der Host die UI-Capability mit CHATGPT_UI_MIME deklariert.
// Symmetrisch zu capabilityDeclaresUi; disjunkter mimeType -> eindeutige Adapter-Wahl.
export const capabilityDeclaresChatgptUi = makeCapabilityDetector(CHATGPT_UI_MIME);

// ---- Einreichungs-Pflichtfelder, TOOL-DESKRIPTOR-Haelfte (T-30/T-31) --------------
// Diese Felder (uiSubmissionMeta unten) liegen am Tool-Deskriptor (_meta.ui neben
// resourceUri). RICHTIGGESTELLT (Pruefer-Befund Runde 1, 2026-09-21 - der vorherige
// Kommentar behauptete faelschlich, dies sei "der MCP-Apps-Standardort fuer
// Claude/Copilot/Goose"): es gibt dort ueberhaupt KEINEN Standardort fuer csp/domain,
// fuer KEINEN MCP-Apps-Host. Die Spezifikation selbst verbietet das Feld an dieser
// Stelle (@modelcontextprotocol/ext-apps 2.0.0, dist/src/spec.types.d.ts,
// McpUiToolMeta.csp/.permissions sind als `never` getypt): "csp belongs on the UI
// resource (see McpUiResourceMeta), not the tool. Hosts read it from the resources/read
// content item (with resources/list entry as fallback) and ignore it here." Das ist eine
// Aussage ueber ALLE MCP-Apps-Hosts, nicht nur OpenAI.
//
// T-30/T-31 SIND AM RESOURCE-INHALT (resources/read) WEITERHIN NICHT ERFUELLT
// (Pruefer-Befund Runde 2, 2026-09-21 - ein vorheriger Anlauf setzte dort die von OpenAI
// selbst als "Legacy" bezeichneten Alias-Schluessel openai/widgetCSP/openai/widgetDomain,
// zurueckgenommen). Gruende, warum das KEIN Ruecksetzer auf einen frueheren Stand ist,
// sondern die richtige Antwort auf zwei eigene Befunde:
// 1. T-30 (00-openai-anforderungen.md:63) und T-31 (:64) verlangen woertlich den
//    STANDARD-Schluessel `_meta.ui.csp`/`_meta.ui.domain`. X-7 (:138) begruendet den
//    Legacy-Alias `openai/widgetCSP`/`openai/widgetDomain` AUSSCHLIESSLICH mit
//    `redirect_domains` fuer `openExternal` - das Widget-HTML hat keine `openExternal`-
//    Ziele (0 externe URLs, s. UI_CSP-Kommentar oben). Der Legacy-Alias erfuellt T-30/T-31
//    damit nicht einmal dann, wenn er ankommt - er ist die falsche Antwort auf die
//    falsche Frage.
// 2. Der EINZIGE Ort, an dem irgendein zusaetzliches Resource-_meta heute ankommt, ist
//    `mcpNativeRenderer` - der ChatGPT-Adapter ist auf dem Draht tot (M-1,
//    `tasks/openai-p8-spec.md` §0.3), und `mcpNativeRenderer` bedient deshalb JEDEN
//    Client, auch den heutigen Claude-Connector (Regel 1 der Phase). Weder fuer den
//    Legacy-Alias noch fuer den Standard-Schluessel gibt es einen Live-Beleg, dass ein
//    MCP-Apps-Host (Claude eingeschlossen) ein zusaetzliches Resource-_meta unveraendert
//    schluckt - nur ein Schema-Beleg (SDK-`_meta` ist ein offenes Record, s.u.), keiner
//    verhaltensseitig (O-P8-2). Den nicht-erfuellenden Legacy-Alias trotzdem auszuliefern,
//    haette das Live-Risiko fuer Claude getragen, ohne die Anforderung zu erfuellen -
//    schlechter als beide Alternativen (nichts senden, oder den Standard-Schluessel mit
//    demselben Risiko UND erfuellter Anforderung senden).
// Der Ort fuer T-30/T-31 bleibt `resources/read` (`_meta.ui.csp`/`_meta.ui.domain`, kein
// Legacy-Alias) - offen bis zu einer Live-Probe (O-P8-2, Claude-Host; O-P8-3/OW-4,
// echter OpenAI-Developer-Mode-Connector, s. `tasks/openai-p0-entscheidungen.md` Gate-
// Tabelle "P8, ChatGPT-Adapter-Teil ... ungestartet"). Diese Tool-Deskriptor-Haelfte
// (uiSubmissionMeta) bleibt stehen: ohne Wirkung fuer jeden MCP-Apps-Host, nur aus
// Byte-Stabilitaetsgruenden - ihr Entfernen wuerde Claudes tools/list ohne Not
// veraendern (Regel 1, P8-Spec §5.1).
// T-30: die CSP muss EXAKT die Domains nennen, von denen die Komponente laedt. Gemessen
// ueber alle 5 Widget-Quellen und alle injizierten Bausteine (12 Dateien): sie laden von
// NIRGENDWO - 0 Treffer fuer fetch/XHR/WebSocket/EventSource/sendBeacon/importScripts,
// kein @font-face, keine absolute URL (die einzige, der w3.org-SVG-Namespace, steht
// INNERHALB eines data:-URI), Bilder nur als data:-URI, kein iframe/embed/object.
// Beide Listen sind deshalb LEER - jede weitere Angabe waere eine Falschangabe.
// frameDomains entfaellt (laut T-30 optional, 0 Frames). Der einzige Aussenkanal ist
// parent.postMessage - kein Netz-Ladevorgang, von einer CSP nicht adressiert.
export const UI_CSP = Object.freeze({
  connectDomains: Object.freeze([]),
  resourceDomains: Object.freeze([]),
});

// T-31: pro Plugin eindeutiger Origin. Owner-Entscheidung: der Server-Origin aus
// config.server.publicUrl - KEIN eigenes Env, damit es keine zweite Wahrheit ueber den
// eigenen Origin gibt (derselbe Wert speist Token-Audience, PRM und die /mcp-
// Herkunftswache; ein leerer oder divergenter Wert verweigert in Produktion ohnehin den
// Boot). Fehlt er lokal, ENTFAELLT das Feld, statt einen falschen Origin zu behaupten.
// Liest zur AUFRUFZEIT, nicht zur Modul-Ladezeit: die config-Blaetter sind Getter auf
// einen gemeinsamen Speicher-Slot, und die In-Process-Tests setzen den Wert nach dem
// Import. Kein Cache - ein gecachter Wert waere ein Lazy-Init-Antipattern (P15).
export function uiSubmissionMeta() {
  const domain = config.server.publicUrl;
  return domain ? { csp: UI_CSP, domain } : { csp: UI_CSP };
}

// Baut einen UiRenderer (DIP-Port, ports.js) fuer eine Host-Konvention. Host-unabhaengig:
// hasWidget/resourceUri/registerResource; host-spezifisch NUR mimeType + die _meta-Form
// (metaKey/buildMeta). 1 Argument (Objekt) statt drei Einzelparameter (F1). Wird zur
// Modul-Ladezeit einmal pro Adapter aufgerufen -> stabiler Singleton, keine Lazy-Init (P15).
// Der Resource-Inhalt (registerResource) traegt bewusst KEIN _meta (P8, Pruefer-Befund
// Runde 2 - ein Zwischenstand mit optionalem buildResourceMeta-Parameter ist
// zurueckgenommen, s. Kommentar bei UI_CSP/uiSubmissionMeta oben): { uri, mimeType, text }
// bleibt fuer BEIDE Adapter exakt der Stand vor P8.
export function makeUiRenderer({ mimeType, metaKey, buildMeta }) {
  return {
    mimeType,
    hasWidget: (widgetId) => hasWidget(widgetId),
    resourceUri: (widgetId) => uiResourceUri(widgetId),
    // language (P13/E4): die Agentensprache, in der die statische Resource gerendert
    // wird. Die ui://-URI bleibt bewusst sprachfrei (ein live etablierter Wire-
    // Bezeichner); pro Request steht ohnehin genau eine Sprache fest (stateless, INV-8).
    registerResource(server, widgetId, language) {
      const uri = uiResourceUri(widgetId);
      server.registerResource(
        widgetId,
        uri,
        { title: widgetTitle(widgetId), mimeType },
        async () => ({ contents: [{ uri, mimeType, text: widgetHtml(widgetId, language) }] }),
      );
    },
    toolMeta: (widgetId) => ({ [metaKey]: buildMeta(uiResourceUri(widgetId)) }),
  };
}
