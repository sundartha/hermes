import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const START_MS = 1000;
const FRAMES = 12;
const WIDGETS = await ausgelieferteWidgets();
const ENGINE = skriptbloecke(WIDGETS.call).find((block) => block.includes("HermesWingCanvas") && block.includes("FPS_CAP_DEFAULT"));
const CALL_SKRIPT = skriptbloecke(WIDGETS.call).find((block) => block.includes("updateForStatus"));

function zeichneteBilder(zeitschritte, optionen) {
  let pendingFrame = null;
  let gezeichnet = 0;
  const recorder = new Proxy({}, {
    get(_target, name) {
      return () => { if (name === "clearRect") gezeichnet += 1; };
    },
    set() { return true; },
  });
  const canvas = { style: {}, parentNode: null, setAttribute() {}, getContext: () => recorder };
  const sandbox = {
    document: { visibilityState: "visible", createElement: () => canvas, addEventListener() {}, removeEventListener() {} },
    performance: { now: () => START_MS },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    requestAnimationFrame: (fn) => { pendingFrame = fn; return 1; },
    cancelAnimationFrame() { pendingFrame = null; },
  };
  sandbox.window = sandbox;
  sandbox.process = process;
  vm.createContext(sandbox);
  vm.runInContext(ENGINE, sandbox);
  const host = { appendChild: (el) => el, removeChild: (el) => el };
  const image = { complete: true, naturalWidth: 200, naturalHeight: 400 };
  sandbox.window.HermesWingCanvas.mount(host, { status: "working", image, size: 112, ...optionen });
  gezeichnet = 0;
  const proBild = [];
  let jetzt = START_MS;
  for (const schritt of zeitschritte) {
    jetzt += schritt;
    const vorher = gezeichnet;
    const run = pendingFrame;
    pendingFrame = null;
    run(jetzt);
    proBild.push(gezeichnet - vorher);
  }
  return proBild;
}

function takt(werte) {
  return Array.from({ length: FRAMES }, (_unused, i) => werte[i % werte.length]);
}

test("T-fluegel-60-gleichmaessig: bei 60 Bildern und 16,7 ms wird jedes Bild gezeichnet", () => {
  assert.deepEqual(zeichneteBilder(takt([16.7]), { fpsCap: 60 }), takt([1]));
});

test("T-fluegel-60-knapp: bei 60 Bildern und 16,6 ms wird jedes Bild gezeichnet", () => {
  assert.deepEqual(zeichneteBilder(takt([16.6]), { fpsCap: 60 }), takt([1]));
});

test("T-fluegel-60-gemischt: bei 60 Bildern und wechselnd 16,6 und 16,7 ms wird jedes Bild gezeichnet", () => {
  assert.deepEqual(zeichneteBilder(takt([16.6, 16.7]), { fpsCap: 60 }), takt([1]));
});

test("T-fluegel-60-bei-120-hertz: bei 60 Bildern und 8,3 ms zeichnet jedes zweite Bild", () => {
  assert.deepEqual(zeichneteBilder(takt([8.3]), { fpsCap: 60 }), takt([0, 1]));
});

test("T-fluegel-30-voreinstellung: ohne fpsCap zeichnet bei 16,7 ms jedes zweite Bild", () => {
  assert.deepEqual(zeichneteBilder(takt([16.7]), {}), takt([0, 1]));
});

test("T-fluegel-60-karte: die Anrufkarte haengt die Engine mit fpsCap 60 ein", () => {
  let optionen = null;
  const element = () => ({
    style: {}, children: [], classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, setAttribute() {}, appendChild(c) { return c; },
  });
  const sandbox = {
    document: { querySelector: () => element(), querySelectorAll: () => [], documentElement: { lang: "" }, createElement: element },
    parent: { postMessage() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    CustomEvent: function CustomEvent(type) { this.type = type; },
    addEventListener() {}, dispatchEvent() {},
  };
  sandbox.window = sandbox;
  sandbox.HermesWingCanvas = { mount: (_host, opts) => { optionen = opts; return { setStatus() {} }; } };
  vm.createContext(sandbox);
  vm.runInContext(CALL_SKRIPT, sandbox);
  assert.equal(optionen.fpsCap, 60);
});
