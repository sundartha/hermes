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
// DRAHT TOT, fuer Claude wie fuer OpenAI (P8, tasks/openai-p8-spec.md §0.3 M-1): der
// Detektor unten greift nur auf dem initialize-POST, dessen Response weder Tool-
// Deskriptoren noch Resource-Inhalte traegt; der stateless Transport (sessionIdGenerator
// =undefined) fuehrt die dort deklarierten Capabilities nicht zum spaeteren tools/list-
// oder resources/read-POST mit. OpenAIs eigene, aktuell gelesene Doku
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
// resourceUri) - GENAU DORT liest OpenAI CSP/Domain NICHT (gemessen, P8, §0.3 M-2:
// developers.openai.com/apps-sdk/reference fuehrt "openai/widgetCSP"/"openai/widgetDomain"
// unter "Resource contents", nicht "Tool descriptor"). Fuer OpenAI wirksam sind die
// Alias-Schluessel am RESOURCE-INHALT (openAiResourceMeta weiter unten, ueber
// buildResourceMeta in makeUiRenderer). Diese Tool-Deskriptor-Haelfte bleibt trotzdem
// stehen: sie ist der MCP-Apps-Standardort fuer Claude/Copilot/Goose, und jede Aenderung
// hier veraendert Claudes tools/list ohne Not (Regel 1, P8-Spec §5.1).
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

// P8 (T-30/T-31, mcp-nativer Pfad): OpenAI liest CSP/Domain NICHT am Tool-Deskriptor
// (uiSubmissionMeta oben), sondern ausschliesslich am Resource-Inhalt von
// resources/read - dort steht heute kein _meta (gemessen, tasks/openai-p8-spec.md
// §0.3 M-2). developers.openai.com/apps-sdk/reference nennt "openai/widgetCSP" und
// "openai/widgetDomain" ausdruecklich als Aliase, die ChatGPT honoriert; Standard-
// Schluessel (_meta.ui.csp/.domain) werden hier BEWUSST NICHT gesetzt, weil auch
// Claude den Resource-Inhalt liest und "domain" laut MCP-Apps-Spezifikation
// host-abhaengig ist (Claude: <hash>.claudemcpcontent.com) - ob Claude einen fremden
// Origin dort ignoriert oder ablehnt, ist ohne Live-Probe UNKNOWN (O-P8-2).
export const OPENAI_WIDGET_CSP_KEY = "openai/widgetCSP";
export const OPENAI_WIDGET_DOMAIN_KEY = "openai/widgetDomain";

// Aus UI_CSP ABGELEITET (eine Quelle, Regel 5: nie weiter als die mcp-native CSP) -
// nur die Feldnamen wechseln auf snake_case (OpenAIs Legacy-Format). Zur Aufrufzeit
// gelesen wie uiSubmissionMeta (config.server.publicUrl kann pro Prozess/Test
// variieren); openai/widgetDomain entfaellt bei leerer publicUrl, gleiche Regel.
export function openAiResourceMeta() {
  const domain = config.server.publicUrl;
  const meta = {
    [OPENAI_WIDGET_CSP_KEY]: {
      connect_domains: [...UI_CSP.connectDomains],
      resource_domains: [...UI_CSP.resourceDomains],
    },
  };
  if (domain) meta[OPENAI_WIDGET_DOMAIN_KEY] = domain;
  return meta;
}

// Baut einen UiRenderer (DIP-Port, ports.js) fuer eine Host-Konvention. Host-unabhaengig:
// hasWidget/resourceUri/registerResource; host-spezifisch NUR mimeType + die _meta-Form
// (metaKey/buildMeta). 1 Argument (Objekt) statt drei Einzelparameter (F1). Wird zur
// Modul-Ladezeit einmal pro Adapter aufgerufen -> stabiler Singleton, keine Lazy-Init (P15).
// buildResourceMeta (P8, optional): liefert zusaetzliches _meta fuer den RESOURCE-Inhalt
// (nicht den Tool-Deskriptor). Ohne dieses Feld bleibt der Inhalt exakt
// { uri, mimeType, text } wie vor P8 - der ChatGPT-Adapter uebergibt es nicht und ist
// dadurch unveraendert (T-P3-AC5/AC7, Test P8-H).
export function makeUiRenderer({ mimeType, metaKey, buildMeta, buildResourceMeta }) {
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
        async () => {
          const content = { uri, mimeType, text: widgetHtml(widgetId, language) };
          if (buildResourceMeta) content._meta = buildResourceMeta();
          return { contents: [content] };
        },
      );
    },
    toolMeta: (widgetId) => ({ [metaKey]: buildMeta(uiResourceUri(widgetId)) }),
  };
}
