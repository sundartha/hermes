// Host-agnostischer Widget-Katalog: kennt die Hermes-Widgets (Id, Datei, Titel) und
// laedt ihre self-contained HTML EINMAL beim Modul-Load. KEIN Host-/Protokoll-Wissen
// hier (kein mimeType, kein _meta) - dasselbe Widget rendert in JEDEM Host (P3-Ziel).
// Beide Adapter (mcp-native, chatgpt) konsumieren diesen Katalog (G5/S2 - eine Quelle
// fuer die Lade-Logik, keine Duplizierung).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BIND_SCRIPT } from "./widget-bind.js";
import { WING_CSS_STATIC, WING_CSS_LIVE, WING_MARKUP_STATIC, WING_MARKUP_LIVE } from "./wing-markup.js";

// Bekannte Widgets. widgetId -> { file, title }. Neue Widgets sind reine Daten-
// Eintraege (OCP), ohne die Adapter-Logik zu aendern. title = Resource-Metadaten je
// Widget (statt eines hartkodierten Magic-Strings, G25).
export const WIDGET_AGENT_STATUS = "agent-status";
export const WIDGET_MY_NUMBER = "my-number";
export const WIDGET_CALLS = "calls";
export const WIDGET_CALENDAR = "calendar";
// W1 (MCP-UI-Live-Widget): vereintes Call-Widget fuer den gesamten Anruf-Lebenszyklus
// (dialing -> in_progress -> completed/failed/cancelled), seit W2 an place_call
// verdrahtet. Subsumiert die frueheren Einzel-Widgets (Status/Cancel/Transkript-
// Zusammenfassung), die in W3 entfernt wurden.
export const WIDGET_CALL = "call";

// Wing-Marke (Kette T2): "static" = nur idle (die 4 Read-only-Widgets, kein
// Anruf-Lebenszyklus), "live" = alle 5 WingMark-Zustaende (call.html, Status-
// wechsel per Klassenwechsel). Datenzuordnung statt Bool-Flag-Argument (G15) -
// neue Widgets waehlen ihre Auspraegung als reinen Daten-Eintrag (OCP).
const WING_STATIC = "static";
const WING_LIVE = "live";
const WING_ASSETS_BY_VARIANT = {
  [WING_STATIC]: { css: WING_CSS_STATIC, markup: WING_MARKUP_STATIC },
  [WING_LIVE]: { css: WING_CSS_LIVE, markup: WING_MARKUP_LIVE },
};

const WIDGET_DEFS = {
  [WIDGET_AGENT_STATUS]: { file: "agent-status.html", title: "Hermes Agent Status", wing: WING_STATIC },
  [WIDGET_MY_NUMBER]: { file: "my-number.html", title: "Hermes Agent Number", wing: WING_STATIC },
  [WIDGET_CALLS]: { file: "calls.html", title: "Hermes Call List", wing: WING_STATIC },
  [WIDGET_CALENDAR]: { file: "calendar.html", title: "Hermes Calendar", wing: WING_STATIC },
  [WIDGET_CALL]: { file: "call.html", title: "Hermes Call", wing: WING_LIVE },
};

// Schliessendes body-Tag - davor wird das gemeinsame Daten-Binding eingefuegt, damit
// die data-mcp-Slots beim Script-Lauf bereits geparst sind.
const BODY_CLOSE = "</body>";

// Fuegt das gemeinsame Binding-Script genau einmal vor </body> ein (Serve-Zeit, EINE
// Quelle statt Copy-Paste je .html - G5/S2; self-contained, kein externer Import).
// Fehlt </body> (Entwicklerfehler), wird defensiv angehaengt - das Widget bleibt
// self-contained und das Binding laeuft trotzdem.
function withBindScript(html) {
  const idx = html.lastIndexOf(BODY_CLOSE);
  if (idx === -1) return html + BIND_SCRIPT;
  return html.slice(0, idx) + BIND_SCRIPT + html.slice(idx);
}

// Platzhalter in den .html-Quellen (siehe widgets/*.html) - genau je einmal pro
// Widget, dort wo bisher die Wing-CSS/das Wing-Markup wortgleich eingebettet war.
const WING_CSS_PLACEHOLDER = "/*__WING_CSS__*/";
const WING_MARKUP_PLACEHOLDER = "<!--__WING_MARKUP__-->";

// Fuegt die Wing-Marke (CSS + Markup, EINE Quelle in wing-markup.js) an ihren
// Platzhaltern ein - dasselbe Muster wie withBindScript (G5/S2: eine Quelle
// statt woertlicher Kopie in 5 Dateien, inkl. des ca. 170 KB WING_PNG-Data-URI).
function withWingAssets(html, def) {
  const assets = WING_ASSETS_BY_VARIANT[def.wing];
  return html.replace(WING_CSS_PLACEHOLDER, assets.css).replace(WING_MARKUP_PLACEHOLDER, assets.markup);
}

// Self-contained Widget-HTML EINMAL beim Modul-Load lesen (kein per-Request-IO,
// kein Lazy-Init) und das gemeinsame Binding einbetten. Iframe-Sandbox: kein
// @import/Linkback (Token inline, siehe Datei).
const widgetDir = fileURLToPath(new URL("./widgets/", import.meta.url));
const WIDGET_HTML = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([id, def]) => [
    id,
    withBindScript(withWingAssets(readFileSync(widgetDir + def.file, "utf8"), def)),
  ]),
);

export const hasWidget = (widgetId) =>
  Object.prototype.hasOwnProperty.call(WIDGET_HTML, widgetId);
export const widgetHtml = (widgetId) => WIDGET_HTML[widgetId];
export const widgetTitle = (widgetId) => WIDGET_DEFS[widgetId].title;
