// Diagnose-Seite fuer den Safari-Videofehler (E4) auf dem iPhone. Kein Bezug zur Startseite.
document.getElementById("ua").textContent = navigator.userAgent;

for (const video of document.querySelectorAll("video[data-case]")) {
  const line = video.parentElement.querySelector(".st");
  const seen = [];
  const show = () => {
    const err = video.error ? `E${video.error.code}${video.error.message ? " " + video.error.message : ""}` : "-";
    const playing = !video.paused && video.currentTime > 0;
    line.className = "st " + (video.error ? "bad" : playing ? "ok" : "");
    line.textContent =
      `${video.dataset.case}: ${video.error ? "FEHLER" : playing ? "LAEUFT" : "wartet"} · fehler=${err} · ns=${video.networkState} rs=${video.readyState} t=${video.currentTime.toFixed(1)} · ${seen.slice(-5).join(",")}`;
  };
  for (const name of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "stalled", "suspend", "abort", "error", "emptied"]) {
    video.addEventListener(name, () => {
      seen.push(name);
      show();
    });
  }
  for (const source of video.querySelectorAll("source")) {
    source.addEventListener("error", () => {
      seen.push("source-error");
      show();
    });
  }
  video.addEventListener("timeupdate", show);
  show();
}
