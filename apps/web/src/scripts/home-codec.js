const AV1_SOURCES = 'video[data-clip] source[type*="av01"]';
const PROBE_BITRATE = 1_000_000;
const PROBE_FRAMERATE = 24;
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const ANSWER_WAIT_MS = 1500;

function probeConfig(source) {
  const video = source.closest("video");
  return {
    type: "file",
    video: {
      contentType: source.type,
      width: Number(video.getAttribute("width")) || FALLBACK_WIDTH,
      height: Number(video.getAttribute("height")) || FALLBACK_HEIGHT,
      bitrate: PROBE_BITRATE,
      framerate: PROBE_FRAMERATE,
    },
  };
}

function askBrowser(caps, source) {
  try {
    return Promise.resolve(caps.decodingInfo(probeConfig(source))).then(
      (info) => Boolean(info) && info.supported === false,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

function undecodableTypes(caps, sources) {
  const byType = new Map();
  for (const source of sources) if (!byType.has(source.type)) byType.set(source.type, source);
  const checks = Array.from(byType, ([type, source]) => askBrowser(caps, source).then((bad) => (bad ? type : null)));
  return Promise.all(checks).then((types) => new Set(types.filter(Boolean)));
}

function within(promise, waitMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(new Set()), waitMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function removeSources(sources, badTypes) {
  const touched = new Set();
  for (const source of sources) {
    if (!badTypes.has(source.type)) continue;
    touched.add(source.closest("video"));
    source.remove();
  }
  for (const video of touched) video.load();
}

export function dropUndecodableAv1(doc, caps, waitMs = ANSWER_WAIT_MS) {
  const sources = Array.from(doc.querySelectorAll(AV1_SOURCES));
  if (!sources.length || !caps || typeof caps.decodingInfo !== "function") return Promise.resolve();
  return within(undecodableTypes(caps, sources), waitMs).then((badTypes) => removeSources(sources, badTypes));
}
