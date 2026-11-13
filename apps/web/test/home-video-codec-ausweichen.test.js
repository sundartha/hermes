import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { scenePlayback } from "../src/scripts/home-video.js";

const PAGE = readFileSync(
  fileURLToPath(new URL("../src/pages/index.astro", import.meta.url)),
  "utf8",
);
const ORIGIN = "https://sundartha.test";
const AV1 = 'video/mp4; codecs="av01.0.05M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';
const LOADING = 2;
const FALLBACK_AND_RETRY = 2;

function sceneMarkup(sources) {
  const list = sources.map(([src, type]) => `<source src="${src}" type='${type}'>`).join("");
  return `<article class="scene"><div class="vslot">
    <video data-clip="uc1" muted>${list}</video>
    <div class="vfail" role="status" hidden><span>Video didn't load.</span> <button type="button" class="vretry">Try again</button></div>
  </div></article>`;
}

const BOTH_CODECS = [
  ["/a/uc1-1080.av1.mp4", AV1],
  ["/a/uc1-1080.mp4", H264],
  ["/a/uc1.av1.mp4", AV1],
  ["/a/uc1.mp4", H264],
];

function fakeMedia(video) {
  const media = { paused: true, currentSrc: "", loads: 0, plays: 0 };
  Object.defineProperties(video, {
    paused: { get: () => media.paused },
    networkState: { get: () => LOADING },
    currentSrc: { get: () => media.currentSrc },
    play: {
      value: () => {
        media.plays += 1;
        media.paused = false;
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        media.paused = true;
      },
    },
    load: {
      value: () => {
        media.loads += 1;
        media.paused = true;
        video.dispatchEvent(new video.ownerDocument.defaultView.Event("emptied"));
      },
    },
  });
  return media;
}

function scene(sources = BOTH_CODECS) {
  const window = new Window({ url: `${ORIGIN}/` });
  window.document.body.innerHTML = sceneMarkup(sources);
  const slot = window.document.querySelector(".vslot");
  const video = slot.querySelector("video");
  const media = fakeMedia(video);
  const player = scenePlayback(slot);
  const failWhilePlaying = (path) => {
    media.currentSrc = `${ORIGIN}${path}`;
    video.dispatchEvent(new window.Event("error"));
  };
  const sourcePaths = () =>
    Array.from(video.querySelectorAll("source"), (source) => source.getAttribute("src"));
  return { slot, video, media, player, failWhilePlaying, sourcePaths };
}

const failureShown = (slot) => !slot.querySelector(".vfail").hidden;

test("Szenen-Film: scheitert die AV1-Quelle, läuft die Szene ohne Fehlerzeile mit H.264 weiter", () => {
  const { slot, media, player, failWhilePlaying, sourcePaths } = scene();
  player.enter();
  const playsBefore = media.plays;
  failWhilePlaying("/a/uc1.av1.mp4");
  assert.equal(failureShown(slot), false, "Fehlerzeile erscheint, obwohl H.264 bereitliegt");
  assert.equal(slot.classList.contains("is-failed"), false);
  assert.deepEqual(
    sourcePaths(),
    ["/a/uc1-1080.mp4", "/a/uc1.mp4"],
    "AV1-Quellen sind noch wählbar",
  );
  assert.equal(media.loads, 1, "Film wurde nicht neu geladen");
  assert.equal(
    media.plays,
    playsBefore + 1,
    "laufende Szene startet nach dem Ausweichen nicht wieder",
  );
});

test("Szenen-Film: scheitert danach auch H.264, bleibt der Fehler sichtbar und Erneut versuchen lädt ohne AV1", () => {
  const { slot, media, player, failWhilePlaying, sourcePaths } = scene();
  player.enter();
  failWhilePlaying("/a/uc1.av1.mp4");
  failWhilePlaying("/a/uc1.mp4");
  assert.equal(failureShown(slot), true, "beide Codecs gescheitert, aber keine Fehlerzeile");
  assert.equal(slot.classList.contains("is-failed"), true);
  assert.equal(media.loads, 1, "nach dem H.264-Fehler wurde still weiter neu geladen");
  const playsBefore = media.plays;
  slot.querySelector(".vretry").click();
  assert.equal(failureShown(slot), false);
  assert.equal(media.loads, FALLBACK_AND_RETRY);
  assert.equal(media.plays, playsBefore + 1);
  assert.deepEqual(
    sourcePaths(),
    ["/a/uc1-1080.mp4", "/a/uc1.mp4"],
    "Erneut versuchen nimmt AV1 wieder auf",
  );
});

test("Szenen-Film: ein Fehler, während H.264 läuft, zeigt die Fehlerzeile sofort", () => {
  const { slot, media, player, failWhilePlaying, sourcePaths } = scene();
  player.enter();
  failWhilePlaying("/a/uc1.mp4");
  assert.equal(failureShown(slot), true);
  assert.equal(media.loads, 0, "H.264-Fehler wurde still wiederholt");
  assert.deepEqual(
    sourcePaths(),
    BOTH_CODECS.map(([src]) => src),
    "Quellen wurden ohne AV1-Fehler verändert",
  );
});

test("Szenen-Film: ohne andere Quelle neben AV1 erscheint die Fehlerzeile", () => {
  const { slot, media, player, failWhilePlaying, sourcePaths } = scene([["/a/uc1.av1.mp4", AV1]]);
  player.enter();
  failWhilePlaying("/a/uc1.av1.mp4");
  assert.equal(failureShown(slot), true);
  assert.equal(media.loads, 0);
  assert.deepEqual(sourcePaths(), ["/a/uc1.av1.mp4"], "einzige Quelle wurde entfernt");
});

test("Szenen-Film: eine Szene außerhalb des Bildes startet durch das Ausweichen nicht von selbst", () => {
  const { slot, media, player, failWhilePlaying } = scene();
  player.enter();
  player.leave();
  const playsBefore = media.plays;
  failWhilePlaying("/a/uc1.av1.mp4");
  assert.equal(failureShown(slot), false);
  assert.equal(media.loads, 1);
  assert.equal(media.plays, playsBefore, "verlassene Szene spielt wieder los");
});

test("Szenen-Film: eine vom Nutzer pausierte Szene bleibt nach dem Ausweichen pausiert", () => {
  const { video, media, player, failWhilePlaying } = scene();
  player.enter();
  video.dataset.userPaused = "1";
  const playsBefore = media.plays;
  failWhilePlaying("/a/uc1.av1.mp4");
  assert.equal(media.loads, 1);
  assert.equal(media.plays, playsBefore, "pausierte Szene spielt wieder los");
});

test("Startseite: jede AV1-Quelle der Szenen-Filme hat eine H.264-Fassung gleicher Größe daneben", () => {
  const block = PAGE.slice(
    PAGE.indexOf("const VIDEO_TYPES"),
    PAGE.indexOf("];", PAGE.indexOf("const VIDEO_TYPES")),
  );
  const entries = [...block.matchAll(/suffix: (`[^`]+`|"[^"]+"), type: '([^']+)'/g)].map(
    ([, suffix, type]) => ({ suffix, type }),
  );
  const av1 = entries.filter(({ type }) => type.includes("av01"));
  assert.ok(av1.length > 0, "keine AV1-Quelle gefunden");
  for (const { suffix } of av1) {
    const twin = suffix.replace(".av1.mp4", ".mp4");
    assert.ok(
      entries.some((entry) => entry.suffix === twin && entry.type.includes("avc1")),
      `${suffix}: H.264-Fassung fehlt`,
    );
  }
});
