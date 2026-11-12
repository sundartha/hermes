const LABELS = Object.freeze({ en: "Sound", de: "Ton" });
const SCENE_NUMERAL = /^[IV]+ · /;
const GESTURES = Object.freeze(["click", "keydown"]);
const OWN_CONTROLS = ".vsound, .vpause";
const BLOCKED_WINDOW_MS = 250;

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

function hideCaptions(video) {
  for (const track of Array.from(video.textTracks || [])) track.mode = "disabled";
}

function sceneSound(doc, button) {
  const video = button.closest(".vslot")?.querySelector("video[data-clip]");
  if (!video) return null;
  const refresh = () => {
    const label = LABELS[pageLang(doc)];
    button.setAttribute("aria-pressed", String(!video.muted));
    button.setAttribute("aria-label", `${label}: ${sceneName(button)}`);
    const text = button.querySelector(".vsound-l");
    if (text) text.textContent = label;
    hideCaptions(video);
  };
  const set = (on) => {
    video.muted = !on;
    refresh();
  };
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

function centred(video, view) {
  const centre = rectCentre(video);
  return centre.left >= 0 && centre.left <= view.innerWidth && centre.top >= 0 && centre.top <= view.innerHeight;
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
  };
}

function guardAgainstBrowserBlock(scene, sound, view) {
  const { video } = scene;
  const keepPlayingQuietly = () => {
    if (video.dataset.userPaused || !centred(video, view)) return;
    sound.browserBlocked();
    scene.set(false);
    playQuietly(video);
  };
  video.addEventListener("pause", keepPlayingQuietly, { once: true });
  view.setTimeout(() => video.removeEventListener("pause", keepPlayingQuietly), BLOCKED_WINDOW_MS);
}

function makeAudible(scene, sound, view) {
  if (view) guardAgainstBrowserBlock(scene, sound, view);
  scene.set(true);
}

function wireScene(scene, context) {
  const { video } = scene;
  const { others, sound, view } = context;
  const silenceOthers = () => {
    for (const other of others()) if (other !== scene) other.set(false);
  };
  video.addEventListener("play", () => {
    silenceOthers();
    if (sound.allowsAutoSound() && !scene.audible()) makeAudible(scene, sound, view);
  });
  video.addEventListener("pause", () => {
    if (!video.dataset.userPaused) scene.set(false);
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
    if (video.paused) {
      delete video.dataset.userPaused;
      playQuietly(video);
    }
  };
}

const onOwnControl = (event) => Boolean(event.target && event.target.closest && event.target.closest(OWN_CONTROLS));

function leadScene(playing, view) {
  if (!view) return playing[0];
  return playing.reduce((best, scene) => (centreOffset(scene.video, view) < centreOffset(best.video, view) ? scene : best));
}

function wireFirstGesture(doc, scenes, sound) {
  const view = doc.defaultView;
  const onGesture = (event) => {
    if (onOwnControl(event)) return;
    sound.firstGesture();
    if (sound.optedOut()) return;
    const playing = scenes.filter((scene) => !scene.video.paused);
    if (!playing.length) return;
    const lead = leadScene(playing, view);
    for (const scene of playing) if (scene !== lead) scene.set(false);
    if (!lead.audible()) makeAudible(lead, sound, view);
  };
  for (const type of GESTURES) doc.addEventListener(type, onGesture, { capture: true, passive: true });
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
      video.load();
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
  for (const button of doc.querySelectorAll(".vsound")) {
    const scene = sceneSound(doc, button);
    if (!scene) continue;
    scenes.push(scene);
    button.addEventListener("click", wireScene(scene, { others: () => scenes, sound, view: doc.defaultView }));
    button.hidden = false;
  }
  wireFirstGesture(doc, scenes, sound);
  onLangChange(doc, scenes);
  return scenes;
}
