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
