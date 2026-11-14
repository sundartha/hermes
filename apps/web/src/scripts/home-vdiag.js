const DIAG_PARAM = "vdiag";
const FORCE_PARAM = "av1";
const FORCE_VALUE = "force";
const ON = "1";
const FAILED_CLASS = "is-failed";
const MAX_LINES = 80;
const VIDEO_EVENTS = Object.freeze([
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "playing",
  "waiting",
  "stalled",
  "suspend",
  "abort",
  "emptied",
  "volumechange",
  "error",
]);
const BOX_STYLE = Object.freeze({
  position: "fixed",
  left: "0",
  right: "0",
  bottom: "0",
  maxHeight: "45vh",
  overflow: "auto",
  margin: "0",
  padding: "6px",
  zIndex: "2147483647",
  background: "rgba(0, 0, 0, 0.88)",
  color: "#b8f5b0",
  font: "10px/1.3 ui-monospace, Menlo, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

const fileName = (url) => (url || "").split("/").pop() || "-";

function mediaError(video) {
  const { error } = video;
  return error ? ` error=${error.code}:${error.message || "-"}` : "";
}

function videoState(video) {
  return `ns=${video.networkState} rs=${video.readyState} stumm=${video.muted ? "ja" : "nein"} src=${fileName(video.currentSrc)}${mediaError(video)}`;
}

export function videoDiagnosis(win, doc) {
  const params = new URLSearchParams(win.location.search);
  if (params.get(DIAG_PARAM) !== ON) return null;
  const started = win.performance.now();
  const lines = [];
  const box = doc.createElement("pre");
  box.className = "vdiag";
  box.setAttribute("aria-hidden", "true");
  Object.assign(box.style, BOX_STYLE);
  const render = () => {
    box.textContent = lines.join("\n");
    box.scrollTop = box.scrollHeight;
  };
  const note = (text) => {
    lines.push(`${Math.round(win.performance.now() - started)}ms ${text}`);
    if (lines.length > MAX_LINES) lines.splice(1, lines.length - MAX_LINES);
    render();
  };
  note(`UA ${win.navigator.userAgent}`);
  const last = new Map();
  const watch = (video) => {
    const clip = video.dataset.clip;
    note(`${clip} start ${videoState(video)}`);
    for (const type of VIDEO_EVENTS) {
      video.addEventListener(type, () => {
        const text = `${clip} ${type} ${videoState(video)}`;
        last.set(video, text);
        note(text);
      });
    }
    for (const source of video.querySelectorAll("source")) {
      source.addEventListener("error", () => {
        const text = `${clip} source-error ${fileName(source.getAttribute("src"))} ns=${video.networkState}`;
        last.set(video, text);
        note(text);
      });
    }
    const slot = video.closest(".vslot");
    if (!slot) return;
    let failed = slot.classList.contains(FAILED_CLASS);
    new win.MutationObserver(() => {
      const now = slot.classList.contains(FAILED_CLASS);
      if (now === failed) return;
      failed = now;
      note(now ? `${clip} FEHLERZEILE nach: ${last.get(video) || "-"}` : `${clip} Fehlerzeile weg`);
    }).observe(slot, { attributes: true, attributeFilter: ["class"] });
  };
  return {
    forceAv1: params.get(FORCE_PARAM) === FORCE_VALUE,
    note,
    watchVideos: () => {
      for (const video of doc.querySelectorAll("video[data-clip]")) watch(video);
      doc.body.append(box);
      render();
    },
  };
}
