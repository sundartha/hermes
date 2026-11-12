import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Window } from "happy-dom";
import { wireSound } from "../src/scripts/home-sound.js";
import { VOICE_SCRIPT } from "../src/lib/home-voice.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSETS = join(WEB_ROOT, "public/assets/home");
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home-sound.css"), "utf8");
const SPOKEN = Object.keys(VOICE_SCRIPT).filter((clip) => VOICE_SCRIPT[clip].en.length > 0);
const TIMING = /^\d\d:\d\d:\d\d\.\d{3} --> /;

function scene(clip) {
  const german = clip === "uc9" ? "" : '<track kind="subtitles" srclang="de">';
  return `<article class="scene"><div class="vslot">
    <span class="label">I · Scene ${clip}</span>
    <video data-clip="${clip}" muted><track kind="captions" srclang="en">${german}</video>
    <button type="button" class="vsound" aria-pressed="false" hidden><span class="vsound-l">Sound</span> <span class="vsound-s" aria-hidden="true">off</span><span class="vsound-n" aria-hidden="true" hidden>EN</span></button>
    <p class="vcap" aria-hidden="true" hidden></p>
    <button type="button" class="vcc" aria-pressed="false" hidden>CC</button>
  </div></article>`;
}

function fakeMedia(video) {
  const tracks = Array.from(video.querySelectorAll("track"), (element) => ({
    language: element.getAttribute("srclang"),
    mode: "disabled",
    activeCues: [],
    addEventListener(type, listener) {
      this.listener = listener;
    },
  }));
  const media = { muted: true, tracks };
  Object.defineProperties(video, {
    muted: {
      get: () => media.muted,
      set: (value) => {
        media.muted = value;
      },
    },
    paused: { get: () => true },
    textTracks: { get: () => media.tracks },
    play: { value: () => Promise.resolve() },
    load: { value: () => {} },
  });
  return media;
}

function page(lang, clips = ["uc1", "uc2"]) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.documentElement.lang = lang;
  document.body.innerHTML = clips.map(scene).join("");
  const media = Array.from(document.querySelectorAll("video"), fakeMedia);
  wireSound(document);
  const pick = (selector) => Array.from(document.querySelectorAll(selector));
  return { window, document, media, sound: pick(".vsound"), cc: pick(".vcc") };
}

const shown = (media) =>
  media.map((entry) =>
    entry.tracks.filter((track) => track.mode === "hidden").map((track) => track.language),
  );
const pressed = (buttons) => buttons.map((button) => button.getAttribute("aria-pressed"));
const timings = (file) =>
  readFileSync(join(ASSETS, file), "utf8")
    .split("\n")
    .filter((line) => TIMING.test(line));

test("Untertitel: beim Laden aus, Schalter sichtbar und benannt", () => {
  const { media, cc } = page("en");
  assert.deepEqual(shown(media), [[], []]);
  assert.deepEqual(pressed(cc), ["false", "false"]);
  assert.deepEqual(
    cc.map((button) => button.hidden),
    [false, false],
  );
  assert.equal(cc[0].getAttribute("aria-label"), "Captions: Scene uc1");
});

test("Untertitel: ein Klick gilt für alle Szenen, der zweite schaltet wieder aus, der Ton bleibt unberührt", () => {
  const { media, cc } = page("en");
  cc[0].click();
  assert.deepEqual(shown(media), [["en"], ["en"]]);
  assert.deepEqual(pressed(cc), ["true", "true"]);
  assert.deepEqual(
    media.map((entry) => entry.muted),
    [true, true],
  );
  cc[1].click();
  assert.deepEqual(shown(media), [[], []]);
  assert.deepEqual(pressed(cc), ["false", "false"]);
});

test("Untertitel: Ton ein- und ausschalten ändert die Wahl nicht", () => {
  const { media, sound, cc } = page("en");
  cc[0].click();
  sound[0].click();
  assert.deepEqual(shown(media), [["en"], ["en"]]);
  sound[0].click();
  assert.deepEqual(shown(media), [["en"], ["en"]]);
  cc[0].click();
  sound[1].click();
  assert.deepEqual(shown(media), [[], []]);
});

test("Untertitel: gezeigt wird die Spur der Seitensprache, auch nach Sprachwechsel", async () => {
  const { window, document, media, cc } = page("en");
  cc[0].click();
  document.documentElement.lang = "de";
  await window.happyDOM.waitUntilComplete();
  assert.deepEqual(shown(media), [["de"], ["de"]]);
  assert.equal(cc[1].getAttribute("aria-label"), "Untertitel: Scene uc2");
});

test("Untertitel: jede Szene mit Dialog hat eine deutsche Datei mit denselben Zeiten", () => {
  assert.deepEqual(SPOKEN, ["uc1", "uc2", "uc3"]);
  for (const clip of SPOKEN) {
    assert.ok(existsSync(join(ASSETS, `${clip}-de.vtt`)), `${clip}: deutsche Untertitel fehlen`);
    assert.deepEqual(
      timings(`${clip}-de.vtt`),
      timings(`${clip}-en.vtt`),
      `${clip}: Zeiten weichen ab`,
    );
    assert.equal(timings(`${clip}-de.vtt`).length, VOICE_SCRIPT[clip].en.length);
  }
});

test("Untertitel: Seite liefert Schalter und deutsche Spur, der Schalter steht in der Zeile unter dem Film", () => {
  assert.match(PAGE, /class="vcc"/);
  assert.match(PAGE, /kind="subtitles" srclang="de"/);
  const rule = CSS.match(/\.vslot \.vsound,\s*\.vslot \.vpause,\s*\.vslot \.vcc \{([^}]*)\}/);
  assert.ok(rule && rule[1].includes("top: calc(100%"), "Schalter liegt auf dem Film");
});

test("Untertitel: fehlt einer Szene die Spur der Seitensprache, ist ihr Schalter aus und gesperrt", async () => {
  const { window, document, media, cc } = page("en", ["uc1", "uc9"]);
  cc[0].click();
  assert.deepEqual(pressed(cc), ["true", "true"]);
  document.documentElement.lang = "de";
  await window.happyDOM.waitUntilComplete();
  assert.deepEqual(shown(media), [["de"], []]);
  assert.deepEqual(pressed(cc), ["true", "false"]);
  assert.deepEqual(
    cc.map((button) => button.disabled),
    [false, true],
  );
});

test("Untertitel: lädt eine Spur nicht, zeigt der Schalter dieser Szene nicht weiter aktiv", () => {
  const { window, document, media, cc } = page("en");
  cc[0].click();
  const broken = document.querySelector('video[data-clip="uc2"] track[srclang="en"]');
  broken.dispatchEvent(new window.Event("error"));
  assert.deepEqual(shown(media), [["en"], []]);
  assert.deepEqual(pressed(cc), ["true", "false"]);
  assert.equal(cc[1].disabled, true);
  assert.equal(cc[0].disabled, false);
});

test("Ton-Knopf: auf der deutschen Seite steht sichtbar, dass der Ton englisch ist", async () => {
  const { window, document, sound } = page("de");
  const note = sound[0].querySelector(".vsound-n");
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, "EN");
  assert.equal(sound[0].getAttribute("title"), "Ton auf Englisch");
  document.documentElement.lang = "en";
  await window.happyDOM.waitUntilComplete();
  assert.equal(note.hidden, true);
  assert.equal(sound[0].hasAttribute("title"), false);
});

test("Untertitel: der gesprochene Satz steht vollständig als Textzeile im Film, nicht in der Browser-Darstellung", () => {
  const { document, media, cc } = page("de");
  const line = document.querySelector(".vcap");
  const german = media[0].tracks.find((track) => track.language === "de");
  const LONG = "Kannst du ihr sagen, dass der Vertrag fertig ist? Sie kann mich nach 16 Uhr zurückrufen.";
  const spoken = { text: `<v Anna>${LONG}`, getCueAsHTML: () => ({ textContent: LONG }) };
  cc[0].click();
  assert.equal(line.hidden, true, "ohne laufenden Satz bleibt die Zeile weg");
  german.activeCues = [spoken];
  german.listener();
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, LONG);
  assert.deepEqual(
    media[0].tracks.map((track) => track.mode),
    ["disabled", "hidden"],
  );
  german.activeCues = [];
  german.listener();
  assert.equal(line.hidden, true);
  german.activeCues = [spoken];
  german.listener();
  cc[0].click();
  assert.equal(line.hidden, true, "ausgeschaltet verschwindet die Zeile");
});
