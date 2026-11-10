import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const BILD = 224;
const START_MS = 1000;
const SCHRITT_MS = 16.7;
const SCHRITTE = 40;
const WIDGETS = await ausgelieferteWidgets();
const ENGINE = skriptbloecke(WIDGETS.call).find((block) => block.includes("HermesWingCanvas") && block.includes("FPS_CAP_DEFAULT"));

function letztesBild(dpr) {
  let aufrufe = [];
  let pendingFrame = null;
  const recorder = new Proxy({}, {
    get(_target, name) {
      if (name === "getImageData") return () => ({ data: new Uint8ClampedArray(BILD * BILD * 4).fill(255) });
      return (...args) => {
        if (name === "clearRect") aufrufe = [];
        aufrufe.push({ name, args });
      };
    },
    set() { return true; },
  });
  const canvas = { style: {}, parentNode: null, setAttribute() {}, getContext: () => recorder };
  const sandbox = {
    document: { visibilityState: "visible", createElement: () => canvas, addEventListener() {}, removeEventListener() {} },
    performance: { now: () => START_MS },
    devicePixelRatio: dpr,
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    requestAnimationFrame: (fn) => { pendingFrame = fn; return 1; },
    cancelAnimationFrame() { pendingFrame = null; },
  };
  sandbox.window = sandbox;
  sandbox.process = process;
  vm.createContext(sandbox);
  vm.runInContext(ENGINE, sandbox);
  const host = { appendChild: (el) => el, removeChild: (el) => el, ownerDocument: sandbox.document };
  const image = { complete: true, naturalWidth: BILD, naturalHeight: BILD };
  sandbox.window.HermesWingCanvas.mount(host, { status: "working", image, size: 112, fpsCap: 60 });
  let jetzt = START_MS;
  for (let i = 0; i < SCHRITTE; i++) {
    jetzt += SCHRITT_MS;
    const run = pendingFrame;
    pendingFrame = null;
    run(jetzt);
  }
  return aufrufe
    .map((aufruf, nr) => (aufruf.name === "drawImage" && aufruf.args.length === 9 ? aufrufe[nr - 1].args : null))
    .filter(Boolean);
}

test("T-fluegel-zeichnung-schlag: schlaegt der Fluegel, waechst die Abbildung jedes Dreiecks einschliesslich der Scherglieder mit der Pixeldichte", () => {
  const einfach = letztesBild(1);
  const doppelt = letztesBild(2);
  assert.equal(doppelt.length, einfach.length);
  assert.ok(einfach.length > 0);
  const geschert = einfach.filter((matrix) => Math.abs(matrix[1]) > 1e-3 && Math.abs(matrix[2]) > 1e-3);
  assert.ok(geschert.length > 0, "mindestens ein Dreieck hat b und c ungleich 0");
  einfach.forEach((matrix, nr) => matrix.forEach((wert, i) => {
    assert.ok(Math.abs(doppelt[nr][i] - 2 * wert) < 1e-6, `Dreieck ${nr} Eintrag ${i}: ${doppelt[nr][i]} statt ${2 * wert}`);
  }));
});
