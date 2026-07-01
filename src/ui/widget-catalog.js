// Host-agnostischer Widget-Katalog: kennt die Hermes-Widgets (Id, Datei, Titel) und
// laedt ihre self-contained HTML EINMAL beim Modul-Load. KEIN Host-/Protokoll-Wissen
// hier (kein mimeType, kein _meta) - dasselbe Widget rendert in JEDEM Host (P3-Ziel).
// Beide Adapter (mcp-native, chatgpt) konsumieren diesen Katalog (G5/S2 - eine Quelle
// fuer die Lade-Logik, keine Duplizierung).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BIND_SCRIPT } from "./widget-bind.js";

// Bekannte Widgets. widgetId -> { file, title }. Neue Widgets sind reine Daten-
// Eintraege (OCP), ohne die Adapter-Logik zu aendern. title = Resource-Metadaten je
// Widget (statt eines hartkodierten Magic-Strings, G25).
export const WIDGET_CALL_STATUS = "call-status";
export const WIDGET_CALL_RESULT = "call-result";
export const WIDGET_TRANSCRIPT = "transcript";
export const WIDGET_AGENT_STATUS = "agent-status";
export const WIDGET_MY_NUMBER = "my-number";
export const WIDGET_CALLS = "calls";
export const WIDGET_CALENDAR = "calendar";
// W1 (MCP-UI-Live-Widget): vereintes Call-Widget fuer den gesamten Anruf-Lebenszyklus
// (dialing -> in_progress -> completed/failed/cancelled). Subsumiert perspektivisch
// call-status/call-result/transcript (deren Entfernung folgt in W3, NACH dem
// Tool-Rewiring in W2 - noch NICHT an ein Tool verdrahtet, siehe
// tasks/mcp-ui-live-widget-chain.md Abschnitt W1/W2).
export const WIDGET_CALL = "call";
// C5 Wegwerf-Spike: Probe-Widget fuer die Host-Tool-Bruecke (In-place-Refresh). Nach C6
// wieder entfernen (diese Konstante + WIDGET_DEFS-Eintrag + die HTML-Datei + Tool-Block).
export const WIDGET_PROBE = "probe-call-bridge";
const WIDGET_DEFS = {
  [WIDGET_CALL_STATUS]: { file: "call-status.html", title: "Hermes Call Status" },
  [WIDGET_CALL_RESULT]: { file: "call-result.html", title: "Hermes Call Result" },
  [WIDGET_TRANSCRIPT]: { file: "transcript.html", title: "Hermes Transcript" },
  [WIDGET_AGENT_STATUS]: { file: "agent-status.html", title: "Hermes Agent Status" },
  [WIDGET_MY_NUMBER]: { file: "my-number.html", title: "Hermes Agent Number" },
  [WIDGET_CALLS]: { file: "calls.html", title: "Hermes Call List" },
  [WIDGET_CALENDAR]: { file: "calendar.html", title: "Hermes Calendar" },
  [WIDGET_CALL]: { file: "call.html", title: "Hermes Call" },
  [WIDGET_PROBE]: { file: "probe-call-bridge.html", title: "Hermes Widget Bridge Probe" },
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

// Self-contained Widget-HTML EINMAL beim Modul-Load lesen (kein per-Request-IO,
// kein Lazy-Init) und das gemeinsame Binding einbetten. Iframe-Sandbox: kein
// @import/Linkback (Token inline, siehe Datei).
const widgetDir = fileURLToPath(new URL("./widgets/", import.meta.url));
const WIDGET_HTML = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([id, def]) => [
    id,
    withBindScript(readFileSync(widgetDir + def.file, "utf8")),
  ]),
);

export const hasWidget = (widgetId) =>
  Object.prototype.hasOwnProperty.call(WIDGET_HTML, widgetId);
export const widgetHtml = (widgetId) => WIDGET_HTML[widgetId];
export const widgetTitle = (widgetId) => WIDGET_DEFS[widgetId].title;
