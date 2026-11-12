import { onOwnControl } from "./home-sound.js";

const HAVE_CURRENT_DATA = 2;
const START_TOLERANCE_S = 0.05;
const LIVE_CLASS = "is-live";
const FAILED_CLASS = "is-failed";
const NO_SOURCE = 3;
const BLOCKED = "NotAllowedError";
const INTERRUPTED = "AbortError";
const FRAME_EVENTS = Object.freeze(["playing", "seeked", "timeupdate"]);
const WAKE_GESTURES = Object.freeze(["click", "keydown"]);

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

function sceneMedia(slot) {
  const video = slot.querySelector("video[data-clip]");
  if (!video) return null;
  const start = parseFloat(video.dataset.start || "0");
  const seekToStart = () => {
    try {
      video.currentTime = start;
    } catch {}
  };
  return {
    video,
    seekToStart,
    beforeStart: () => video.currentTime < start - START_TOLERANCE_S,
    showsFrame: () => video.readyState >= HAVE_CURRENT_DATA && !video.seeking,
    play: () => video.play(),
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

function failureNotice(slot, video, retry) {
  const notice = slot.querySelector(".vfail");
  const show = (on) => {
    slot.classList.toggle(FAILED_CLASS, on);
    if (on) slot.classList.remove(LIVE_CLASS);
    if (notice) notice.hidden = !on;
  };
  for (const source of video.querySelectorAll("source")) {
    source.addEventListener("error", () => {
      if (video.networkState === NO_SOURCE) show(true);
    });
  }
  video.addEventListener("error", () => show(true));
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
  const skipIntro = () => {
    if (media.beforeStart()) media.seekToStart();
  };
  const reveal = () => {
    if (slot.classList.contains(FAILED_CLASS)) return;
    if (media.showsFrame() && !media.beforeStart()) slot.classList.add(LIVE_CLASS);
  };
  video.addEventListener("playing", () => (played = true), { once: true });
  video.addEventListener("playing", skipIntro);
  video.addEventListener("emptied", () => slot.classList.remove(LIVE_CLASS));
  for (const type of FRAME_EVENTS) video.addEventListener(type, reveal);
  failureNotice(slot, video, () => {
    delete video.dataset.userPaused;
    media.release();
    video.load();
    requests.retry();
    requests.request();
  });
  return {
    video,
    pausedByUser: media.pausedByUser,
    retry: requests.retry,
    resume: requests.request,
    enter: () => {
      media.release();
      if (media.pausedByUser()) return;
      if (played) media.seekToStart();
      requests.request();
    },
    keep: () => {
      if (video.paused && !media.pausedByUser() && !requests.denied()) requests.request();
    },
    leave: media.hold,
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
