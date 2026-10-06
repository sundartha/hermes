import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BIND_SCRIPT } from "./widget-bind.js";
import { I18N_SCRIPT } from "./widget-i18n.js";
import {
  WING_CSS_DARK_STATIC, WING_MARKUP_DARK_STATIC,
  WING_CSS_DARK_LIVE, WING_MARKUP_DARK_LIVE,
} from "./wing-markup.js";
import { HUD_CARD_CSS } from "./hud-card-css.js";

export const WIDGET_AGENT_STATUS = "agent-status";
export const WIDGET_MY_NUMBER = "my-number";
export const WIDGET_CALLS = "calls";
export const WIDGET_CALL = "call";

const WING_DARK_STATIC = "dark-static";
const WING_DARK_LIVE = "dark-live";
const WING_ASSETS_BY_VARIANT = {
  [WING_DARK_STATIC]: { css: WING_CSS_DARK_STATIC, markup: WING_MARKUP_DARK_STATIC },
  [WING_DARK_LIVE]: { css: WING_CSS_DARK_LIVE, markup: WING_MARKUP_DARK_LIVE },
};

const WING_ENGINE_JS = readFileSync(
  fileURLToPath(new URL("./wing-canvas-engine.js", import.meta.url)),
  "utf8",
);
const WING_ENGINE_PLACEHOLDER = "<!--__WING_ENGINE__-->";
const WING_ENGINE_SCRIPT = `<script>\n${WING_ENGINE_JS}\n</script>`;

export function withWingEngine(html) {
  if (!html.includes(WING_ENGINE_PLACEHOLDER)) return html;
  return html.replace(WING_ENGINE_PLACEHOLDER, WING_ENGINE_SCRIPT);
}

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

const I18N_PLACEHOLDER = "<!--__I18N__-->";

export function withI18nScript(html) {
  if (!html.includes(I18N_PLACEHOLDER)) return html;
  return html.replace(I18N_PLACEHOLDER, I18N_SCRIPT);
}

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

const BODY_CLOSE = "</body>";

function withBindScript(html) {
  const idx = html.lastIndexOf(BODY_CLOSE);
  if (idx === -1) return html + BIND_SCRIPT;
  return html.slice(0, idx) + BIND_SCRIPT + html.slice(idx);
}

const WING_CSS_PLACEHOLDER = "/*__WING_CSS__*/";
const WING_MARKUP_PLACEHOLDER = "<!--__WING_MARKUP__-->";

function withWingAssets(html, def) {
  const assets = WING_ASSETS_BY_VARIANT[def.wing];
  return html.replace(WING_CSS_PLACEHOLDER, assets.css).replace(WING_MARKUP_PLACEHOLDER, assets.markup);
}

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

const WIDGET_VERSIONS_PATH = fileURLToPath(new URL("./widget-versions.json", import.meta.url));
const WIDGET_VERSIONS = JSON.parse(readFileSync(WIDGET_VERSIONS_PATH, "utf8"));

export function widgetVersion(widgetId) {
  const versions = WIDGET_VERSIONS[widgetId];
  if (!versions || typeof versions !== "object") return null;
  const numbers = Object.keys(versions)
    .map(Number)
    .filter((version) => Number.isInteger(version) && version > 0);
  return numbers.length ? Math.max(...numbers) : null;
}

export const hasWidget = (widgetId) =>
  Object.prototype.hasOwnProperty.call(WIDGET_BASE_HTML, widgetId) && widgetVersion(widgetId) !== null;
export const widgetHtml = (widgetId) => WIDGET_BASE_HTML[widgetId];
export const widgetTitle = (widgetId) => WIDGET_DEFS[widgetId].title;
