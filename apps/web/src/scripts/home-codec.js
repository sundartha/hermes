const AV1_SOURCES = 'video[data-clip] source[type*="av01"]';
const PROBE_BITRATE = 1_000_000;
const PROBE_FRAMERATE = 24;
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const WIDE_PER_TALL = FALLBACK_WIDTH / FALLBACK_HEIGHT;
const HEIGHT_IN_NAME = /-(\d{3,4})\.(?:av1\.)?mp4$/;
const ANSWER_WAIT_MS = 1500;
const LOADS_LATER = "none";
const STALE_SOURCES = "data-sources-changed";

function probeSize(source) {
  const named = HEIGHT_IN_NAME.exec(source.getAttribute("src") || "");
  if (named) {
    const height = Number(named[1]);
    return { width: Math.round(height * WIDE_PER_TALL), height };
  }
  const video = source.closest("video");
  return {
    width: Number(video.getAttribute("width")) || FALLBACK_WIDTH,
    height: Number(video.getAttribute("height")) || FALLBACK_HEIGHT,
  };
}

function probeConfig(source) {
  return {
    type: "file",
    video: {
      contentType: source.type,
      ...probeSize(source),
      bitrate: PROBE_BITRATE,
      framerate: PROBE_FRAMERATE,
    },
  };
}

const runsWell = (info) => Boolean(info && info.supported && info.smooth && info.powerEfficient);

function keepsSource(caps, source) {
  try {
    return Promise.resolve(caps.decodingInfo(probeConfig(source))).then(runsWell, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

function within(promise, waitMs, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), waitMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function weakSources(caps, sources, waitMs) {
  if (!caps || typeof caps.decodingInfo !== "function") return Promise.resolve(sources);
  const checks = sources.map((source) =>
    keepsSource(caps, source).then((keep) => (keep ? null : source)),
  );
  const answered = Promise.all(checks).then((weak) => weak.filter(Boolean));
  return within(answered, waitMs, sources);
}

function removeSources(sources) {
  const touched = new Set();
  for (const source of sources) {
    touched.add(source.closest("video"));
    source.remove();
  }
  for (const video of touched) {
    if (video.getAttribute("preload") === LOADS_LATER) video.setAttribute(STALE_SOURCES, "");
    else video.load();
  }
}

export function reloadIfStale(video) {
  if (!video.hasAttribute || !video.hasAttribute(STALE_SOURCES)) return false;
  video.removeAttribute(STALE_SOURCES);
  video.load();
  return true;
}

export function dropUndecodableAv1(doc, caps, waitMs = ANSWER_WAIT_MS) {
  const sources = Array.from(doc.querySelectorAll(AV1_SOURCES));
  if (!sources.length) return Promise.resolve();
  return weakSources(caps, sources, waitMs).then(removeSources);
}
