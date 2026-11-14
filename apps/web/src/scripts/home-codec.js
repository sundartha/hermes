const AV1_OFFERS = "video[data-clip] source[data-av1-src][data-av1-type]";
const PROBE_BITRATE = 1_000_000;
const PROBE_FRAMERATE = 24;
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const WIDE_PER_TALL = FALLBACK_WIDTH / FALLBACK_HEIGHT;
const HEIGHT_IN_NAME = /-(\d{3,4})\.(?:av1\.)?mp4$/;
const ANSWER_WAIT_MS = 1500;
const STALE_SOURCES = "data-sources-changed";
const DIRECT_SRC = "data-direct-src";
const DIRECT_SRC_DE = "data-direct-src-de";
const GERMAN = "de";
const DIRECT_INVALID = "data-direct-invalid";
const DIRECT_PATH = /^\/assets\/home\/[\w.-]+\.mp4$/;
const SMALL_SCREEN = "(max-width: 1000px)";
const TOUCH_FIRST = "(pointer: coarse)";
const APPLE_MOBILE = /iPad|iPhone|iPod/;
const MAC_UA = /Macintosh/;
const SINGLE_TOUCH_POINT = 1;

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

function answerFor(caps, offer) {
  try {
    return Promise.resolve(caps.decodingInfo(probeConfig(offer))).then(
      (info) => info || null,
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
}

const describe = (info) =>
  info
    ? `supported=${info.supported} smooth=${info.smooth} powerEfficient=${info.powerEfficient}`
    : "keine Antwort";

function runsWellHere(caps, offer, tell) {
  return answerFor(caps, offer).then((info) => {
    if (tell) tell(`decodingInfo ${offer.getAttribute("data-av1-src")}: ${describe(info)}`);
    return runsWell(info);
  });
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

function goodOffers(caps, offers, { waitMs, tell }) {
  if (!caps || typeof caps.decodingInfo !== "function") {
    if (tell) tell("decodingInfo fehlt");
    return Promise.resolve([]);
  }
  const checks = offers.map((offer) =>
    runsWellHere(caps, offer, tell).then((good) => (good ? offer : null)),
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
    if (!video || !video.paused || offer.hasAttribute("data-src-de")) continue;
    offer.before(av1Twin(offer));
    video.setAttribute(STALE_SOURCES, "");
  }
}

export const usesDirectSrc = (video) =>
  Boolean(video.hasAttribute && video.hasAttribute(DIRECT_SRC));

export function directSrcFor(video) {
  const german = video.getAttribute(DIRECT_SRC_DE);
  return german && video.ownerDocument.documentElement.lang === GERMAN
    ? german
    : video.getAttribute(DIRECT_SRC);
}

export function safeDirectPath(path, pageUrl) {
  try {
    const page = new URL(pageUrl);
    const url = new URL(path, page);
    if (url.origin !== page.origin || url.search || url.hash || !DIRECT_PATH.test(url.pathname))
      return null;
    return encodeURI(url.pathname);
  } catch {
    return null;
  }
}

export const hasInvalidDirectSrc = (video) =>
  Boolean(video.hasAttribute && video.hasAttribute(DIRECT_INVALID));

function setDirectSrc(video) {
  const doc = video.ownerDocument;
  const wanted = safeDirectPath(directSrcFor(video), doc.URL);
  if (!wanted) {
    video.setAttribute(DIRECT_INVALID, "");
    video.dispatchEvent(new doc.defaultView.Event("error"));
    return false;
  }
  video.removeAttribute(DIRECT_INVALID);
  if (video.getAttribute("src") === wanted) return false;
  video.setAttribute("src", wanted);
  return true;
}

export function useDirectSources(doc, note) {
  for (const video of doc.querySelectorAll("video[data-clip]")) {
    const sources = Array.from(video.querySelectorAll("source"));
    const plain = sources.find((source) => !source.hasAttribute("media"));
    if (!plain) continue;
    video.setAttribute(DIRECT_SRC, plain.dataset.srcEn || plain.getAttribute("src"));
    if (plain.hasAttribute("data-src-de"))
      video.setAttribute(DIRECT_SRC_DE, plain.getAttribute("data-src-de"));
    for (const source of sources) source.remove();
    if (note) note(`${video.dataset.clip} direkter src ${video.getAttribute(DIRECT_SRC)}`);
  }
}

export function reloadIfStale(video) {
  if (usesDirectSrc(video)) return setDirectSrc(video);
  if (!video.hasAttribute || !video.hasAttribute(STALE_SOURCES)) return false;
  video.removeAttribute(STALE_SOURCES);
  video.load();
  return true;
}

export function prefersH264Only(win) {
  const matches = (query) => typeof win.matchMedia === "function" && win.matchMedia(query).matches;
  const nav = win.navigator || {};
  const agent = nav.userAgent || "";
  const appleTouch =
    APPLE_MOBILE.test(agent) || (MAC_UA.test(agent) && nav.maxTouchPoints > SINGLE_TOUCH_POINT);
  return matches(SMALL_SCREEN) || matches(TOUCH_FIRST) || appleTouch;
}

function forcedAv1(caps, offers, ask) {
  if (ask.tell) {
    ask.tell("Gate: av1=force, AV1 steht vorn");
    goodOffers(caps, offers, ask);
  }
  putAv1First(offers);
  return Promise.resolve();
}

function h264Only(caps, offers, ask) {
  if (ask.tell) {
    ask.tell("Gate: Mobilgerät, nur H.264");
    goodOffers(caps, offers, ask);
  }
  return Promise.resolve();
}

function checkedAv1(caps, offers, ask) {
  return goodOffers(caps, offers, ask).then((good) => {
    if (ask.tell) ask.tell(`Gate: AV1 für ${good.length} von ${offers.length} Quellen`);
    putAv1First(good);
  });
}

export function offerDecodableAv1(doc, caps, options = {}) {
  const offers = Array.from(doc.querySelectorAll(AV1_OFFERS));
  if (!offers.length) return Promise.resolve();
  const ask = {
    waitMs: options.waitMs ?? ANSWER_WAIT_MS,
    tell: typeof options.note === "function" ? options.note : null,
  };
  if (options.force) return forcedAv1(caps, offers, ask);
  if (options.mobile) return h264Only(caps, offers, ask);
  return checkedAv1(caps, offers, ask);
}
