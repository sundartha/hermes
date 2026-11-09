import { test } from "node:test";
import assert from "node:assert/strict";

const FRAME_STEP_MS = 40;
const START_MS = 1000;
const WARM_FRAMES = 10;
let active = null;

function installGlobals() {
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", globalThis);
  define("document", {
    visibilityState: "visible",
    createElement: () => active.canvas,
    addEventListener() {},
    removeEventListener() {},
  });
  define("performance", { now: () => START_MS });
  define("devicePixelRatio", 1);
  define("matchMedia", () => ({ matches: false }));
  define("IntersectionObserver", function () { this.observe = () => {}; this.disconnect = () => {}; });
  define("requestAnimationFrame", (fn) => { active.pendingFrame = fn; return 1; });
  define("cancelAnimationFrame", () => { active.pendingFrame = null; });
}

installGlobals();
await import("../../src/ui/wing-canvas-engine.js");

function loadedImage() {
  return { complete: true, naturalWidth: 200, naturalHeight: 400 };
}

function mountWing(status, image = loadedImage()) {
  const callLog = [];
  const recorder = new Proxy({}, {
    get(_target, name) {
      return (...args) => { callLog.push(`${String(name)}:${JSON.stringify(args)}`); };
    },
    set() { return true; },
  });
  const own = {
    pendingFrame: null,
    canvas: { style: {}, parentNode: null, setAttribute() {}, getContext: () => recorder },
  };
  let nowMs = START_MS;
  active = own;
  const host = { appendChild: (el) => el, removeChild: (el) => el };
  const raw = globalThis.window.HermesWingCanvas.mount(host, { status, image, size: 112 });
  const handle = { setStatus: (next) => { active = own; raw.setStatus(next); } };
  const step = () => {
    active = own;
    nowMs += FRAME_STEP_MS;
    callLog.length = 0;
    const run = own.pendingFrame;
    own.pendingFrame = null;
    run(nowMs);
    return callLog.join("|");
  };
  const warm = (frames) => { for (let i = 0; i < frames; i += 1) step(); };
  return { handle, step, warm };
}

test("T-wing-ohne-neustart-gleicher-status: gleicher Status laesst den Fluegelschlag weiterlaufen", () => {
  const laufend = mountWing("working");
  laufend.warm(WARM_FRAMES);
  const ohneAufruf = laufend.step();

  const wiederholt = mountWing("working");
  wiederholt.warm(WARM_FRAMES);
  wiederholt.handle.setStatus("working");
  wiederholt.handle.setStatus("working");
  const mitAufruf = wiederholt.step();

  const frisch = mountWing("working");
  const ersterSchlag = frisch.step();

  assert.ok(ohneAufruf.length > 0);
  assert.equal(mitAufruf, ohneAufruf);
  assert.notEqual(ersterSchlag, ohneAufruf);
});

test("T-wing-ohne-neustart-wechsel: ein Statuswechsel startet genau einmal von vorn", () => {
  const frisch = mountWing("connecting");
  const ersterBildLauf = [frisch.step(), frisch.step()];

  const gewechselt = mountWing("working");
  gewechselt.warm(WARM_FRAMES);
  gewechselt.handle.setStatus("connecting");
  const ersteSchlagFolge = gewechselt.step();
  gewechselt.handle.setStatus("connecting");
  const zweiteSchlagFolge = gewechselt.step();

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
  const nachLaden = spaet.step();

  const direkt = mountWing("working");
  const erwartet = direkt.step();

  assert.ok(nachLaden.length > 0);
  assert.equal(nachLaden, erwartet);
});
