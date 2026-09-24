// Read-only-Widgets (H4: agent-status/my-number/calls; calendar entfallen
// seit T2-12): montiert die
// Wing-Canvas-Engine ruhig im idle-Zustand (H0-Entscheidungsregel erfuellt:
// 86px/8x12 median 0.10ms << 2.5ms Haupt-Thread + Visibility-Gating wirksam ->
// Canvas-idle erlaubt, siehe tasks/widget-hermes-redesign-chain.md H0-ERGEBNIS).
// fpsCap<=24. Anders als call.html (eigene Zustandsmaschine, H3) gibt es hier
// NIE einen Statuswechsel - kein setStatus-Aufruf noetig, nur ein einmaliger
// Mount-Versuch beim Laden. EINE Quelle statt 3x derselben ~15 Zeilen in den
// Widget-Dateien (G5/S2), injiziert von widget-catalog.js (withWingCanvasMount)
// ueber einen Platzhalter am Body-Ende - dasselbe Muster wie die Wing-Canvas-
// Engine selbst (withWingEngine).
//
// Selektoren bewusst ohne data-wing-Attribut (das ist der call.html-
// Statuswechsel-Hook, hier unnoetig): die generische .wing-Klasse traegt jede
// Wing-Auspraegung (STATIC/DARK_STATIC/DARK_LIVE) und ist pro Widget genau
// einmal vorhanden.
//
// Fail-safe wie mountWingEngine in call.html (H3): scheitert mount() (kein
// 2D-Context, Engine fehlt, DOM-Hooks fehlen), bleibt die CSS-WingMark
// sichtbar - NIE ein leeres Loch statt Marke (Absolute Regel 3).
(function () {
  "use strict";

  var WING_CANVAS_SIZE_PX = 86; // deckt sich mit --wing-size in hud-card-css.js (Drift-Test)
  var WING_CANVAS_FPS_CAP = 24; // H0-Entscheidungsregel: Canvas-idle nur mit fpsCap<=24

  if (!(window.HermesWingCanvas && typeof window.HermesWingCanvas.mount === "function")) return;
  var host = document.querySelector("[data-wing-canvas]");
  var wingImg = document.querySelector(".wing img");
  if (!host || !wingImg) return;

  try {
    window.HermesWingCanvas.mount(host, {
      size: WING_CANVAS_SIZE_PX,
      fpsCap: WING_CANVAS_FPS_CAP,
      status: "idle",
      src: wingImg.src,
    });
    var wing = document.querySelector(".wing");
    if (wing) wing.style.display = "none"; // Canvas ersetzt die CSS-Marke NACH Erfolg (progressive enhancement)
  } catch (e) {
    /* fail-safe: CSS-WingMark bleibt die einzige sichtbare Marke */
  }
})();
