import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Window } from "happy-dom";
import { scenePlayback } from "../src/scripts/home-video.js";
import { onOwnControl, wireSound } from "../src/scripts/home-sound.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");
const NO_SOURCE = 3;
const LOADING = 2;

function scene(clip) {
  return `<article class="scene"><div class="vslot">
    <span class="label">I · Scene ${clip}</span>
    <video data-clip="${clip}" muted><source src="/a/${clip}.av1.mp4"><source src="/a/${clip}.mp4"><track kind="captions" srclang="en" src="/a/${clip}-en.vtt"></video>
    <div class="vfail" role="status" hidden><span>Video didn't load.</span> <button type="button" class="vretry">Try again</button></div>
    <button type="button" class="vsound" aria-pressed="false" hidden><span class="vsound-l">Sound</span></button>
    <button type="button" class="vcc" aria-pressed="false" hidden>CC</button>
  </div></article>`;
}

function fakeMedia(video) {
  const media = { muted: true, paused: true, networkState: LOADING, loads: 0, plays: 0 };
  const tracks = Array.from(video.querySelectorAll("track"), (element) => ({
    language: element.getAttribute("srclang"),
    mode: "disabled",
    activeCues: [],
  }));
  Object.defineProperties(video, {
    muted: {
      get: () => media.muted,
      set: (value) => {
        media.muted = value;
      },
    },
    paused: { get: () => media.paused },
    networkState: { get: () => media.networkState },
    textTracks: { get: () => tracks },
    play: {
      value: () => {
        media.plays += 1;
        return Promise.resolve();
      },
    },
    load: {
      value: () => {
        media.loads += 1;
        media.networkState = LOADING;
        video.dispatchEvent(new video.ownerDocument.defaultView.Event("emptied"));
      },
    },
  });
  return { media, tracks };
}

function page(clips = ["uc1", "uc2"]) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.documentElement.lang = "en";
  document.body.innerHTML = clips.map(scene).join("");
  const slots = Array.from(document.querySelectorAll(".vslot"));
  const fakes = slots.map((slot) => fakeMedia(slot.querySelector("video")));
  for (const slot of slots) scenePlayback(slot);
  wireSound(document);
  const fire = (target, type) => target.dispatchEvent(new window.Event(type));
  const failAllSources = (index) => {
    fakes[index].media.networkState = NO_SOURCE;
    const sources = slots[index].querySelectorAll("source");
    fire(sources[sources.length - 1], "error");
  };
  return { document, slots, fakes, fire, failAllSources };
}

const failed = (slots) => slots.map((slot) => !slot.querySelector(".vfail").hidden);

const SOUND_CSS = readFileSync(join(WEB_ROOT, "src/styles/home-sound.css"), "utf8");
const HAVE_ENOUGH_DATA = 4;
const FRAME_EVENTS = ["playing", "seeked", "timeupdate"];

function playingScene() {
  const { slots, fire } = page();
  const [slot] = slots;
  const video = slot.querySelector("video");
  Object.defineProperty(video, "readyState", { get: () => HAVE_ENOUGH_DATA });
  fire(video, "playing");
  return { slot, video, fire };
}

test("Szenen-Film: lädt er nur langsam, steht das Poster ohne Fehlerzeile", () => {
  const { slots, fire } = page();
  const first = slots[0].querySelector("source");
  fire(first, "error");
  fire(slots[0].querySelector("video"), "stalled");
  assert.deepEqual(failed(slots), [false, false]);
});

test("Szenen-Film: lädt keine Quelle, erscheint die Fehlerzeile nur in dieser Szene", () => {
  const { slots, failAllSources } = page();
  failAllSources(1);
  assert.deepEqual(failed(slots), [false, true]);
  assert.ok(slots[1].classList.contains("is-failed"));
});

test("Szenen-Film: meldet das Video selbst einen Fehler, erscheint die Fehlerzeile", () => {
  const { slots, fire } = page();
  fire(slots[0].querySelector("video"), "error");
  assert.deepEqual(failed(slots), [true, false]);
});

test("Szenen-Film: Erneut versuchen blendet die Zeile aus, lädt neu und startet", () => {
  const { slots, fakes, failAllSources } = page();
  failAllSources(0);
  slots[0].querySelector(".vretry").click();
  assert.deepEqual(failed(slots), [false, false]);
  assert.equal(slots[0].classList.contains("is-failed"), false);
  assert.equal(fakes[0].media.loads, 1);
  assert.equal(fakes[0].media.plays, 1);
  failAllSources(0);
  assert.deepEqual(failed(slots), [true, false], "ein erneuter Fehler zeigt die Zeile wieder");
});

test("Untertitel: nach einem Ladefehler bleibt der Schalter bedienbar und der nächste Klick lädt die Datei neu", () => {
  const { slots, fakes, fire } = page();
  const toggle = slots[0].querySelector(".vcc");
  const track = slots[0].querySelector("track");
  toggle.click();
  fire(track, "error");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute("title"), "Captions failed to load. Try again.");
  toggle.click();
  assert.equal(track.hasAttribute("data-failed"), false);
  assert.equal(track.getAttribute("src"), "/a/uc1-en.vtt?retry=1", "gleiche Adresse lädt der Browser nicht erneut");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  const [english] = fakes[0].tracks;
  assert.equal(english.mode, "hidden");
  assert.equal(slots[1].querySelector(".vcc").getAttribute("aria-pressed"), "true");
});

test("Untertitel: lädt der Film neu, sind die Fehlermarken seiner Spuren zurückgesetzt", () => {
  const { slots, fire } = page();
  const track = slots[0].querySelector("track");
  slots[0].querySelector(".vcc").click();
  fire(track, "error");
  assert.equal(track.hasAttribute("data-failed"), true);
  slots[0].querySelector("video").load();
  assert.equal(track.hasAttribute("data-failed"), false);
  assert.equal(slots[0].querySelector(".vcc").getAttribute("aria-pressed"), "true");
});

test("Szenen-Film: Seite liefert Fehlerzeile als Statusbereich mit deutschem Text", () => {
  assert.match(PAGE, /class="vfail" role="status"/);
  assert.match(PAGE, /class="vretry"/);
  assert.equal(HOME_GERMAN.videoFail, "Das Video konnte nicht geladen werden.");
  assert.equal(HOME_GERMAN.videoRetry, "Erneut versuchen");
});

test("Erneut versuchen ist ein eigenes Bedienelement: der Klick schaltet keinen Ton frei", () => {
  const { slots, fakes, failAllSources } = page();
  fakes[1].media.paused = false;
  failAllSources(0);
  const button = slots[0].querySelector(".vretry");
  assert.equal(onOwnControl({ target: button }), true);
  button.click();
  assert.deepEqual(
    fakes.map((fake) => fake.media.muted),
    [true, true],
    "Retry darf nicht als erste Geste den Ton einschalten",
  );
  assert.equal(fakes[0].media.plays, 1, "genau ein Startversuch");
});

test("Erneut versuchen gilt als Abspielwunsch: eine frühere Pause und das Anhalten durch die Seite sind aufgehoben", () => {
  const { slots, fakes, failAllSources } = page();
  const video = slots[0].querySelector("video");
  video.dataset.userPaused = "1";
  video.dataset.held = "1";
  failAllSources(0);
  slots[0].querySelector(".vretry").click();
  assert.equal("userPaused" in video.dataset, false);
  assert.equal("held" in video.dataset, false);
  assert.equal(fakes[0].media.plays, 1);
});

test("Szenen-Film: bricht er beim Abspielen ab, steht das Poster wieder und die Fehlerzeile ist sichtbar", () => {
  const { slot, video, fire } = playingScene();
  assert.ok(slot.classList.contains("is-live"), "Ausgangslage: Film läuft, Poster ausgeblendet");
  fire(video, "error");
  assert.equal(slot.classList.contains("is-live"), false, "Poster bleibt ausgeblendet");
  assert.ok(slot.classList.contains("is-failed"));
  assert.equal(slot.querySelector(".vfail").hidden, false);
});

test("Szenen-Film: Bild-Ereignisse nach dem Fehler blenden das Poster nicht wieder aus", () => {
  const { slot, video, fire } = playingScene();
  fire(video, "error");
  for (const type of FRAME_EVENTS) {
    fire(video, type);
    assert.equal(slot.classList.contains("is-live"), false, `${type} nach dem Fehler blendet das Poster aus`);
  }
  assert.equal(slot.querySelector(".vfail").hidden, false);
});

test("Szenen-Film: nach Erneut versuchen blendet erst ein neues Bild das Poster wieder aus", () => {
  const { slot, video, fire } = playingScene();
  fire(video, "error");
  slot.querySelector(".vretry").click();
  assert.equal(slot.classList.contains("is-failed"), false);
  assert.equal(slot.classList.contains("is-live"), false, "bis zum ersten neuen Bild steht das Poster");
  fire(video, "playing");
  assert.ok(slot.classList.contains("is-live"));
});

test("Szenen-Film: im Fehlerzustand hält auch das Stylesheet das Poster sichtbar", () => {
  const rule = /\.vslot\.is-live\.is-failed \.vposter\s*\{([^}]*)\}/.exec(SOUND_CSS);
  assert.ok(rule, "Regel .vslot.is-live.is-failed .vposter fehlt");
  assert.match(rule[1], /opacity:\s*1\b/);
  assert.match(rule[1], /visibility:\s*visible\b/);
});

test("Szenen-Film: meldet eine frühere Quelle ihren Fehler erst, während das Video neu lädt, erscheint keine Fehlerzeile", () => {
  const { slots, fakes, fire } = page();
  fakes[0].media.networkState = NO_SOURCE;
  fire(slots[0].querySelector("source"), "error");
  assert.deepEqual(failed(slots), [false, false]);
});

test("Szenen-Film: Stocken, Warten, Pause beim Laden oder Abbruch (langsames Mobilnetz, Datensparmodus) zeigen keine Fehlerzeile", () => {
  const { slots, fakes, fire } = page();
  const video = slots[0].querySelector("video");
  fakes[0].media.networkState = NO_SOURCE;
  for (const type of ["stalled", "waiting", "suspend", "abort", "emptied"]) fire(video, type);
  assert.deepEqual(failed(slots), [false, false]);
});

test("Szenen-Film: eine entfernte Quelle meldet ihren Fehler nach – keine Fehlerzeile", () => {
  const { slots, fakes, fire } = page();
  const sources = slots[0].querySelectorAll("source");
  const removed = sources[sources.length - 1];
  removed.remove();
  fakes[0].media.networkState = NO_SOURCE;
  fire(removed, "error");
  assert.deepEqual(failed(slots), [false, false]);
});

test("Szenen-Film: meldet die letzte Quelle einen Fehler, obwohl schon Bild da ist, erscheint keine Fehlerzeile", () => {
  const { slots, fakes, fire } = page();
  const video = slots[0].querySelector("video");
  Object.defineProperty(video, "readyState", { get: () => HAVE_ENOUGH_DATA });
  fakes[0].media.networkState = NO_SOURCE;
  const sources = video.querySelectorAll("source");
  fire(sources[sources.length - 1], "error");
  assert.deepEqual(failed(slots), [false, false]);
});

test("Szenen-Film: Erneut versuchen startet nur diesen Film neu und nimmt dafür H.264 statt AV1", () => {
  const { slots, fakes, failAllSources } = page();
  slots[0].querySelector("source").setAttribute("type", 'video/mp4; codecs="av01.0.05M.08"');
  failAllSources(0);
  slots[0].querySelector(".vretry").click();
  assert.deepEqual(
    Array.from(slots[0].querySelectorAll("source"), (source) => source.getAttribute("src")),
    ["/a/uc1.mp4"],
  );
  assert.equal(fakes[0].media.loads, 1, "genau ein Neuladen");
  assert.equal(fakes[1].media.loads, 0, "die anderen Filme laden nicht mit");
  assert.equal(fakes[0].media.plays, 1);
});

test("Szenen-Film: Erneut versuchen lädt einen markierten Film genau einmal neu und räumt die Markierung ab", () => {
  const { slots, fakes, failAllSources } = page();
  const video = slots[0].querySelector("video");
  video.setAttribute("data-sources-changed", "");
  failAllSources(0);
  slots[0].querySelector(".vretry").click();
  assert.equal(fakes[0].media.loads, 1);
  assert.equal(video.hasAttribute("data-sources-changed"), false);
  assert.equal(fakes[0].media.plays, 1);
});

test("Ton: startet der Ton-Knopf einen markierten Film, lädt er ihn vorher genau einmal neu", () => {
  const { slots, fakes } = page();
  const video = slots[0].querySelector("video");
  video.setAttribute("data-sources-changed", "");
  slots[0].querySelector(".vsound").click();
  assert.equal(fakes[0].media.loads, 1);
  assert.equal(video.hasAttribute("data-sources-changed"), false);
  assert.ok(fakes[0].media.plays >= 1, "Film startet");
  slots[0].querySelector(".vsound").click();
  slots[0].querySelector(".vsound").click();
  assert.equal(fakes[0].media.loads, 1, "kein zweites Neuladen");
});
