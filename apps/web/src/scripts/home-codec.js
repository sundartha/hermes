const AV1_OFFERS = "video[data-clip] source[data-av1-src][data-av1-type]";
const PROBE_BITRATE = 1_000_000;
const PROBE_FRAMERATE = 24;
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const WIDE_PER_TALL = FALLBACK_WIDTH / FALLBACK_HEIGHT;
const HEIGHT_IN_NAME = /-(\d{3,4})\.(?:av1\.)?mp4$/;
const ANSWER_WAIT_MS = 1500;
const STALE_SOURCES = "data-sources-changed";
const SMALL_SCREEN = "(max-width: 1000px)";
const TOUCH_FIRST = "(pointer: coarse)";
const APPLE_MOBILE = /iPad|iPhone|iPod/;
const DESKTOP_SAFARI_UA = /Macintosh/;
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

export function reloadIfStale(video) {
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
    APPLE_MOBILE.test(agent) ||
    (DESKTOP_SAFARI_UA.test(agent) && nav.maxTouchPoints > SINGLE_TOUCH_POINT);
  return matches(SMALL_SCREEN) || matches(TOUCH_FIRST) || appleTouch;
}

function forcedAv1(offers, tell) {
  if (tell) tell("Gate: av1=force, AV1 steht vorn");
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
  if (options.force) return forcedAv1(offers, ask.tell);
  if (options.mobile) return h264Only(caps, offers, ask);
  return checkedAv1(caps, offers, ask);
}
