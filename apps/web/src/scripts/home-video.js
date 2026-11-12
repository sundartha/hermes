const HAVE_CURRENT_DATA = 2;
const START_TOLERANCE_S = 0.05;
const LIVE_CLASS = "is-live";
const BLOCKED = "NotAllowedError";
const INTERRUPTED = "AbortError";
const FRAME_EVENTS = Object.freeze(["playing", "seeked", "timeupdate"]);
const INTRO_EVENTS = Object.freeze(["playing", "seeking"]);

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
    if (media.showsFrame() && !media.beforeStart()) slot.classList.add(LIVE_CLASS);
  };
  video.addEventListener("playing", () => (played = true), { once: true });
  for (const type of INTRO_EVENTS) video.addEventListener(type, skipIntro);
  for (const type of FRAME_EVENTS) video.addEventListener(type, reveal);
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
