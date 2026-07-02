// Fix-B-Test: der timeupdate-Listener aus hero.js (Nahtloser Loop, siehe
// SPEC-HERO-VIDEO-FIX.md § C), per node:vm in einem minimalen Fake-DOM
// ausgefuehrt — dieselbe Sandbox-Technik wie test/mcp-ui-w1-call-widget.test.js
// und test/mcp-ui-wing-canvas-mount.test.js (Root-Suite). Kein echter Browser,
// kein jsdom-Dependency. Prueft NUR die neue Guard-Logik (Grenzwerte, Metadata-
// Guard, Koexistenz mit dem pause-Listener) — Paint-/Netzwerk-/Tab-Throttle-
// Verhalten bleibt manuelle QA (SPEC § D7, in echten Browsern nicht simulierbar).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const heroPath = fileURLToPath(new URL("../public/assets/hero.js", import.meta.url));
const HERO_SOURCE = readFileSync(heroPath, "utf8");

// LOOP_EDGE_S wird aus der Quelle extrahiert statt im Test dupliziert (vgl. G22)
// -> ein kuenftiger, SPEC-konformer Schwellwert-Wechsel macht den Test nicht
// stillschweigend falsch-negativ.
const LOOP_EDGE_MATCH = HERO_SOURCE.match(/var LOOP_EDGE_S = ([\d.]+);/);
assert.ok(LOOP_EDGE_MATCH, "LOOP_EDGE_S nicht gefunden - hero.js umstrukturiert?");
const LOOP_EDGE_S = Number(LOOP_EDGE_MATCH[1]);

function makeFakeVideo() {
  const listeners = {};
  return {
    currentTime: 0,
    duration: NaN,
    playbackRate: 1,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    fire(type) {
      for (const h of listeners[type] || []) h();
    },
    listenerCount(type) {
      return (listeners[type] || []).length;
    },
    play() {},
  };
}

function makeFakeDocument(video) {
  return {
    visibilityState: "visible",
    getElementById: (id) => (id === "hermesSky" ? video : null),
    addEventListener() {},
  };
}

// Fuehrt hero.js in einer frischen vm-Sandbox aus. setTimeout wird nur erfasst,
// nie automatisch gefeuert (F.I.R.S.T. - Fast, kein echtes Warten); dadurch
// loesen die gestaffelten play()-Retries aus hero.js:34-37 keine Nebenwirkungen
// im Test aus.
function runHeroScript() {
  const video = makeFakeVideo();
  const doc = makeFakeDocument(video);
  const timeouts = [];
  const sandbox = {
    document: doc,
    IntersectionObserver: function (cb) { this.observe = () => cb([{ isIntersecting: true }]); },
    setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; },
  };
  vm.createContext(sandbox);
  vm.runInContext(HERO_SOURCE, sandbox);
  return { video, timeouts };
}

test("Loop-Edge erreicht: currentTime wird auf 0 zurueckgesetzt", () => {
  const { video } = runHeroScript();
  video.duration = 10.041667;
  video.currentTime = video.duration - (LOOP_EDGE_S / 2);
  video.fire("timeupdate");
  assert.equal(video.currentTime, 0);
});

test("weit vor Clip-Ende: kein Reset", () => {
  const { video } = runHeroScript();
  video.duration = 10.041667;
  const before = video.duration - 1.0;
  video.currentTime = before;
  video.fire("timeupdate");
  assert.equal(video.currentTime, before);
});

test("Metadata-Guard: NaN-Duration (vor loadedmetadata) verhindert Reset ohne Crash", () => {
  const { video } = runHeroScript();
  video.currentTime = 5;
  assert.doesNotThrow(() => video.fire("timeupdate"));
  assert.equal(video.currentTime, 5);
});

test("Metadata-Guard: Infinity-Duration (Stream-Fall) verhindert Reset", () => {
  const { video } = runHeroScript();
  video.duration = Infinity;
  video.currentTime = 5;
  video.fire("timeupdate");
  assert.equal(video.currentTime, 5);
});

test("pathologisch kurzer Clip (duration <= LOOP_EDGE_S): kein Reset-Loop", () => {
  const { video } = runHeroScript();
  video.duration = LOOP_EDGE_S - 0.05;
  video.currentTime = LOOP_EDGE_S - 0.06;
  video.fire("timeupdate");
  assert.equal(video.currentTime, LOOP_EDGE_S - 0.06);
});

test("Reset am Loop-Edge loest KEIN pause-Event / KEINEN 140ms-Retry aus (Koexistenz mit hero.js:25)", () => {
  const { video, timeouts } = runHeroScript();
  video.duration = 10.041667;
  video.currentTime = video.duration - 0.01;
  const timeoutsBefore = timeouts.length;
  video.fire("timeupdate");
  assert.equal(video.currentTime, 0);
  assert.equal(timeouts.length, timeoutsBefore, "Reset darf keinen zusaetzlichen setTimeout (pause-Retry) ausloesen");
});
