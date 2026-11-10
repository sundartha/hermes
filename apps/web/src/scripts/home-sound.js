const LABELS = Object.freeze({ en: "Sound", de: "Ton" });
const DRIFT_S = 0.25;
const SCENE_NUMERAL = /^[IV]+ · /;

const pageLang = (doc) => (doc.documentElement.lang === "de" ? "de" : "en");
const playQuietly = (media) => {
  const promise = media.play();
  if (promise && promise.catch) promise.catch(() => {});
};

function swapSources(video, lang) {
  let changed = false;
  for (const source of video.querySelectorAll("source[data-src-de]")) {
    if (!source.dataset.srcEn) source.dataset.srcEn = source.getAttribute("src");
    const next = lang === "de" ? source.dataset.srcDe : source.dataset.srcEn;
    if (source.getAttribute("src") !== next) {
      source.setAttribute("src", next);
      changed = true;
    }
  }
  return changed;
}

function sceneName(button) {
  const label = button.closest(".scene")?.querySelector(".label");
  return label ? label.textContent.replace(SCENE_NUMERAL, "") : "";
}

function soundState(doc, createAudio) {
  const audio = createAudio();
  audio.preload = "none";
  const state = { on: false, video: null, button: null };
  const lang = () => pageLang(doc);
  const showCaptions = (video, show) => {
    const tracks = Array.from(video.textTracks || []);
    const chosen = tracks.find((track) => track.language === lang()) || tracks[0];
    for (const track of tracks) track.mode = show && track === chosen ? "showing" : "disabled";
  };
  const sync = (force) => {
    if (!state.on || !state.video) return;
    if (state.video.paused) {
      audio.pause();
      return;
    }
    if (force || Math.abs(audio.currentTime - state.video.currentTime) > DRIFT_S) {
      try {
        audio.currentTime = state.video.currentTime;
      } catch {}
    }
    if (audio.paused) playQuietly(audio);
  };
  const attach = (video, button) => {
    if (state.video && state.video !== video) showCaptions(state.video, false);
    state.video = video;
    state.button = button;
    const url = button.dataset.voice;
    if (audio.dataset.voice !== url) {
      audio.dataset.voice = url;
      audio.src = url;
    }
    showCaptions(video, state.on);
  };
  const seek = (time) => {
    try {
      audio.currentTime = time;
    } catch {}
  };
  const start = (video, button) => {
    state.on = true;
    attach(video, button);
    seek(video.currentTime);
    playQuietly(audio);
  };
  const stop = () => {
    state.on = false;
    audio.pause();
    if (state.video) showCaptions(state.video, false);
  };
  return { state, lang, sync, attach, start, stop, pause: () => audio.pause() };
}

function refreshButtons(sound, buttons) {
  const label = LABELS[sound.lang()];
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(sound.state.on));
    button.setAttribute("aria-label", `${label}: ${sceneName(button)}`);
    const text = button.querySelector(".vsound-l");
    if (text) text.textContent = label;
  }
}

function wireScene(sound, button, refresh) {
  const video = button.closest(".vslot")?.querySelector("video[data-clip]");
  if (!video) return;
  const mine = () => sound.state.video === video;
  const toggle = () => {
    if (sound.state.on) {
      sound.stop();
      return;
    }
    sound.start(video, button);
    if (video.paused) {
      delete video.dataset.userPaused;
      playQuietly(video);
    }
  };
  video.addEventListener("play", () => {
    if (!sound.state.on) return;
    sound.attach(video, button);
    sound.sync(true);
  });
  for (const type of ["pause", "waiting", "emptied"]) {
    video.addEventListener(type, () => {
      if (mine()) sound.pause();
    });
  }
  for (const type of ["seeked", "timeupdate", "playing"]) {
    video.addEventListener(type, () => {
      if (mine()) sound.sync(type === "seeked");
    });
  }
  button.addEventListener("click", () => {
    toggle();
    refresh();
  });
}

function onLangChange(doc, sound, refresh) {
  const apply = () => {
    const lang = sound.lang();
    for (const video of doc.querySelectorAll("video[data-clip]")) {
      if (!swapSources(video, lang)) continue;
      const time = video.currentTime;
      const playing = !video.paused;
      const resume = () => {
        try {
          video.currentTime = time;
        } catch {}
        if (playing) playQuietly(video);
      };
      video.addEventListener("loadedmetadata", resume, { once: true });
      video.load();
    }
    const { state } = sound;
    if (state.video && state.button) {
      sound.attach(state.video, state.button);
      sound.sync(true);
    }
    refresh();
  };
  const Observer = doc.defaultView ? doc.defaultView.MutationObserver : undefined;
  if (Observer) {
    new Observer(apply).observe(doc.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  apply();
}

export function wireSound(doc = document, createAudio = () => new Audio()) {
  const buttons = Array.from(doc.querySelectorAll(".vsound"));
  const sound = buttons.length ? soundState(doc, createAudio) : null;
  const refresh = () => sound && refreshButtons(sound, buttons);
  for (const button of buttons) {
    wireScene(sound, button, refresh);
    button.hidden = false;
  }
  onLangChange(doc, sound || { lang: () => pageLang(doc), state: {} }, refresh);
  return sound;
}
