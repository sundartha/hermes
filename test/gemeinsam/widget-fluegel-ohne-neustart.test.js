import { test } from "node:test";
import assert from "node:assert/strict";

const FRAME_STEP_MS = 40;
const START_MS = 1000;
const WARM_FRAMES = 10;

let pendingFrame = null;
let nextFrameId = 1;
const callLog = [];

const recorder = new Proxy({}, {
  get(_target, name) {
    return (...args) => { callLog.push(`${String(name)}:${JSON.stringify(args)}`); };
  },
  set() { return true; },
});

globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false });
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (fn) => { pendingFrame = fn; return nextFrameId++; };
globalThis.cancelAnimationFrame = () => { pendingFrame = null; };
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
Object.defineProperty(globalThis, "performance", { value: { now: () => START_MS }, configurable: true, writable: true });
globalThis.document = {
  visibilityState: "visible",
  createElement: () => ({ style: {}, parentNode: null, setAttribute() {}, getContext: () => recorder }),
  addEventListener() {},
  removeEventListener() {},
};

await import("../../src/ui/wing-canvas-engine.js");

function makeHost() {
  return {
    appendChild(el) { el.parentNode = this; return el; },
    removeChild(el) { el.parentNode = null; return el; },
  };
}

function loadedImage() {
  return { complete: true, naturalWidth: 200, naturalHeight: 400 };
}

function mountWing(status, image = loadedImage()) {
  pendingFrame = null;
  callLog.length = 0;
  const handle = window.HermesWingCanvas.mount(makeHost(), { status, image, size: 112 });
  return { handle, clock: { ms: START_MS } };
}

function stepFrame(wing) {
  wing.clock.ms += FRAME_STEP_MS;
  callLog.length = 0;
  const run = pendingFrame;
  pendingFrame = null;
  run(wing.clock.ms);
  return callLog.join("|");
}

function warm(wing, frames) {
  for (let i = 0; i < frames; i += 1) stepFrame(wing);
}

test("T-wing-ohne-neustart-gleicher-status: gleicher Status laesst den Fluegelschlag weiterlaufen", () => {
  const laufend = mountWing("working");
  warm(laufend, WARM_FRAMES);
  const ohneAufruf = stepFrame(laufend);

  const wiederholt = mountWing("working");
  warm(wiederholt, WARM_FRAMES);
  wiederholt.handle.setStatus("working");
  wiederholt.handle.setStatus("working");
  const mitAufruf = stepFrame(wiederholt);

  const frisch = mountWing("working");
  const ersterSchlag = stepFrame(frisch);

  assert.ok(ohneAufruf.length > 0);
  assert.equal(mitAufruf, ohneAufruf);
  assert.notEqual(ersterSchlag, ohneAufruf);
});

test("T-wing-ohne-neustart-wechsel: ein Statuswechsel startet genau einmal von vorn", () => {
  const frisch = mountWing("connecting");
  const ersterBildLauf = [stepFrame(frisch), stepFrame(frisch)];

  const gewechselt = mountWing("working");
  warm(gewechselt, WARM_FRAMES);
  gewechselt.handle.setStatus("connecting");
  const ersteSchlagFolge = stepFrame(gewechselt);
  gewechselt.handle.setStatus("connecting");
  const zweiteSchlagFolge = stepFrame(gewechselt);

  assert.equal(ersteSchlagFolge, ersterBildLauf[0]);
  assert.equal(zweiteSchlagFolge, ersterBildLauf[1]);
});

test("T-wing-ohne-neustart-vor-bild: Status vor dem Laden des Bildes wirkt nach dem Laden und wirft nicht", () => {
  const wartend = { complete: false, naturalWidth: 0, naturalHeight: 0, onLoad: null, addEventListener(_type, fn) { this.onLoad = fn; } };
  const spaet = mountWing("idle", wartend);
  spaet.handle.setStatus("working");
  spaet.handle.setStatus("working");
  wartend.naturalWidth = 200;
  wartend.naturalHeight = 400;
  wartend.complete = true;
  wartend.onLoad();
  const nachLaden = stepFrame(spaet);

  const direkt = mountWing("working");
  const erwartet = stepFrame(direkt);

  assert.ok(nachLaden.length > 0);
  assert.equal(nachLaden, erwartet);
});
