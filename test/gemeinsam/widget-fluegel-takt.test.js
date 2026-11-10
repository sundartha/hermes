import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const FRAME_STEP_MS = 40;
const START_MS = 1000;
const FRAMES_PER_WING_CYCLE = 30;
const WING_CYCLE_SEC = (FRAMES_PER_WING_CYCLE * FRAME_STEP_MS) / 1000;
const ACTIVE_FRAMES = [3, 6, 9, 12, 15, 18, 21];
const call = (await ausgelieferteWidgets()).call;
const ENGINE = skriptbloecke(call).find((block) => block.includes("HermesWingCanvas"));

function rundung(_schluessel, wert) {
  return typeof wert === "number" ? Math.round(wert * 1000) / 1000 : wert;
}

function mountWing(status, preset) {
  let pendingFrame = null;
  let nowMs = START_MS;
  const callLog = [];
  const recorder = new Proxy({}, {
    get(_target, name) {
      return (...args) => { callLog.push(`${String(name)}:${JSON.stringify(args, rundung)}`); };
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
  const handle = sandbox.window.HermesWingCanvas.mount(host, { status, image, size: 112, preset });
  const step = (ms = FRAME_STEP_MS) => {
    nowMs += ms;
    callLog.length = 0;
    const run = pendingFrame;
    pendingFrame = null;
    run(nowMs);
    return callLog.join("|");
  };
  return { handle, step };
}

function bildfolge(status, preset, anzahl) {
  const flug = mountWing(status, preset);
  const bilder = [];
  for (let i = 0; i < anzahl; i += 1) bilder.push(flug.step());
  return bilder;
}

test("Takt: Ring der Karte teilt sich ganzzahlig durch den Flügelzyklus", () => {
  const css = [...call.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((treffer) => treffer[1]).join("\n");
  const ring = Number(/\.ring--spin\s*\{[^}]*animation:[^;}]*?(\d+(?:\.\d+)?)s/.exec(css)[1]);
  const verhaeltnis = ring / WING_CYCLE_SEC;
  assert.ok(Math.abs(verhaeltnis - Math.round(verhaeltnis)) < 1e-9, `Ring ${ring} s, Flügel ${WING_CYCLE_SEC} s`);
});

for (const preset of ["classic", "olympian"]) {
  test(`Takt: Flügelschlag (${preset}) wiederholt sich nach genau 1,2 s`, () => {
    const bilder = bildfolge("working", preset, FRAMES_PER_WING_CYCLE + Math.max(...ACTIVE_FRAMES) + 2);
    for (const i of ACTIVE_FRAMES) {
      assert.equal(bilder[i + FRAMES_PER_WING_CYCLE], bilder[i], `Bild ${i}`);
      assert.notEqual(bilder[i + FRAMES_PER_WING_CYCLE + 1], bilder[i], `Bild ${i} versetzt`);
    }
  });
}

test("Takt: Statuswechsel startet die Zeitleiste ab dem Wechsel, nicht ab dem letzten gezeichneten Bild", () => {
  const SCHRITT_MS = 10;
  const BILDER = 6;
  const folge = (liegengeblieben) => {
    const flug = mountWing("working");
    flug.step();
    for (let i = 0; i < liegengeblieben; i += 1) flug.step(SCHRITT_MS);
    flug.handle.setStatus("connecting");
    const bilder = [];
    for (let i = 0; i < BILDER; i += 1) bilder.push(flug.step(SCHRITT_MS));
    return bilder;
  };
  const sofort = folge(0);
  const spaet = folge(3);
  assert.ok(sofort.some((bild) => bild.length > 0));
  assert.deepEqual(spaet, sofort);
});
