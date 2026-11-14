import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { reloadIfStale, useDirectSources } from "../src/scripts/home-codec.js";
import { preloadNearView, scenePlayback } from "../src/scripts/home-video.js";
import { wireSound } from "../src/scripts/home-sound.js";

const H264 = 'video/mp4; codecs="avc1.640028"';
const WIDE = "(min-width: 1001px) and (min-resolution: 1.5dppx), (min-width: 1700px)";
const LOADING = 2;
const NO_SOURCE = 3;
const HAVE_NOTHING = 0;
const HAVE_ENOUGH_DATA = 4;
const SRC_NOT_SUPPORTED = 4;
const TWO_LOADS = 2;
const SOURCES_IN_PAGE = 2;

function scene(clip, germanCut) {
  const de = (suffix) => (germanCut ? ` data-src-de="/assets/home/${clip}-de${suffix}"` : "");
  return `<article class="scene"><div class="vslot">
    <video data-clip="${clip}" preload="none" muted playsinline>
      <source src="/assets/home/${clip}-1080.mp4"${de("-1080.mp4")} type='${H264}' media="${WIDE}">
      <source src="/assets/home/${clip}.mp4"${de(".mp4")} type='${H264}'>
      <track kind="captions" srclang="en" src="/assets/home/${clip}-en.vtt">
    </video>
    <div class="vfail" role="status" hidden><span>Video didn't load.</span> <span class="vfail-code"></span> <button type="button" class="vretry">Try again</button></div>
  </div></article>`;
}

function fakeMedia(video) {
  const media = {
    paused: true,
    networkState: LOADING,
    readyState: HAVE_NOTHING,
    error: null,
    loads: 0,
    plays: 0,
  };
  Object.defineProperties(video, {
    paused: { get: () => media.paused },
    networkState: { get: () => media.networkState },
    readyState: { get: () => media.readyState },
    error: { get: () => media.error },
    currentSrc: {
      get: () =>
        video.getAttribute("src") ? `https://sundartha.test${video.getAttribute("src")}` : "",
    },
    play: {
      value: () => {
        media.plays += 1;
        return media.answer ? media.answer() : Promise.resolve();
      },
    },
    load: {
      value: () => {
        media.loads += 1;
        media.error = null;
        media.networkState = LOADING;
        video.dispatchEvent(new video.ownerDocument.defaultView.Event("emptied"));
      },
    },
  });
  return media;
}

function page({ lang = "en" } = {}) {
  const window = new Window({ url: "https://sundartha.test/" });
  const doc = window.document;
  doc.documentElement.lang = lang;
  doc.body.innerHTML = scene("uc1", false) + scene("uc2", true);
  const videos = Array.from(doc.querySelectorAll("video"));
  const media = videos.map(fakeMedia);
  const slots = Array.from(doc.querySelectorAll(".vslot"));
  const fail = (index) => {
    media[index].error = { code: SRC_NOT_SUPPORTED, message: "" };
    media[index].networkState = NO_SOURCE;
    videos[index].dispatchEvent(new window.Event("error"));
  };
  return { window, doc, videos, media, slots, fail };
}

const failedLine = (slot) => !slot.querySelector(".vfail").hidden;

test("mobil direkter src: keine <source> mehr, Untertitel bleiben, die Datei ist die 720p-H.264 ohne media", async () => {
  const { window, doc, videos, media } = page();
  useDirectSources(doc);
  for (const [index, video] of videos.entries()) {
    const clip = video.dataset.clip;
    assert.equal(video.querySelectorAll("source").length, 0);
    assert.equal(video.querySelectorAll("track").length, 1);
    assert.equal(video.getAttribute("data-direct-src"), `/assets/home/${clip}.mp4`);
    assert.equal(
      video.hasAttribute("src"),
      false,
      "noch nicht gebraucht: kein src, also kein Laden",
    );
    assert.equal(media[index].loads, 0);
  }
  await window.happyDOM.close();
});

test("mobil direkter src: erst beim ersten Bedarf wird src gesetzt, genau einmal", async () => {
  const { window, doc, videos } = page();
  useDirectSources(doc);
  assert.equal(reloadIfStale(videos[0]), true);
  assert.equal(videos[0].getAttribute("src"), "/assets/home/uc1.mp4");
  assert.equal(reloadIfStale(videos[0]), false);
  assert.equal(videos[1].hasAttribute("src"), false, "der andere Film bleibt unberührt");
  await window.happyDOM.close();
});

test("mobil direkter src: auf Deutsch nimmt der Film mit deutschem Schnitt die -de-Datei, auch beim Sprachwechsel", async () => {
  const { window, doc, videos } = page({ lang: "de" });
  useDirectSources(doc);
  assert.equal(videos[1].getAttribute("data-direct-src"), "/assets/home/uc2.mp4");
  reloadIfStale(videos[1]);
  assert.equal(videos[1].getAttribute("src"), "/assets/home/uc2-de.mp4");
  wireSound(doc);
  doc.documentElement.lang = "en";
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(videos[1].getAttribute("src"), "/assets/home/uc2.mp4");
  await window.happyDOM.close();
});

test("Fehlerzeile mobil: erster Fehler lädt still genau einmal neu, erst der zweite zeigt die Zeile mit Code", async () => {
  const { window, doc, videos, media, slots, fail } = page();
  useDirectSources(doc);
  for (const slot of slots) scenePlayback(slot);
  reloadIfStale(videos[0]);
  fail(0);
  assert.equal(failedLine(slots[0]), false, "erst ein stiller zweiter Versuch");
  assert.equal(media[0].loads, 1);
  assert.equal(videos[0].getAttribute("src"), "/assets/home/uc1.mp4", "derselbe direkte src");
  fail(0);
  assert.equal(failedLine(slots[0]), true);
  assert.equal(slots[0].querySelector(".vfail-code").textContent, "E4 · uc1.mp4");
  assert.equal(media[0].loads, 1, "kein dritter Versuch ohne Klick");
  assert.equal(media[1].loads, 0);
  await window.happyDOM.close();
});

test("Fehlerzeile mobil: Try again lädt den direkten src neu und blendet Zeile und Code aus", async () => {
  const { window, doc, videos, media, slots, fail } = page();
  useDirectSources(doc);
  for (const slot of slots) scenePlayback(slot);
  reloadIfStale(videos[0]);
  fail(0);
  fail(0);
  slots[0].querySelector(".vretry").click();
  assert.equal(failedLine(slots[0]), false);
  assert.equal(slots[0].querySelector(".vfail-code").textContent, "");
  assert.equal(media[0].loads, TWO_LOADS);
  assert.equal(videos[0].getAttribute("src"), "/assets/home/uc1.mp4");
  assert.equal(media[0].plays, 1);
  await window.happyDOM.close();
});

test("Fehlerzeile mobil: bricht dieselbe Datei nach dem ersten Bild wieder ab, gibt es keinen zweiten stillen Versuch, die Zeile kommt", async () => {
  const { window, doc, videos, media, slots, fail } = page();
  useDirectSources(doc);
  for (const slot of slots) scenePlayback(slot);
  reloadIfStale(videos[0]);
  fail(0);
  media[0].readyState = HAVE_ENOUGH_DATA;
  videos[0].dispatchEvent(new window.Event("loadeddata"));
  videos[0].dispatchEvent(new window.Event("playing"));
  fail(0);
  assert.equal(failedLine(slots[0]), true, "keine Endlosschleife");
  assert.equal(media[0].loads, 1);
  await window.happyDOM.close();
});

test("Fehlerzeile mobil: nach Try again hat derselbe src wieder einen stillen Versuch", async () => {
  const { window, doc, videos, media, slots, fail } = page();
  useDirectSources(doc);
  for (const slot of slots) scenePlayback(slot);
  reloadIfStale(videos[0]);
  fail(0);
  fail(0);
  slots[0].querySelector(".vretry").click();
  fail(0);
  assert.equal(failedLine(slots[0]), false);
  assert.equal(media[0].loads, TWO_LOADS + 1);
  await window.happyDOM.close();
});

test("Vorladen mobil: kommt der Film in Sichtnähe, bekommt nur er den direkten src", async () => {
  const { window, doc, videos } = page();
  useDirectSources(doc);
  let notify = null;
  class Observer {
    constructor(callback) {
      notify = callback;
    }
    observe() {}
    unobserve() {}
  }
  preloadNearView(videos, Observer);
  notify([{ isIntersecting: true, target: videos[1] }]);
  assert.equal(videos[1].getAttribute("src"), "/assets/home/uc2.mp4");
  assert.equal(videos[1].preload, "auto");
  assert.equal(videos[0].hasAttribute("src"), false);
  await window.happyDOM.close();
});

test("Fehlerzeile mobil: ein spät abgelehntes play() von vor dem stillen Versuch blockiert das Weiterspielen nicht", async () => {
  const { window, doc, videos, media, slots, fail } = page();
  useDirectSources(doc);
  const players = slots.map((slot) => scenePlayback(slot));
  let rejectOld = null;
  media[0].answer = () =>
    media[0].plays === 1
      ? new Promise((resolve, reject) => (rejectOld = reject))
      : Promise.resolve();
  players[0].enter();
  fail(0);
  const notSupported = new Error("old");
  notSupported.name = "NotSupportedError";
  rejectOld(notSupported);
  await new Promise((resolve) => setTimeout(resolve, 0));
  players[0].keep();
  assert.equal(media[0].plays, TWO_LOADS + 1, "keep() fordert nach dem Reload weiter an");
  await window.happyDOM.close();
});

test("Fehlerzeile mobil: ein error-Ereignis ohne MediaError und mit Daten zeigt nichts und lädt nichts", async () => {
  const { window, doc, videos, media, slots } = page();
  useDirectSources(doc);
  for (const slot of slots) scenePlayback(slot);
  reloadIfStale(videos[0]);
  media[0].readyState = HAVE_ENOUGH_DATA;
  videos[0].dispatchEvent(new window.Event("error"));
  assert.equal(failedLine(slots[0]), false);
  assert.equal(media[0].loads, 0);
  await window.happyDOM.close();
});

test("Desktop: ohne Umstellung bleiben die Quellen und die Fehlerzeile zeigt sofort, jetzt mit Code", async () => {
  const { window, videos, media, slots } = page();
  for (const slot of slots) scenePlayback(slot);
  assert.equal(videos[0].querySelectorAll("source").length, SOURCES_IN_PAGE);
  media[0].networkState = NO_SOURCE;
  const sources = videos[0].querySelectorAll("source");
  sources[sources.length - 1].dispatchEvent(new window.Event("error"));
  assert.equal(failedLine(slots[0]), true);
  assert.equal(slots[0].querySelector(".vfail-code").textContent, "N3 · uc1.mp4");
  await window.happyDOM.close();
});

test("Seite und Start: Code-Feld ohne Übersetzung, direkter src nur mobil und nicht bei av1=force", () => {
  const page = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
  assert.match(page, /<span class="vfail-code" aria-hidden="true"><\/span>/);
  const home = readFileSync(new URL("../src/scripts/home.js", import.meta.url), "utf8");
  assert.match(home, /if \(mobile && !force\) useDirectSources\(document/);
});
