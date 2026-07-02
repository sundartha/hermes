// Host-agnostischer Widget-Katalog: kennt die Hermes-Widgets (Id, Datei, Titel) und
// laedt ihre self-contained HTML EINMAL beim Modul-Load. KEIN Host-/Protokoll-Wissen
// hier (kein mimeType, kein _meta) - dasselbe Widget rendert in JEDEM Host (P3-Ziel).
// Beide Adapter (mcp-native, chatgpt) konsumieren diesen Katalog (G5/S2 - eine Quelle
// fuer die Lade-Logik, keine Duplizierung).
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
export const WIDGET_CALENDAR = "calendar";
// W1 (MCP-UI-Live-Widget): vereintes Call-Widget fuer den gesamten Anruf-Lebenszyklus
// (dialing -> in_progress -> completed/failed/cancelled), seit W2 an place_call
// verdrahtet. Subsumiert die frueheren Einzel-Widgets (Status/Cancel/Transkript-
// Zusammenfassung), die in W3 entfernt wurden.
export const WIDGET_CALL = "call";

// H4: alle 4 Read-only-Widgets sind jetzt Olympus-HUD-Karten (volldunkel,
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
// der Platzhalter (heute alle 5 Widgets - H3/H4 fuehren ihn erst ein), bleibt
// das HTML byte-unveraendert. Exportiert (anders als withBindScript/
// withWingAssets, die ueber echte Widget-Dateien indirekt getestet werden):
// in H2 traegt noch kein echtes Widget den Platzhalter, die Injektion wird
// deshalb ueber ein synthetisches Fixture direkt getestet (P13).
export function withWingEngine(html) {
  if (!html.includes(WING_ENGINE_PLACEHOLDER)) return html;
  return html.replace(WING_ENGINE_PLACEHOLDER, WING_ENGINE_SCRIPT);
}

// Wing-Canvas-Mount-Idle (H4): generisches, self-contained Mount-Skript fuer die
// 4 Read-only-Widgets - identisch fuer alle vier (nie ein Statuswechsel), EINE
// Quelle statt 4x derselben ~15 Zeilen (G5/S2). Muster wie WING_ENGINE_SCRIPT.
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
  [WIDGET_CALENDAR]: { file: "calendar.html", title: "Hermes Calendar", wing: WING_DARK_STATIC },
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
const widgetDir = fileURLToPath(new URL("./widgets/", import.meta.url));
const WIDGET_HTML = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([id, def]) => {
    const raw = readFileSync(widgetDir + def.file, "utf8");
    const withCss = withHudCardCss(raw);
    const withAssets = withWingAssets(withCss, def);
    const withI18n = withI18nScript(withAssets);
    const withEngine = withWingEngine(withI18n);
    const withMount = withWingCanvasMount(withEngine);
    return [id, withBindScript(withMount)];
  }),
);

export const hasWidget = (widgetId) =>
  Object.prototype.hasOwnProperty.call(WIDGET_HTML, widgetId);
export const widgetHtml = (widgetId) => WIDGET_HTML[widgetId];
export const widgetTitle = (widgetId) => WIDGET_DEFS[widgetId].title;
