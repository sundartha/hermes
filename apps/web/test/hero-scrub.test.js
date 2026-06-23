// W4-Tests: die Scroll-Scrub-Logik (lib/hero-scrub.js). Die reine
// Schritt-Berechnung (heroScrubStep) wird mit festen Eingaben geprueft; die
// DOM-/Scroll-Verdrahtung (initHeroScrub) ueber injizierte Fake-Window-/Element-
// Objekte (DIP) -- kein Browser-DOM noetig (node:test, offline).
import { test } from "node:test";
import assert from "node:assert/strict";

import { heroScrubStep, initHeroScrub } from "../src/lib/hero-scrub.js";

// ---- heroScrubStep: reine Position -> Schritt-Abbildung ---------------------
test("heroScrubStep: scrollY -> Schritt, fail-closed an den Raendern", () => {
  // range = innerHeight * rangeVh = 800 * 1.2 = 960
  assert.equal(heroScrubStep(0, 800, 3, 1.2), 0); // Anfang
  assert.equal(heroScrubStep(480, 800, 3, 1.2), 1); // halbe Strecke
  assert.equal(heroScrubStep(960, 800, 3, 1.2), 2); // Ende -> letzter Schritt
  assert.equal(heroScrubStep(99999, 800, 3, 1.2), 2); // weit drueber, geklammert
  assert.equal(heroScrubStep(-100, 800, 3, 1.2), 0); // negativ -> 0
  // Defensive: Hoehe 0 / nur 1 Schritt -> 0 (kein NaN, kein Ausreisser).
  assert.equal(heroScrubStep(500, 0, 3, 1.2), 0);
  assert.equal(heroScrubStep(500, 800, 1, 1.2), 0);
});

// ---- initHeroScrub: Verdrahtung mit Fakes -----------------------------------
function makeEl() {
  return {
    classList: { _set: new Set(), add(c) { this._set.add(c); }, has(c) { return this._set.has(c); } },
    dataset: {},
    textContent: "",
  };
}

// Fake-Window mit den von initHeroScrub genutzten APIs + Test-Hooks (_intersect,
// _scroll, _flushRaf) zum deterministischen Ausloesen der Callbacks.
function makeWin(innerHeight) {
  let scrollHandler = null;
  let ioCb = null;
  const rafQueue = [];
  return {
    scrollY: 0,
    innerHeight,
    addEventListener(name, fn) { if (name === "scroll") scrollHandler = fn; },
    removeEventListener(name) { if (name === "scroll") scrollHandler = null; },
    requestAnimationFrame(fn) { rafQueue.push(fn); },
    IntersectionObserver: class {
      constructor(cb) { ioCb = cb; }
      observe() {}
    },
    _intersect(value) { ioCb([{ isIntersecting: value }]); },
    _scroll() { if (scrollHandler) scrollHandler(); },
    _flushRaf() { rafQueue.splice(0).forEach((fn) => fn()); },
    get _hasScrollHandler() { return Boolean(scrollHandler); },
  };
}

test("initHeroScrub: setzt is-scrubbing + Startschritt 0 mit erster Caption", () => {
  const win = makeWin(800);
  const root = makeEl();
  const caption = makeEl();
  initHeroScrub({ root, caption, captions: ["A", "B", "C"], rangeVh: 1.2, win });
  assert.ok(root.classList.has("is-scrubbing"));
  assert.equal(root.dataset.step, "0");
  assert.equal(caption.textContent, "A");
});

test("initHeroScrub: scrollt -> data-step + Caption folgen; Intersection togglet Listener", () => {
  const win = makeWin(800);
  const root = makeEl();
  const caption = makeEl();
  initHeroScrub({ root, caption, captions: ["A", "B", "C"], rangeVh: 1.2, win });

  // Sichtbar -> Scroll-Listener aktiv, sofortiges update() bei scrollY 0 -> Schritt 0.
  win._intersect(true);
  assert.equal(win._hasScrollHandler, true);
  assert.equal(root.dataset.step, "0");

  // Bis ans Ende scrollen -> rAF-gedrosselt -> letzter Schritt + letzte Caption.
  win.scrollY = 960;
  win._scroll();
  win._flushRaf();
  assert.equal(root.dataset.step, "2");
  assert.equal(caption.textContent, "C");

  // Aus dem Viewport -> Listener wieder entfernt (Performance).
  win._intersect(false);
  assert.equal(win._hasScrollHandler, false);
});

test("initHeroScrub: zu wenige Captions -> kein Scrub (statisches Poster bleibt)", () => {
  const win = makeWin(800);
  const root = makeEl();
  const caption = makeEl();
  initHeroScrub({ root, caption, captions: ["nur eine"], rangeVh: 1.2, win });
  assert.equal(root.classList.has("is-scrubbing"), false);
  assert.equal(root.dataset.step, undefined);
});
