import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const demoPath = fileURLToPath(new URL("../src/scripts/hermes-demo.js", import.meta.url));
const DEMO_SOURCE = readFileSync(demoPath, "utf8");

const LOOP_BISHER_MS = 76_000;
const LOOP_GEAENDERT_MS = 80_000;
const GLOW_MS = 7_000;
const OHNE_DAUER_MS = 0;
const SCHRITT_PROZENT = "5";
const SCHRITT_ANTEIL = 0.05;

function animation(duration) {
  return { currentTime: null, effect: { getTiming: () => ({ duration }) } };
}

function makeTrack(fillAnimations) {
  const listeners = {};
  const attributes = {};
  const fill = { getAnimations: () => fillAnimations };
  return {
    attributes,
    querySelector: (selector) => (selector === ".hd-fill" ? fill : null),
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    press(key) {
      listeners.keydown({ key, preventDefault() {} });
    },
  };
}

function makeStage(track, stageAnimations) {
  return {
    style: { setProperty() {} },
    setAttribute() {},
    getAnimations: () => stageAnimations,
    querySelector: (selector) => (selector === "[data-hd-track]" ? track : null),
    querySelectorAll: () => [],
  };
}

function runDemo({ fillAnimations, stageAnimations }) {
  const track = makeTrack(fillAnimations);
  const stage = makeStage(track, stageAnimations);
  const sandbox = {
    document: { readyState: "complete", querySelectorAll: () => [stage] },
    window: { addEventListener() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(DEMO_SOURCE, sandbox);
  return track;
}

for (const loopMs of [LOOP_BISHER_MS, LOOP_GEAENDERT_MS]) {
  test(`Pfeil rechts versetzt die Szenen-Animationen um 5 % der Fortschrittsbalken-Dauer (${loopMs} ms), andere bleiben stehen`, () => {
    const szene = animation(loopMs);
    const glow = animation(GLOW_MS);
    const track = runDemo({ fillAnimations: [animation(loopMs)], stageAnimations: [szene, glow] });
    track.press("ArrowRight");
    assert.equal(Math.round(szene.currentTime), Math.round(SCHRITT_ANTEIL * loopMs));
    assert.equal(glow.currentTime, null);
    assert.equal(track.attributes["aria-valuenow"], SCHRITT_PROZENT);
  });
}

test("ohne Animation am Fortschrittsbalken versetzt die Scrub-Leiste nichts und setzt nur aria-valuenow", () => {
  const ohneDauer = animation(OHNE_DAUER_MS);
  const track = runDemo({ fillAnimations: [], stageAnimations: [ohneDauer] });
  track.press("ArrowRight");
  assert.equal(ohneDauer.currentTime, null);
  assert.equal(track.attributes["aria-valuenow"], SCHRITT_PROZENT);
});
