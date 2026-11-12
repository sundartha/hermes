const LABELS = Object.freeze({ en: "Sound", de: "Ton" });
const SCENE_NUMERAL = /^[IV]+ · /;
// Browser erlauben Ton erst nach einer Nutzergeste. Ab dem ersten Tipp, Klick oder Tastendruck laufen
// die Szenen deshalb mit Ton, bis jemand ihn ueber den Ton-Knopf ausschaltet. Wischen zaehlt fuer iOS
// nicht als Geste (lautschalten wuerde das Video anhalten), daher nur click und keydown.
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

// Die Startseite zeigt die Clips ohne eingeblendete Untertitel (Entscheidung Owner, 2026-11-12);
// die Spuren bleiben im Markup, werden aber nie eingeblendet.
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

function centreOffset(video, view) {
  const rect = video.getBoundingClientRect();
  return Math.hypot((rect.left + rect.right) / 2 - view.innerWidth / 2, (rect.top + rect.bottom) / 2 - view.innerHeight / 2);
}

function centred(video, view) {
  const rect = video.getBoundingClientRect();
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  return x >= 0 && x <= view.innerWidth && y >= 0 && y <= view.innerHeight;
}

// Laut schalten; haelt der Browser das Video unmittelbar danach an (Ton nicht erlaubt), stumm
// weiterspielen und bis zur naechsten Geste nicht erneut versuchen. iOS pausiert sofort beim
// Lautschalten, deshalb haengt der Waechter davor und gilt nur kurz; eine spaetere Pause durch
// das Wegscrollen bleibt eine Pause.
function makeAudible(scene, sound, view) {
  const { video } = scene;
  if (!view) {
    scene.set(true);
    return;
  }
  const onBlocked = () => {
    if (video.dataset.userPaused || !centred(video, view)) return;
    sound.blocked = true;
    scene.set(false);
    playQuietly(video);
  };
  video.addEventListener("pause", onBlocked, { once: true });
  view.setTimeout(() => video.removeEventListener("pause", onBlocked), BLOCKED_WINDOW_MS);
  scene.set(true);
}

function wireScene(scene, others, sound, view) {
  const { video } = scene;
  const silenceOthers = () => {
    for (const other of others()) if (other !== scene) other.set(false);
  };
  video.addEventListener("play", () => {
    silenceOthers();
    if (sound.wanted && !sound.blocked && !scene.audible()) makeAudible(scene, sound, view);
  });
  video.addEventListener("pause", () => {
    if (!video.dataset.userPaused) scene.set(false);
  });
  return () => {
    if (scene.audible()) {
      sound.wanted = false;
      scene.set(false);
      return;
    }
    sound.wanted = true;
    silenceOthers();
    scene.set(true);
    if (video.paused) {
      delete video.dataset.userPaused;
      playQuietly(video);
    }
  };
}

function wireFirstGesture(doc, scenes, sound) {
  const view = doc.defaultView;
  const onGesture = (event) => {
    if (event.target && event.target.closest && event.target.closest(OWN_CONTROLS)) return;
    if (sound.wanted === null) sound.wanted = true;
    if (!sound.wanted) return;
    sound.blocked = false;
    const playing = scenes.filter((scene) => !scene.video.paused);
    if (!playing.length) return;
    const lead = view
      ? playing.reduce((best, scene) => (centreOffset(scene.video, view) < centreOffset(best.video, view) ? scene : best))
      : playing[0];
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
      // Nie gespielte Videos nicht anspringen: ein Sprung vor dem ersten Bild loescht das Poster.
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
  // wanted: null = noch keine Geste, true = Ton erwuenscht, false = per Knopf ausgeschaltet.
  const sound = { wanted: null, blocked: false };
  for (const button of doc.querySelectorAll(".vsound")) {
    const scene = sceneSound(doc, button);
    if (!scene) continue;
    scenes.push(scene);
    button.addEventListener("click", wireScene(scene, () => scenes, sound, doc.defaultView));
    button.hidden = false;
  }
  wireFirstGesture(doc, scenes, sound);
  onLangChange(doc, scenes);
  return scenes;
}
