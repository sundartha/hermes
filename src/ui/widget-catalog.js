// Host-agnostischer Widget-Katalog: kennt die Hermes-Widgets (Id, Datei, Titel) und
// laedt ihre self-contained HTML EINMAL beim Modul-Load - seit T2-02/T-34 EINE
// sprachneutrale Fassung je Widget (die Agentensprache reist als Ergebnis-`_meta`,
// s. widget-i18n.js-Kopfkommentar; die Fassung selbst ist NICHT mehr Teil eines
// Sprach-Schluessels). KEIN Host-/Protokoll-Wissen hier (kein mimeType, kein
// _meta) - dasselbe Widget rendert in JEDEM Host (P3-Ziel). Der Adapter (mcp-native)
// konsumiert diesen Katalog (G5/S2 - eine Quelle fuer die Lade-Logik, keine
// Duplizierung).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BIND_SCRIPT } from "./widget-bind.js";
import { I18N_SCRIPT } from "./widget-i18n.js";
import {
  WING_CSS_DARK_STATIC, WING_MARKUP_DARK_STATIC,
  WING_CSS_DARK_LIVE, WING_MARKUP_DARK_LIVE,
} from "./wing-markup.js";
import { HUD_CARD_CSS } from "./hud-card-css.js";

// Bekannte Widgets. widgetId -> { file, title }. Neue Widgets sind reine Daten-
// Eintraege (OCP), ohne die Adapter-Logik zu aendern. title = Resource-Metadaten je
// Widget (statt eines hartkodierten Magic-Strings, G25).
export const WIDGET_AGENT_STATUS = "agent-status";
export const WIDGET_MY_NUMBER = "my-number";
export const WIDGET_CALLS = "calls";
// W1 (MCP-UI-Live-Widget): vereintes Call-Widget fuer den gesamten Anruf-Lebenszyklus
// (dialing -> in_progress -> completed/failed/cancelled), seit W2 an place_call
// verdrahtet. Subsumiert die frueheren Einzel-Widgets (Status/Cancel/Transkript-
// Zusammenfassung), die in W3 entfernt wurden.
export const WIDGET_CALL = "call";

// H4: alle 3 Read-only-Widgets sind jetzt Olympus-HUD-Karten (volldunkel,
// PLAN-WIDGET-HERMES-REDESIGN.md Abschnitt 6.3) - WING_STATIC (helle
// Auspraegung) hat damit keinen Konsumenten mehr und entfaellt hier (toter
// Code sonst, Muster wie WING_LIVE in H3). WING_CSS_STATIC/WING_MARKUP_STATIC
// bleiben in wing-markup.js exportiert (dort weiterhin eigenstaendig getestet,
// s. mcp-ui-wing-dedup.test.js T-wing-dedup-variants).
const WING_DARK_STATIC = "dark-static";
const WING_DARK_LIVE = "dark-live";
const WING_ASSETS_BY_VARIANT = {
  [WING_DARK_STATIC]: { css: WING_CSS_DARK_STATIC, markup: WING_MARKUP_DARK_STATIC },
  [WING_DARK_LIVE]: { css: WING_CSS_DARK_LIVE, markup: WING_MARKUP_DARK_LIVE },
};

// Wing-Canvas-Engine (H2): self-contained IIFE, EINE Quelle in
// src/ui/wing-canvas-engine.js (byte-identische Kopie der Design-System-
// Authoring-Quelle, siehe deren Kopfkommentar). Als reiner Text geladen wie
// WING_PNG/BIND_SCRIPT (kein ESM-Import - die Engine laeuft im Browser als
// eigenstaendiges Skript, nicht als Node-Modul).
const WING_ENGINE_JS = readFileSync(
  fileURLToPath(new URL("./wing-canvas-engine.js", import.meta.url)),
  "utf8",
);
const WING_ENGINE_PLACEHOLDER = "<!--__WING_ENGINE__-->";
const WING_ENGINE_SCRIPT = `<script>\n${WING_ENGINE_JS}\n</script>`;

// Fuegt die Wing-Canvas-Engine an ihrem Platzhalter ein - Muster wie
// withBindScript/withWingAssets, aber OHNE deren defensives Anhaengen: fehlt
// der Platzhalter, bleibt das HTML byte-unveraendert (heute tragen ihn alle 4
// Widgets). Exportiert (anders als withBindScript/withWingAssets, die ueber
// echte Widget-Dateien indirekt getestet werden): die Injektion wird ueber ein
// synthetisches Fixture direkt getestet (P13, aus H2, als noch kein echtes
// Widget den Platzhalter trug).
export function withWingEngine(html) {
  if (!html.includes(WING_ENGINE_PLACEHOLDER)) return html;
  return html.replace(WING_ENGINE_PLACEHOLDER, WING_ENGINE_SCRIPT);
}

// Wing-Canvas-Mount-Idle (H4): generisches, self-contained Mount-Skript fuer die
// 3 Read-only-Widgets - identisch fuer alle drei (nie ein Statuswechsel), EINE
// Quelle statt 3x derselben ~15 Zeilen (G5/S2). Muster wie WING_ENGINE_SCRIPT.
const WING_CANVAS_MOUNT_IDLE_JS = readFileSync(
  fileURLToPath(new URL("./wing-canvas-mount-idle.js", import.meta.url)),
  "utf8",
);
const WING_CANVAS_MOUNT_PLACEHOLDER = "<!--__WING_CANVAS_MOUNT__-->";
const WING_CANVAS_MOUNT_SCRIPT = `<script>\n${WING_CANVAS_MOUNT_IDLE_JS}\n</script>`;

export function withWingCanvasMount(html) {
  if (!html.includes(WING_CANVAS_MOUNT_PLACEHOLDER)) return html;
  return html.replace(WING_CANVAS_MOUNT_PLACEHOLDER, WING_CANVAS_MOUNT_SCRIPT);
}

// Lokalisierung (widget-i18n.js): im <head> JEDES Widgets, damit
// window.HermesI18n fuer die Inline-Skripte (call.html STATUS_VIEW) synchron
// verfuegbar ist. Muster wie withWingEngine; dass der Platzhalter in allen
// Widget-Quellen steht, sichert der Injektions-Test (mcp-ui-widget-i18n).
const I18N_PLACEHOLDER = "<!--__I18N__-->";

// Injiziert das EINE, sprachneutrale Lokalisierungs-Script (T2-02/T-34 - kein
// Sprachparameter mehr, s. widget-i18n.js-Kopfkommentar). Kein Platzhalter im
// HTML -> byte-unveraendert (defensiv, wie withWingEngine).
export function withI18nScript(html) {
  if (!html.includes(I18N_PLACEHOLDER)) return html;
  return html.replace(I18N_PLACEHOLDER, I18N_SCRIPT);
}

// Gemeinsamer Olympus-HUD-Kartenrahmen (H4): eine Quelle (hud-card-css.js)
// statt 4x derselben ~35 CSS-Zeilen (G5/S2, s. dortiger Kopfkommentar).
const HUD_CARD_CSS_PLACEHOLDER = "/*__HUD_CARD_CSS__*/";

export function withHudCardCss(html) {
  if (!html.includes(HUD_CARD_CSS_PLACEHOLDER)) return html;
  return html.replace(HUD_CARD_CSS_PLACEHOLDER, HUD_CARD_CSS);
}

const WIDGET_DEFS = {
  [WIDGET_AGENT_STATUS]: { file: "agent-status.html", title: "Hermes Agent Status", wing: WING_DARK_STATIC },
  [WIDGET_MY_NUMBER]: { file: "my-number.html", title: "Hermes Agent Number", wing: WING_DARK_STATIC },
  [WIDGET_CALLS]: { file: "calls.html", title: "Hermes Call List", wing: WING_DARK_STATIC },
  [WIDGET_CALL]: { file: "call.html", title: "Hermes Call", wing: WING_DARK_LIVE },
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
//
// T2-02/T-34: EINE fertige, sprachneutrale Fassung je Widget (vormals "Stufe 1" +
// "Stufe 2 je Sprache" - die Sprachmatrix entfaellt, s. widget-i18n.js). EINMAL
// beim Modul-Load gelesen und zusammengesetzt, kein per-Request-IO, kein Lazy-Init
// (P15).
const widgetDir = fileURLToPath(new URL("./widgets/", import.meta.url));
const WIDGET_BASE_HTML = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([id, def]) => {
    const raw = readFileSync(widgetDir + def.file, "utf8");
    const withCss = withHudCardCss(raw);
    const withAssets = withWingAssets(withCss, def);
    const withEngine = withWingEngine(withAssets);
    const withMount = withWingCanvasMount(withEngine);
    const withI18n = withI18nScript(withMount);
    return [id, withBindScript(withI18n)];
  }),
);

// Cache-feste, sprachunabhaengige Resource-URIs (T2-02/T-34): Pin-Datei
// widget-versions.json bindet je Widget die hoechste Version an den SHA-256 des
// ausgelieferten HTML (Regel + Pflege s. Kopf der Pin-Datei). Laufzeit liest NUR
// die Version (Muster chatgpt-egress.js: readFileSync + JSON.parse beim
// Modul-Load, kein Netz-/Datei-Zugriff pro Request).
const WIDGET_VERSIONS_PATH = fileURLToPath(new URL("./widget-versions.json", import.meta.url));
const WIDGET_VERSIONS = JSON.parse(readFileSync(WIDGET_VERSIONS_PATH, "utf8"));

// Hoechste gepinnte Version eines Widgets, oder null wenn keine existiert. null ist
// der fail-closed-Fall: hasWidget() unten faellt dann auf Stufe-0-only zurueck
// (kein Boot-Abbruch, s. Spec-Pre-Mortem 5).
export function widgetVersion(widgetId) {
  const versions = WIDGET_VERSIONS[widgetId];
  if (!versions || typeof versions !== "object") return null;
  const numbers = Object.keys(versions)
    .map(Number)
    .filter((version) => Number.isInteger(version) && version > 0);
  return numbers.length ? Math.max(...numbers) : null;
}

// hasWidget ist jetzt AN eine vorhandene Pin-Version gebunden (nicht nur an die
// geladene HTML-Basis) - fehlt der Pin, gilt das Widget als nicht vorhanden
// (fail-closed, s. widgetVersion oben).
export const hasWidget = (widgetId) =>
  Object.prototype.hasOwnProperty.call(WIDGET_BASE_HTML, widgetId) && widgetVersion(widgetId) !== null;
// Sprachfreie, byte-stabile Fassung (T2-02/T-34) - kein Sprachparameter mehr (die
// Sprache reist ueber Ergebnis-`_meta`, s. widget-i18n.js).
export const widgetHtml = (widgetId) => WIDGET_BASE_HTML[widgetId];
export const widgetTitle = (widgetId) => WIDGET_DEFS[widgetId].title;
