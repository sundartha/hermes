import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const FRAME_STEP_MS = 40;
const START_MS = 1000;
const FRAMES_PER_WING_CYCLE = 30;
const ACTIVE_FRAMES = [3, 6, 9, 12, 15, 18, 21];
const call = (await ausgelieferteWidgets()).call;
const ENGINE = skriptbloecke(call).find((block) => block.includes("HermesWingCanvas"));

function rundung(_schluessel, wert) {
  return typeof wert === "number" ? Math.round(wert * 1000) / 1000 : wert;
}

const REFERENZ = readFileSync(new URL("../../design-system/components/brand/wing-canvas-engine.js", import.meta.url), "utf8");

function mountWing(status, preset, quelle = ENGINE) {
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
  vm.runInContext(quelle, sandbox);
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

function folge(flug, anzahl) {
  const bilder = [];
  for (let i = 0; i < anzahl; i += 1) bilder.push(flug.step());
  return bilder;
}

function bildfolge(status, preset, anzahl) {
  return folge(mountWing(status, preset), anzahl);
}

function referenzfolge(preset, anzahl) {
  return folge(mountWing("working", preset, REFERENZ), anzahl);
}

test("Takt: die Anrufkarte des Neuentwurfs hat keinen drehenden Ring mehr, der Flügel allein gibt den Takt", () => {
  const css = [...call.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((treffer) => treffer[1]).join("\n");
  assert.doesNotMatch(css, /\.ring--spin|hermesRingSpin/);
  assert.doesNotMatch(call, /<[a-z][^>]*data-ring/);
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

const MITTE_IM_SCHLAG = 6;
const BILDER_BIS_MITTE = MITTE_IM_SCHLAG + 1;

test("Preset: die ausgelieferte Engine zeichnet klassisch und olympian wie die Referenz-Engine", () => {
  for (const preset of ["classic", "olympian"]) {
    assert.deepEqual(bildfolge("working", preset, BILDER_BIS_MITTE), referenzfolge(preset, BILDER_BIS_MITTE), preset);
  }
});

test("Preset: klassisch und olympian zeichnen mitten im Schlag verschieden", () => {
  const klassisch = bildfolge("working", "classic", BILDER_BIS_MITTE);
  const olympisch = bildfolge("working", "olympian", BILDER_BIS_MITTE);
  assert.notEqual(olympisch[MITTE_IM_SCHLAG], klassisch[MITTE_IM_SCHLAG]);
});

test("Preset: die Anrufkarte mountet ohne preset und zeigt die klassische Zeichnung", () => {
  const mountAufruf = /HermesWingCanvas\.mount\([^;]*\)/.exec(call)[0];
  assert.doesNotMatch(mountAufruf, /preset/);
  const ohne = bildfolge("working", undefined, BILDER_BIS_MITTE);
  const klassischReferenz = referenzfolge("classic", BILDER_BIS_MITTE);
  assert.deepEqual(ohne, klassischReferenz);
});
