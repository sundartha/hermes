const LABELS = Object.freeze({ en: "Sound", de: "Ton" });
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

function showCaptions(video, lang) {
  const tracks = Array.from(video.textTracks || []);
  const chosen = tracks.find((track) => track.language === lang) || tracks[0];
  for (const track of tracks) track.mode = !video.muted && track === chosen ? "showing" : "disabled";
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
    showCaptions(video, pageLang(doc));
  };
  const set = (on) => {
    video.muted = !on;
    refresh();
  };
  return { video, set, refresh, audible: () => !video.muted };
}

function wireScene(scene, others) {
  const { video } = scene;
  const silenceOthers = () => {
    for (const other of others()) if (other !== scene) other.set(false);
  };
  video.addEventListener("play", silenceOthers);
  video.addEventListener("pause", () => {
    if (!video.dataset.userPaused) scene.set(false);
  });
  return () => {
    if (scene.audible()) {
      scene.set(false);
      return;
    }
    silenceOthers();
    scene.set(true);
    if (video.paused) {
      delete video.dataset.userPaused;
      playQuietly(video);
    }
  };
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
      video.addEventListener("loadedmetadata", resume, { once: true });
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
  for (const button of doc.querySelectorAll(".vsound")) {
    const scene = sceneSound(doc, button);
    if (!scene) continue;
    scenes.push(scene);
    button.addEventListener("click", wireScene(scene, () => scenes));
    button.hidden = false;
  }
  onLangChange(doc, scenes);
  return scenes;
}
