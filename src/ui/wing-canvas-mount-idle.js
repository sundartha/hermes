(function () {
  "use strict";

  var WING_CANVAS_SIZE_PX = 86;
  var WING_CANVAS_FPS_CAP = 24;

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
    if (wing) wing.style.display = "none";
  } catch (e) {
  }
})();
