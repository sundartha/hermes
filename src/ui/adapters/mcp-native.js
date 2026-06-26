import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UI_MIME, uiResourceUri } from "../contract.js";

// Bekannte Widgets dieses Adapters (P1: genau eins). widgetId -> Dateiname.
// Neue Widgets (P2) = neuer Eintrag, ohne den Seam zu aendern (OCP).
export const WIDGET_CALL_STATUS = "call-status";
const WIDGET_FILES = { [WIDGET_CALL_STATUS]: "call-status.html" };

// Self-contained Widget-HTML EINMAL beim Modul-Load lesen (kein per-Request-IO,
// kein Lazy-Init). Iframe-Sandbox: kein @import/Linkback (Token inline, siehe Datei).
const widgetDir = fileURLToPath(new URL("../widgets/", import.meta.url));
const WIDGET_HTML = Object.fromEntries(
  Object.entries(WIDGET_FILES).map(([id, f]) => [id, readFileSync(widgetDir + f, "utf8")]),
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
      { title: "Hermes Call Status", mimeType: UI_MIME },
      async () => ({ contents: [{ uri, mimeType: UI_MIME, text: WIDGET_HTML[widgetId] }] }),
    );
  },
};
