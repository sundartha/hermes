import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Window } from "happy-dom";
import { wireSound } from "../src/scripts/home-sound.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");
const CSS = read("src/styles/home.css");
const SNAP_PAGES_WITH_BAR = 6;
const RUNNING_AT = 4;

test("Startseite mobil: ein Abstand-Token fuer alle Snap-Seiten, Leistenanteil folgt der sichtbaren Safari-Leiste", () => {
  assert.match(CSS, /--end:\s*33px;/);
  assert.match(CSS, /--bar:\s*calc\(100lvh - 100dvh\);/);
  assert.doesNotMatch(CSS, /calc\(100lvh - 100svh\)/, "eingeklappte Leiste darf keinen leeren Streifen reservieren");
  const uses = CSS.match(/calc\([^;]*var\(--bar\)\)/g) || [];
  assert.ok(uses.length >= SNAP_PAGES_WITH_BAR, "alle Snap-Seiten nutzen --bar");
  for (const use of uses) assert.equal(use, "calc(var(--end) + var(--bar))", use);
});

test("Startseite mobil: Verbindungsstriche haengen am Zeilenabstand der Liste, nicht an festen Pixeln", () => {
  assert.match(CSS, /\.isteps \{\s*--sg: clamp\(6px, 1\.2svh, 12px\);\s*gap: var\(--sg\);/);
  assert.match(CSS, /--sg: clamp\(6px, 1\.1svh, 12px\);\s*gap: var\(--sg\);/);
  assert.match(CSS, /\.isteps li:not\(:last-child\)::after \{\s*top: 27px;\s*bottom: calc\(-1px - var\(--sg\)\);/);
  assert.match(CSS, /\.ucs \.flow li:not\(:last-child\)::after \{\s*top: 24px;\s*bottom: calc\(-1 \* var\(--sg\)\);/);
});

test("Startseite mobil: Einblendung ohne Versatz, Schluss und Footer teilen sich die letzte Seite", () => {
  assert.match(CSS, /\.js-rv \[data-snap\] \.rv,\s*\.js-rv \[data-snap\] \.isteps\.rv li \{\s*transform: none;/);
  assert.match(CSS, /main > #close \{\s*min-height: calc\(var\(--page\) - var\(--fh, 0px\)\);/);
  assert.match(CSS, /\.foot \.wrap \{\s*padding-bottom: calc\(var\(--end\) \+ var\(--bar\)\);/);
});

test("Szenen-Video: vor dem ersten Bild wird erst abgespielt und danach an den Start gesprungen", () => {
  const player = read("src/scripts/home-video.js");
  assert.match(player, /if \(played\) media\.seekToStart\(\);/);
  assert.match(player, /video\.addEventListener\(\s*"playing",/);
  assert.doesNotMatch(player, /loadedmetadata/);
});

function langPage(playing) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.documentElement.lang = "en";
  document.body.innerHTML = `<article class="scene"><div class="vslot"><span class="label">II · Scene uc2</span>
    <video data-clip="uc2" muted><source src="/a/uc2.mp4" data-src-de="/a/uc2-de.mp4"></video></div></article>`;
  const video = document.querySelector("video");
  const seeks = [];
  Object.defineProperties(video, {
    paused: { get: () => !playing },
    currentTime: {
      get: () => (playing ? RUNNING_AT : 0),
      set: (value) => {
        seeks.push(value);
      },
    },
    play: { value: () => Promise.resolve() },
    load: { value: () => {} },
  });
  wireSound(document);
  return { window, document, video, seeks };
}

test("Sprachwechsel: ein nie gespieltes Video wird nach dem Quellwechsel nicht angesprungen, das Poster bleibt", async () => {
  const { window, document, video, seeks } = langPage(false);
  document.documentElement.lang = "de";
  await window.happyDOM.waitUntilComplete();
  video.dispatchEvent(new window.Event("loadedmetadata"));
  assert.deepEqual(seeks, []);
});

test("Sprachwechsel: ein laufendes Video springt nach dem Quellwechsel an seine alte Stelle zurueck", async () => {
  const { window, document, video, seeks } = langPage(true);
  document.documentElement.lang = "de";
  await window.happyDOM.waitUntilComplete();
  video.dispatchEvent(new window.Event("loadedmetadata"));
  assert.deepEqual(seeks, [RUNNING_AT]);
});
