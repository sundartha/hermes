// Host-agnostischer Widget-Katalog: kennt die Hermes-Widgets (Id, Datei, Titel) und
// laedt ihre self-contained HTML EINMAL beim Modul-Load. KEIN Host-/Protokoll-Wissen
// hier (kein mimeType, kein _meta) - dasselbe Widget rendert in JEDEM Host (P3-Ziel).
// Beide Adapter (mcp-native, chatgpt) konsumieren diesen Katalog (G5/S2 - eine Quelle
// fuer die Lade-Logik, keine Duplizierung).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bekannte Widgets. widgetId -> { file, title }. Neue Widgets sind reine Daten-
// Eintraege (OCP), ohne die Adapter-Logik zu aendern. title = Resource-Metadaten je
// Widget (statt eines hartkodierten Magic-Strings, G25).
export const WIDGET_CALL_STATUS = "call-status";
export const WIDGET_CALL_RESULT = "call-result";
export const WIDGET_TRANSCRIPT = "transcript";
const WIDGET_DEFS = {
  [WIDGET_CALL_STATUS]: { file: "call-status.html", title: "Hermes Call Status" },
  [WIDGET_CALL_RESULT]: { file: "call-result.html", title: "Hermes Call Result" },
  [WIDGET_TRANSCRIPT]: { file: "transcript.html", title: "Hermes Transcript" },
};

// Self-contained Widget-HTML EINMAL beim Modul-Load lesen (kein per-Request-IO,
// kein Lazy-Init). Iframe-Sandbox: kein @import/Linkback (Token inline, siehe Datei).
const widgetDir = fileURLToPath(new URL("./widgets/", import.meta.url));
const WIDGET_HTML = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([id, def]) => [id, readFileSync(widgetDir + def.file, "utf8")]),
);

export const hasWidget = (widgetId) =>
  Object.prototype.hasOwnProperty.call(WIDGET_HTML, widgetId);
export const widgetHtml = (widgetId) => WIDGET_HTML[widgetId];
export const widgetTitle = (widgetId) => WIDGET_DEFS[widgetId].title;
