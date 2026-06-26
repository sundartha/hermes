import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UI_MIME, uiResourceUri } from "../contract.js";

// Bekannte Widgets dieses Adapters. widgetId -> { file, title }. Neue Widgets sind
// reine Daten-Eintraege (OCP), ohne die Seam-Logik (Capability/Dispatch) zu aendern.
// title = Resource-Metadaten je Widget (statt eines hartkodierten Magic-Strings, G25).
export const WIDGET_CALL_STATUS = "call-status";
export const WIDGET_TRANSCRIPT = "transcript";
const WIDGET_DEFS = {
  [WIDGET_CALL_STATUS]: { file: "call-status.html", title: "Hermes Call Status" },
  [WIDGET_TRANSCRIPT]: { file: "transcript.html", title: "Hermes Transcript" },
};

// Self-contained Widget-HTML EINMAL beim Modul-Load lesen (kein per-Request-IO,
// kein Lazy-Init). Iframe-Sandbox: kein @import/Linkback (Token inline, siehe Datei).
const widgetDir = fileURLToPath(new URL("../widgets/", import.meta.url));
const WIDGET_HTML = Object.fromEntries(
  Object.entries(WIDGET_DEFS).map(([id, def]) => [id, readFileSync(widgetDir + def.file, "utf8")]),
);

/** @type {import("../ports.js").UiRenderer} */
export const mcpNativeRenderer = {
  mimeType: UI_MIME,
  hasWidget: (widgetId) => Object.prototype.hasOwnProperty.call(WIDGET_HTML, widgetId),
  resourceUri: (widgetId) => uiResourceUri(widgetId),
  registerResource(server, widgetId) {
    const uri = uiResourceUri(widgetId);
    server.registerResource(
      widgetId,
      uri,
      { title: WIDGET_DEFS[widgetId].title, mimeType: UI_MIME },
      async () => ({ contents: [{ uri, mimeType: UI_MIME, text: WIDGET_HTML[widgetId] }] }),
    );
  },
};
