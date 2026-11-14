import { reloadIfStale } from "./home-codec.js";

const LABELS = Object.freeze({ en: "Sound", de: "Ton" });
const STATES = Object.freeze({ en: Object.freeze(["off", "on"]), de: Object.freeze(["aus", "an"]) });
const SCENE_NUMERAL = /^[IV]+ · /;
const GESTURES = Object.freeze(["click", "keydown"]);
const CAPTION_LABELS = Object.freeze({ en: "Captions", de: "Untertitel" });
const CAPTION_MISSING = Object.freeze({ en: "Captions unavailable", de: "Untertitel nicht verfügbar" });
const CAPTION_FAILED = Object.freeze({ en: "Captions failed to load. Try again.", de: "Untertitel nicht geladen. Erneut versuchen." });
const AUDIO_NOTE = Object.freeze({ de: "Ton auf Englisch" });
const CAPTIONS_ON = "hidden";
const OWN_CONTROLS = ".vsound, .vpause, .vcc, .vretry";

const pageLang = (doc) => (doc.documentElement.lang === "de" ? "de" : "en");
const playQuietly = (media) => {
  reloadIfStale(media);
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

function captionPreference() {
  let wanted = false;
  return {
    wanted: () => wanted,
    toggle: () => {
      wanted = !wanted;
    },
    turnOn: () => {
      wanted = true;
    },
  };
}

const failedTrack = (video, lang) => video.querySelector(`track[srclang="${lang}"][data-failed]`);

function captionState(video, lang, wanted) {
  const exists = Boolean(video) && Array.from(video.textTracks || []).some((track) => track.language === lang);
  const failed = exists && Boolean(failedTrack(video, lang));
  const hint = failed ? CAPTION_FAILED[lang] : "";
  return { exists, on: exists && !failed && wanted, hint: exists ? hint : CAPTION_MISSING[lang] };
}

function retryTracks(video) {
  for (const track of video.querySelectorAll("track[data-failed]")) {
    const address = track.dataset.address || track.getAttribute("src");
    const attempt = Number(track.dataset.attempt || "0") + 1;
    delete track.dataset.failed;
    track.dataset.address = address;
    track.dataset.attempt = String(attempt);
    if (track.track) track.track.mode = CAPTIONS_ON;
    track.setAttribute("src", `${address}?retry=${attempt}`);
  }
}

function showCaptions(video, lang, on) {
  for (const track of Array.from(video.textTracks || [])) {
    track.mode = on && track.language === lang ? CAPTIONS_ON : "disabled";
  }
}

const spokenText = (cue) => (cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text);

function renderCaption(video) {
  const line = video.closest(".vslot")?.querySelector(".vcap");
  if (!line) return;
  const active = Array.from(video.textTracks || []).find((track) => track.mode === CAPTIONS_ON);
  const cues = active ? Array.from(active.activeCues || []) : [];
  const text = cues.map(spokenText).join(" ");
  line.textContent = text;
  line.hidden = !text;
}

function setOrRemove(element, name, value) {
  if (value) element.setAttribute(name, value);
  else element.removeAttribute(name);
}

function refreshCaptionSwitch(button, lang, wanted) {
  const video = button.closest(".vslot")?.querySelector("video[data-clip]");
  const toggle = button.closest(".vslot")?.querySelector(".vcc");
  const state = captionState(video, lang, wanted);
  if (video) {
    showCaptions(video, lang, state.on);
    renderCaption(video);
  }
  if (!toggle) return;
  toggle.disabled = !state.exists;
  toggle.setAttribute("aria-pressed", String(state.on));
  toggle.setAttribute("aria-label", `${CAPTION_LABELS[lang]}: ${sceneName(button)}`);
  setOrRemove(toggle, "title", state.hint);
}

function refreshAudioNote(button, lang) {
  const note = button.querySelector(".vsound-n");
  if (note) note.hidden = !AUDIO_NOTE[lang];
  setOrRemove(button, "title", AUDIO_NOTE[lang]);
}

function watchTracks(scene) {
  for (const track of scene.video.querySelectorAll("track")) {
    track.addEventListener("error", () => {
      track.dataset.failed = "1";
      scene.refresh();
    });
  }
  for (const track of Array.from(scene.video.textTracks || [])) {
    if (track.addEventListener) track.addEventListener("cuechange", () => renderCaption(scene.video));
  }
  scene.video.addEventListener("emptied", () => {
    retryTracks(scene.video);
    scene.refresh();
  });
}

function sceneSound(doc, button, captions) {
  const video = button.closest(".vslot")?.querySelector("video[data-clip]");
  if (!video) return null;
  const refresh = () => {
    const lang = pageLang(doc);
    const label = LABELS[lang];
    button.setAttribute("aria-pressed", String(!video.muted));
    button.setAttribute("aria-label", `${label}: ${sceneName(button)}`);
    const text = button.querySelector(".vsound-l");
    if (text) text.textContent = label;
    const state = button.querySelector(".vsound-s");
    if (state) state.textContent = STATES[lang][Number(!video.muted)];
    refreshCaptionSwitch(button, lang, captions.wanted());
    refreshAudioNote(button, lang);
  };
  const set = (on) => {
    video.muted = !on;
    refresh();
  };
  video.addEventListener("volumechange", refresh);
  return { video, set, refresh, audible: () => !video.muted };
}

const HALF = 2;

function rectCentre(video) {
  const rect = video.getBoundingClientRect();
  return { left: (rect.left + rect.right) / HALF, top: (rect.top + rect.bottom) / HALF };
}

function centreOffset(video, view) {
  const centre = rectCentre(video);
  return Math.hypot(centre.left - view.innerWidth / HALF, centre.top - view.innerHeight / HALF);
}

function soundPreference() {
  let wanted = null;
  let blocked = false;
  return {
    allowsAutoSound: () => wanted === true && !blocked,
    optedOut: () => wanted === false,
    turnOn: () => {
      wanted = true;
      blocked = false;
    },
    turnOff: () => {
      wanted = false;
    },
    firstGesture: () => {
      if (wanted === null) wanted = true;
      blocked = false;
    },
    browserBlocked: () => {
      blocked = true;
    },
    retry: () => {
      blocked = false;
    },
  };
}

function unlockForLaterSound(scenes, keep) {
  for (const scene of scenes) {
    if (scene === keep || scene.audible()) continue;
    scene.video.muted = false;
    scene.video.muted = true;
  }
}

function pausedByBrowser(scene, doc) {
  const { video } = scene;
  return scene.audible() && !video.dataset.held && !doc.hidden;
}

function wireScene(scene, context) {
  const { video } = scene;
  const { doc, others, sound } = context;
  const silenceOthers = () => {
    for (const other of others()) if (other !== scene) other.set(false);
  };
  video.addEventListener("play", () => {
    silenceOthers();
    if (sound.allowsAutoSound() && !scene.audible()) scene.set(true);
  });
  video.addEventListener("pause", () => {
    if (video.dataset.userPaused) return;
    const blocked = pausedByBrowser(scene, doc);
    scene.set(false);
    if (!blocked) return;
    sound.browserBlocked();
    playQuietly(video);
  });
  return () => {
    if (scene.audible()) {
      sound.turnOff();
      scene.set(false);
      return;
    }
    sound.turnOn();
    silenceOthers();
    scene.set(true);
    unlockForLaterSound(others(), scene);
    if (video.paused) {
      delete video.dataset.userPaused;
      delete video.dataset.held;
      playQuietly(video);
    }
  };
}

export const onOwnControl = (event) => Boolean(event.target && event.target.closest && event.target.closest(OWN_CONTROLS));

function leadScene(playing, view) {
  if (!view) return playing[0];
  return playing.reduce((best, scene) => (centreOffset(scene.video, view) < centreOffset(best.video, view) ? scene : best));
}

function soundToLead(scenes, view) {
  const playing = scenes.filter((scene) => !scene.video.paused);
  const lead = playing.length ? leadScene(playing, view) : null;
  for (const scene of playing) if (scene !== lead) scene.set(false);
  return lead;
}

function wireFirstGesture(doc, scenes, sound) {
  const view = doc.defaultView;
  const onGesture = (event) => {
    if (onOwnControl(event)) return;
    sound.firstGesture();
    if (sound.optedOut()) return;
    const lead = soundToLead(scenes, view);
    unlockForLaterSound(scenes, lead);
    if (lead && !lead.audible()) lead.set(true);
  };
  for (const type of GESTURES) doc.addEventListener(type, onGesture, { capture: true, passive: true });
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) return;
    sound.retry();
    if (!sound.allowsAutoSound()) return;
    const lead = soundToLead(scenes, view);
    if (lead && !lead.audible()) lead.set(true);
  });
}

function onLangChange(doc, scenes) {
  const apply = () => {
    const lang = pageLang(doc);
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
      if (playing || time > 0) video.addEventListener("loadedmetadata", resume, { once: true });
      if (!reloadIfStale(video)) video.load();
    }
    for (const scene of scenes) scene.refresh();
  };
  const Observer = doc.defaultView ? doc.defaultView.MutationObserver : undefined;
  if (Observer) {
    new Observer(apply).observe(doc.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  apply();
}

export function wireSound(doc = document) {
  const scenes = [];
  const sound = soundPreference();
  const captions = captionPreference();
  for (const button of doc.querySelectorAll(".vsound")) {
    const scene = sceneSound(doc, button, captions);
    if (!scene) continue;
    scenes.push(scene);
    watchTracks(scene);
    button.addEventListener("click", wireScene(scene, { doc, others: () => scenes, sound }));
    button.hidden = false;
  }
  for (const toggle of doc.querySelectorAll(".vcc")) {
    toggle.addEventListener("click", () => {
      const video = toggle.closest(".vslot")?.querySelector("video[data-clip]");
      if (video && failedTrack(video, pageLang(doc))) {
        retryTracks(video);
        captions.turnOn();
      } else {
        captions.toggle();
      }
      for (const scene of scenes) scene.refresh();
    });
    toggle.hidden = false;
  }
  wireFirstGesture(doc, scenes, sound);
  onLangChange(doc, scenes);
  return scenes;
}
