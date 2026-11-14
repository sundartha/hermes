import { onOwnControl } from "./home-sound.js";
import { reloadIfStale } from "./home-codec.js";

const HAVE_NOTHING = 0;
const HAVE_CURRENT_DATA = 2;
const START_TOLERANCE_S = 0.05;
const FRAMES_PER_S = 24;
const FIRST_DIMMED_FRAME = Object.freeze({ uc1: 397, uc2: 508, uc3: 273, uc4: 166 });
const LOOP_LEAD_S = 0.15;
const LOOP_LEAD_WITHOUT_FRAMES_S = 0.35;
const LIVE_CLASS = "is-live";
const FAILED_CLASS = "is-failed";
const NO_SOURCE = 3;
const BLOCKED = "NotAllowedError";
const INTERRUPTED = "AbortError";
const AV1_CODEC = "av01";
const FRAME_EVENTS = Object.freeze(["playing", "seeked", "timeupdate"]);
const WAKE_GESTURES = Object.freeze(["click", "keydown"]);
const PRELOAD_MARGIN = "100%";
const PRELOAD_ALL = "auto";

function playRequests(media) {
  let denied = false;
  const request = () => {
    const promise = media.play();
    if (promise && promise.catch) promise.catch(rejected);
  };
  function rejected(error) {
    const name = error ? error.name : "";
    if (name === INTERRUPTED) return;
    if (name === BLOCKED && !media.muted()) {
      media.mute();
      request();
      return;
    }
    denied = true;
  }
  return {
    request,
    denied: () => denied,
    retry: () => {
      denied = false;
    },
  };
}

function loopEnd(video, start) {
  const lead = video.requestVideoFrameCallback ? LOOP_LEAD_S : LOOP_LEAD_WITHOUT_FRAMES_S;
  const end = FIRST_DIMMED_FRAME[video.dataset.clip] / FRAMES_PER_S - lead;
  return end > start ? end : Infinity;
}

function frameWatch(video, onFrame) {
  let waiting = null;
  const stop = () => {
    if (waiting !== null) video.cancelVideoFrameCallback(waiting);
    waiting = null;
  };
  const watch = () => {
    if (!video.requestVideoFrameCallback) return;
    stop();
    waiting = video.requestVideoFrameCallback(() => {
      waiting = null;
      onFrame();
      watch();
    });
  };
  return { watch, stop };
}

function loopGuard(slot, media) {
  let mayJump = true;
  const check = () => {
    if (media.video.seeking || slot.classList.contains(FAILED_CLASS)) return;
    if (!media.outsideLoop()) {
      mayJump = true;
      return;
    }
    if (!mayJump) return;
    mayJump = false;
    media.seekToStart();
  };
  return {
    check,
    rearm: () => {
      mayJump = true;
    },
  };
}

function sceneMedia(slot) {
  const video = slot.querySelector("video[data-clip]");
  if (!video) return null;
  const start = parseFloat(video.dataset.start || "0");
  const end = loopEnd(video, start);
  const beforeStart = () => video.currentTime < start - START_TOLERANCE_S;
  const seekToStart = () => {
    try {
      video.currentTime = start;
    } catch {}
  };
  return {
    video,
    seekToStart,
    beforeStart,
    outsideLoop: () => (beforeStart() && !(start >= video.duration)) || video.currentTime >= end,
    showsFrame: () => video.readyState >= HAVE_CURRENT_DATA && !video.seeking,
    play: () => {
      reloadIfStale(video);
      return video.play();
    },
    muted: () => video.muted,
    mute: () => {
      video.muted = true;
    },
    hold: () => {
      video.dataset.held = "1";
      video.pause();
    },
    release: () => {
      delete video.dataset.held;
    },
    pausedByUser: () => Boolean(video.dataset.userPaused),
  };
}

function av1Fallback(video) {
  const isAv1 = (source) => (source.getAttribute("type") || "").includes(AV1_CODEC);
  const inUse = (source) => {
    const src = source.getAttribute("src");
    return Boolean(src) && video.currentSrc.endsWith(src);
  };
  const drop = (onlyInUse) => () => {
    const sources = Array.from(video.querySelectorAll("source"));
    const av1 = sources.filter(isAv1);
    if (!av1.length || av1.length === sources.length) return false;
    if (onlyInUse && !av1.some(inUse)) return false;
    for (const source of av1) source.remove();
    return true;
  };
  return { afterError: drop(true), beforeRetry: drop(false) };
}

function failureNotice(slot, video, { retry, fallback }) {
  const notice = slot.querySelector(".vfail");
  const show = (on) => {
    slot.classList.toggle(FAILED_CLASS, on);
    if (on) slot.classList.remove(LIVE_CLASS);
    if (notice) notice.hidden = !on;
  };
  for (const source of video.querySelectorAll("source")) {
    source.addEventListener("error", () => {
      const sources = video.querySelectorAll("source");
      const last = source === sources[sources.length - 1];
      if (last && video.networkState === NO_SOURCE && video.readyState === HAVE_NOTHING) show(true);
    });
  }
  video.addEventListener("error", () => {
    if (!fallback()) show(true);
  });
  video.addEventListener("emptied", () => show(false));
  const button = slot.querySelector(".vretry");
  if (!button) return;
  button.addEventListener("click", () => {
    show(false);
    retry();
  });
}

export function scenePlayback(slot) {
  const media = sceneMedia(slot);
  if (!media) return null;
  const { video } = media;
  const requests = playRequests(media);
  let played = false;
  const guard = loopGuard(slot, media);
  const frames = frameWatch(video, guard.check);
  const reveal = () => {
    if (slot.classList.contains(FAILED_CLASS)) return;
    if (media.showsFrame() && !media.beforeStart()) slot.classList.add(LIVE_CLASS);
  };
  video.addEventListener("playing", () => (played = true), { once: true });
  video.addEventListener("playing", () => {
    guard.check();
    frames.watch();
  });
  video.addEventListener("timeupdate", () => {
    guard.check();
    if (!video.paused) frames.watch();
  });
  video.addEventListener("pause", frames.stop);
  video.addEventListener("error", frames.stop);
  video.addEventListener("emptied", () => {
    slot.classList.remove(LIVE_CLASS);
    guard.rearm();
    frames.stop();
  });
  for (const type of FRAME_EVENTS) video.addEventListener(type, reveal);
  let wanted = false;
  const dropAv1 = av1Fallback(video);
  const reload = () => {
    if (!reloadIfStale(video)) video.load();
    requests.retry();
  };
  failureNotice(slot, video, {
    retry: () => {
      delete video.dataset.userPaused;
      media.release();
      wanted = true;
      dropAv1.beforeRetry();
      reload();
      requests.request();
    },
    fallback: () => {
      if (!dropAv1.afterError()) return false;
      reload();
      if (wanted && !media.pausedByUser()) requests.request();
      return true;
    },
  });
  return {
    video,
    pausedByUser: media.pausedByUser,
    retry: requests.retry,
    resume: requests.request,
    enter: () => {
      media.release();
      wanted = true;
      if (media.pausedByUser()) return;
      if (played) media.seekToStart();
      requests.request();
    },
    keep: () => {
      if (video.paused && !media.pausedByUser() && !requests.denied()) requests.request();
    },
    leave: () => {
      wanted = false;
      media.hold();
    },
  };
}

export function wakePlayback(doc, players, choose) {
  const wake = () => {
    for (const player of players) player.retry();
    choose();
  };
  doc.addEventListener("visibilitychange", () => {
    if (!doc.hidden) wake();
  });
  doc.defaultView.addEventListener("pageshow", wake);
  const onGesture = (event) => {
    if (!onOwnControl(event)) wake();
  };
  for (const type of WAKE_GESTURES) doc.addEventListener(type, onGesture, { capture: true, passive: true });
}

export function preloadNearView(videos, Observer = globalThis.IntersectionObserver) {
  const preloader = new Observer(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.preload = PRELOAD_ALL;
        reloadIfStale(entry.target);
        preloader.unobserve(entry.target);
      }
    },
    { rootMargin: PRELOAD_MARGIN },
  );
  for (const video of videos) {
    if (video.getAttribute("preload") !== PRELOAD_ALL) preloader.observe(video);
  }
}
