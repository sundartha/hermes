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
// resourceUri). RICHTIGGESTELLT (Pruefer-Befund Runde 1, 2026-09-21 - der vorherige
// Kommentar behauptete faelschlich, dies sei "der MCP-Apps-Standardort fuer
// Claude/Copilot/Goose"): es gibt dort ueberhaupt KEINEN Standardort fuer csp/domain,
// fuer KEINEN MCP-Apps-Host. Die Spezifikation selbst verbietet das Feld an dieser
// Stelle (@modelcontextprotocol/ext-apps 2.0.0, dist/src/spec.types.d.ts,
// McpUiToolMeta.csp/.permissions sind als `never` getypt): "csp belongs on the UI
// resource (see McpUiResourceMeta), not the tool. Hosts read it from the resources/read
// content item (with resources/list entry as fallback) and ignore it here." Das ist eine
// Aussage ueber ALLE MCP-Apps-Hosts, nicht nur OpenAI. Wirksam sind ausschliesslich die
// Alias-Schluessel am RESOURCE-INHALT (openAiResourceMeta weiter unten, ueber
// buildResourceMeta in makeUiRenderer) - und die decken bisher nur den OpenAI-Legacy-Pfad
// ab, s. Kommentar dort. Fuer Claude/Copilot/Goose fehlt eine wirksame CSP/Domain am
// Resource-Inhalt WEITERHIN (O-P8-2 unten ist NICHT erledigt). Diese Tool-Deskriptor-
// Haelfte bleibt trotzdem stehen: ohne Wirkung fuer jeden MCP-Apps-Host, nur aus
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

// P8 (T-30/T-31, mcp-nativer Pfad): CSP/Domain wirken fuer KEINEN MCP-Apps-Host am
// Tool-Deskriptor (uiSubmissionMeta oben, s. Korrektur beim UI_META_KEY-Kommentar oben) -
// wirksam ist ausschliesslich der Resource-Inhalt von resources/read. Dass der Inhalt VOR
// dieser Phase kein _meta trug, ist GEMESSEN (tasks/openai-p8-spec.md §0.3 M-2, unser
// eigener master-Capture, sha256 8c22f000...17daf2b) - das misst nur, was UNSER Server
// ausgibt, nicht, was OpenAI liest. Dass OpenAI/ChatGPT am Resource-Inhalt
// "openai/widgetCSP"/"openai/widgetDomain" als Alias-Schluessel honoriert, ist GELESEN,
// nicht gemessen: developers.openai.com/apps-sdk/reference (gelesen 2026-09-21) fuehrt
// beide unter "Resource contents" und sagt woertlich:
//   - "_meta['openai/widgetCSP'] | Legacy ChatGPT compatibility key for widget CSP
//     metadata. Standard CSP fields are superseded by _meta.ui.csp, but
//     redirect_domains is still required for trusted openExternal destinations."
//   - "The standard _meta.ui.csp object is generally preferred for new UI ..."
//   - "_meta['openai/widgetDomain'] | OpenAI-specific compatibility alias for
//     _meta.ui.domain in ChatGPT."
// Diese Phase setzt also wissentlich NUR den von OpenAI selbst als Legacy bezeichneten
// Alias-Pfad, NICHT den von OpenAI selbst als "generally preferred" bezeichneten
// Standard-Pfad (_meta.ui.csp/.domain). Grund: Standard-Schluessel am Resource-Inhalt
// erreichen ueber denselben Renderer/denselben Inhalt auch Claude (registry.js: der
// ChatGPT-Adapter ist auf dem Draht tot, mcpNativeRenderer bedient ALLE Clients), und
// "domain" ist dort laut MCP-Apps-Spezifikation host-abhaengig (Claude:
// <hash>.claudemcpcontent.com) - ob Claude einen fremden Origin dort ignoriert oder
// ablehnt, ist ohne Live-Probe UNKNOWN (O-P8-2, NICHT erledigt).
//
// Rule-1-Beleg fuer den Alias-Pfad, der JETZT unconditional an jeden mcp-nativen Client
// geht (auch heutige Claude-Nutzer, s.o.): dass ein zusaetzliches _meta-Feld am
// Resource-Inhalt nicht schon auf Schema-/Protokollebene verworfen wird, ist am
// tatsaechlichen SDK-Vertrag nachpruefbar, nicht nur behauptet -
// node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts,
// ResourceContentsSchema/TextResourceContentsSchema: `_meta: z.ZodOptional<z.ZodRecord
// <z.ZodString, z.ZodUnknown>>` - ein offenes Schluessel-Wert-Objekt, keine geschlossene
// Feldliste, die zusaetzliche Schluessel abweisen wuerde. Das deckt NUR "wird nicht als
// Schema-Fehler verworfen" - NICHT "der Claude-Host rendert das Widget trotzdem
// unveraendert weiter". Fuer Letzteres bleibt die Live-Probe gegen einen echten
// Claude-Host offen (O-P8-2). Diese Zeile ist damit ein staerker belegter, aber
// weiterhin AUSDRUECKLICH OFFENER Punkt - keine Erledigung.
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
