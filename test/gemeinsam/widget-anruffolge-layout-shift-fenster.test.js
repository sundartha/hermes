import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 120000 };
const TEMPO_KURZ = 0.1;

function mitVerschiebung(html, wann) {
  const skript = [
    "<script>",
    "(function () {",
    "  var spacer = document.createElement('div');",
    "  spacer.style.cssText = 'height:0;margin:0;padding:0';",
    "  document.body.insertBefore(spacer, document.body.firstChild);",
    "  var verschiebe = function () {",
    "    requestAnimationFrame(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { spacer.style.height = '100px'; }); }); });",
    "  };",
    wann === "vor_abheben"
      ? "  verschiebe();"
      : "  var getan = false; window.addEventListener('message', function (e) { var sc = e.data && e.data.result && e.data.result.structuredContent; if (!getan && sc && sc.status === 'in_progress') { getan = true; verschiebe(); } });",
    "})();",
    "</script>",
  ].join("\n");
  assert.ok(html.includes("</body>"), "Widget-HTML ohne body-Ende");
  return html.replace("</body>", () => `${skript}</body>`);
}

const laeufe = new Map();

function lauf(wann) {
  if (!laeufe.has(wann)) {
    laeufe.set(wann, ausgelieferteWidgets().then(({ call }) => messeAnruffolge(chrome, mitVerschiebung(call, wann), { szenario: "voll_de", tempo: TEMPO_KURZ })));
  }
  return laeufe.get(wann);
}

test("Verschiebung im Gesprächsfenster zählt in layout_shift_fenster, eine vor dem Abheben nicht", OPTIONS, async () => {
  const im = await lauf("im_gespraech");
  const vor = await lauf("vor_abheben");
  assert.ok(im.layout_shift_fenster > vor.layout_shift_fenster, `im Gespräch ${im.layout_shift_fenster}, vor dem Abheben ${vor.layout_shift_fenster}`);
  assert.ok(im.layout_shift_fenster <= im.layout_shift);
});

test("Verschiebung vor dem Abheben steht in layout_shift, aber nicht in layout_shift_fenster", OPTIONS, async () => {
  const vor = await lauf("vor_abheben");
  assert.ok(vor.layout_shift_fenster < vor.layout_shift, `Fenster ${vor.layout_shift_fenster}, gesamt ${vor.layout_shift}`);
});
