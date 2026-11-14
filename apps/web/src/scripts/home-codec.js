const AV1_OFFERS = "video[data-clip] source[data-av1-src][data-av1-type]";
const PROBE_BITRATE = 1_000_000;
const PROBE_FRAMERATE = 24;
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const WIDE_PER_TALL = FALLBACK_WIDTH / FALLBACK_HEIGHT;
const HEIGHT_IN_NAME = /-(\d{3,4})\.(?:av1\.)?mp4$/;
const ANSWER_WAIT_MS = 1500;
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

function probeConfig(offer) {
  return {
    type: "file",
    video: {
      contentType: offer.getAttribute("data-av1-type"),
      ...probeSize(offer),
      bitrate: PROBE_BITRATE,
      framerate: PROBE_FRAMERATE,
    },
  };
}

const runsWell = (info) => Boolean(info && info.supported && info.smooth && info.powerEfficient);

function runsWellHere(caps, offer) {
  try {
    return Promise.resolve(caps.decodingInfo(probeConfig(offer))).then(runsWell, () => false);
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

function goodOffers(caps, offers, waitMs) {
  if (!caps || typeof caps.decodingInfo !== "function") return Promise.resolve([]);
  const checks = offers.map((offer) =>
    runsWellHere(caps, offer).then((good) => (good ? offer : null)),
  );
  const answered = Promise.all(checks).then((good) => good.filter(Boolean));
  return within(answered, waitMs, []);
}

function av1Twin(offer) {
  const av1 = offer.ownerDocument.createElement("source");
  av1.setAttribute("src", offer.getAttribute("data-av1-src"));
  av1.setAttribute("type", offer.getAttribute("data-av1-type"));
  if (offer.hasAttribute("media")) av1.setAttribute("media", offer.getAttribute("media"));
  return av1;
}

function putAv1First(offers) {
  for (const offer of offers) {
    const video = offer.closest("video");
    if (!video || !video.paused) continue;
    offer.before(av1Twin(offer));
    video.setAttribute(STALE_SOURCES, "");
  }
}

export function reloadIfStale(video) {
  if (!video.hasAttribute || !video.hasAttribute(STALE_SOURCES)) return false;
  video.removeAttribute(STALE_SOURCES);
  video.load();
  return true;
}

export function offerDecodableAv1(doc, caps, waitMs = ANSWER_WAIT_MS) {
  const offers = Array.from(doc.querySelectorAll(AV1_OFFERS));
  if (!offers.length) return Promise.resolve();
  return goodOffers(caps, offers, waitMs).then(putAv1First);
}
