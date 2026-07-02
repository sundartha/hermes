// H2-S1 (Review-Blocker Runde 1): mount()-Verhalten der Wing-Canvas-Engine, das die
// Review als ungetestet markiert hat - Frame-Cap, Terminal-Stop bei success/error,
// Visibility-Gating, reduced-motion-Fallback. Fuehrt die UNVERAENDERTE Engine-Datei
// (kein Patch, anders als mcp-ui-wing-canvas-physics.test.js, das __internal braucht)
// per node:vm in einem minimalen Fake-DOM aus - dieselbe Sandbox-Technik wie in
// test/mcp-ui-w1-call-widget.test.js (dort fuer ein <script>-Fragment, hier fuer
// mount() end-to-end). Kein echter Browser, kein jsdom-Dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const enginePath = fileURLToPath(new URL("../design-system/components/brand/wing-canvas-engine.js", import.meta.url));
const ENGINE_SOURCE = readFileSync(enginePath, "utf8");

const FPS_CAP_DEFAULT = 30;
const FRAME_BUDGET_MS = 1000 / FPS_CAP_DEFAULT; // ~33.3ms, wie im Engine-Default

// rAF/cAF-Fake: die Engine haelt zu jedem Zeitpunkt hoechstens EINE ausstehende
// Anfrage (frame() plant sich entweder selbst neu oder stoppt) - ein einzelner
// Pending-Slot reicht, kein Queue-Modell noetig.
function makeRafHarness() {
  let nextId = 1;
  const pending = new Map();
  return {
    requestAnimationFrame(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      pending.delete(id);
    },
    pendingCount() {
      return pending.size;
    },
    // Feuert den (einzigen) ausstehenden Callback mit dem gegebenen now-Zeitstempel.
    // Vorher aus der Map entfernt (wie beim echten rAF), damit ein re-schedule
    // innerhalb des Callbacks sauber greift.
    fire(now) {
      const [[id, fn]] = pending;
      pending.delete(id);
      fn(now);
    },
  };
}

function makeCtx2dSpy() {
  const calls = { clearRect: 0, drawImage: 0, fillRect: 0 };
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    setTransform() {},
    clearRect() { calls.clearRect += 1; },
    drawImage() { calls.drawImage += 1; },
    fillRect() { calls.fillRect += 1; },
    fillStyle: "",
    globalCompositeOperation: "",
  };
}

function makeFakeCanvas(ctx2d) {
  return {
    style: {},
    parentNode: null,
    setAttribute() {},
    getContext() { return ctx2d; },
  };
}

function makeFakeHost() {
  return {
    children: [],
    appendChild(el) { el.parentNode = this; this.children.push(el); return el; },
    removeChild(el) { this.children = this.children.filter((c) => c !== el); el.parentNode = null; return el; },
  };
}

function makeFakeDocument(canvas) {
  let visibilityState = "visible";
  let visHandler = null;
  return {
    get visibilityState() { return visibilityState; },
    setVisibility(v) { visibilityState = v; if (visHandler) visHandler(); },
    createElement() { return canvas; },
    addEventListener(type, handler) { if (type === "visibilitychange") visHandler = handler; },
    removeEventListener(type, handler) { if (type === "visibilitychange" && visHandler === handler) visHandler = null; },
  };
}

function makeFakeImage() {
  function FakeImage() {
    this.naturalWidth = 200;
    this.naturalHeight = 400;
    this._src = "";
  }
  Object.defineProperty(FakeImage.prototype, "src", {
    get() { return this._src; },
    // echtes Image laedt asynchron - hier synchron, das Bild ist "sofort da".
    set(v) { this._src = v; if (typeof this.onload === "function") this.onload(); },
  });
  return FakeImage;
}

function makeIntersectionObserverHarness() {
  const store = { instance: null, disconnected: false };
  function FakeIntersectionObserver(callback) {
    this.callback = callback;
    store.instance = this;
  }
  FakeIntersectionObserver.prototype.observe = function () {};
  FakeIntersectionObserver.prototype.disconnect = function () { store.disconnected = true; };
  return { FakeIntersectionObserver, store };
}

// Baut eine frische Sandbox + fuehrt die Engine aus. clockRef.value steuert
// performance.now(); reduce steuert prefers-reduced-motion. Rueckgabe buendelt alle
// Spies/Handles, die die Tests fuer Build-Operate-Check brauchen (P13).
function mountInSandbox({ reduce = false, status = "idle" } = {}) {
  const raf = makeRafHarness();
  const ctx2d = makeCtx2dSpy();
  const canvas = makeFakeCanvas(ctx2d);
  const doc = makeFakeDocument(canvas);
  const host = makeFakeHost();
  const io = makeIntersectionObserverHarness();
  const clockRef = { value: 1000 };

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = doc;
  sandbox.performance = { now: () => clockRef.value };
  sandbox.devicePixelRatio = 1;
  sandbox.matchMedia = () => ({ matches: reduce });
  sandbox.Image = makeFakeImage();
  sandbox.IntersectionObserver = io.FakeIntersectionObserver;
  sandbox.requestAnimationFrame = raf.requestAnimationFrame;
  sandbox.cancelAnimationFrame = raf.cancelAnimationFrame;

  vm.createContext(sandbox);
  vm.runInContext(ENGINE_SOURCE, sandbox);

  const handle = sandbox.window.HermesWingCanvas.mount(host, { src: "data:image/png;base64,x", status });

  return { handle, raf, ctx2d, canvas, doc, host, io, clockRef };
}

test("T-wing-mount-canvas: Canvas wird sofort dimensioniert, unabhaengig vom Bild-Load", () => {
  const { canvas } = mountInSandbox();
  assert.equal(canvas.width, 112, "DEFAULT_SIZE_PX * dpr(1)");
  assert.equal(canvas.height, 112);
  assert.equal(canvas.style.width, "112px");
});

test("T-wing-mount-framecap: Frames unterhalb des Budgets werden uebersprungen, keine Neu-Zeichnung", () => {
  const { raf, ctx2d, clockRef } = mountInSandbox();
  assert.equal(raf.pendingCount(), 1, "nach mount() laeuft die Schleife bereits (Bild synchron geladen)");

  // Zwei kleine Schritte, jeder klar unter dem Frame-Budget (~33.3ms).
  clockRef.value += 10;
  raf.fire(clockRef.value);
  assert.equal(ctx2d.calls.clearRect, 0, "1. Schritt (10ms) < Budget -> kein Render");
  assert.equal(raf.pendingCount(), 1, "aber die Schleife plant sich neu");

  clockRef.value += 10;
  raf.fire(clockRef.value);
  assert.equal(ctx2d.calls.clearRect, 0, "2. Schritt (kumuliert 20ms) < Budget -> immer noch kein Render");

  // Dritter Schritt schiebt den Akkumulator ueber das Budget.
  clockRef.value += 15;
  raf.fire(clockRef.value);
  assert.equal(ctx2d.calls.clearRect, 1, "kumuliert 35ms >= Budget -> jetzt wird gezeichnet");
});

test("T-wing-mount-terminal: success/error stoppen die Schleife, sobald die Timeline fertig ist", () => {
  const { raf, clockRef } = mountInSandbox({ status: "success" });
  assert.equal(raf.pendingCount(), 1, "Loop startet fuer den success-Status");

  // buildSuccess dauert 0.6s; dt ist pro Frame auf TAB_SWITCH_DT_CAP_SEC=0.1s
  // gekappt, also reichen mehrere 100ms-Schritte, um die Timeline abzuschliessen.
  let iterations = 0;
  while (raf.pendingCount() > 0 && iterations < 20) {
    clockRef.value += 100;
    raf.fire(clockRef.value);
    iterations += 1;
  }
  assert.equal(raf.pendingCount(), 0, "Terminal-Stop: keine weitere rAF-Anfrage nach Timeline-Ende");
  assert.ok(iterations < 20, "Timeline ist tatsaechlich fertig geworden, nicht die Schleifen-Grenze erreicht");
});

test("T-wing-mount-visibility: IntersectionObserver-Wechsel stoppt/startet die Schleife", () => {
  const { raf, io } = mountInSandbox();
  assert.equal(raf.pendingCount(), 1, "sichtbar + on-screen -> Loop laeuft");

  io.store.instance.callback([{ isIntersecting: false }]);
  assert.equal(raf.pendingCount(), 0, "aus dem Sichtfeld -> Loop gestoppt (cancelAnimationFrame)");

  io.store.instance.callback([{ isIntersecting: true }]);
  assert.equal(raf.pendingCount(), 1, "zurueck im Sichtfeld -> Loop startet erneut");
});

test("T-wing-mount-visibility: Tab-Wechsel (visibilitychange) stoppt/startet die Schleife", () => {
  const { raf, doc } = mountInSandbox();
  assert.equal(raf.pendingCount(), 1);

  doc.setVisibility("hidden");
  assert.equal(raf.pendingCount(), 0, "Tab im Hintergrund -> Loop gestoppt");

  doc.setVisibility("visible");
  assert.equal(raf.pendingCount(), 1, "Tab wieder im Vordergrund -> Loop startet erneut");
});

test("T-wing-mount-reduced-motion: statische Ruhepose, KEINE rAF-Schleife, kein IntersectionObserver", () => {
  const { raf, ctx2d, io, handle } = mountInSandbox({ reduce: true, status: "working" });
  assert.equal(raf.pendingCount(), 0, "reduced motion -> nie eine rAF-Anfrage");
  assert.equal(ctx2d.calls.clearRect, 1, "genau EIN statisches Render der Ruhepose");
  assert.equal(io.store.instance, null, "IntersectionObserver wird bei reduced motion gar nicht erst erstellt");

  // Ein Status-Wechsel bleibt weiterhin im statischen Pfad (keine Schleife startet nachtraeglich).
  handle.setStatus("success");
  assert.equal(raf.pendingCount(), 0, "auch nach setStatus() keine Schleife bei reduced motion");
  assert.equal(ctx2d.calls.clearRect, 2, "erneutes statisches Render nach dem Status-Wechsel");
});

test("T-wing-mount-destroy: raeumt Loop, Observer und Canvas auf", () => {
  const { raf, io, handle, canvas, host } = mountInSandbox();
  assert.equal(host.children.includes(canvas), true, "Canvas haengt im Host");
  handle.destroy();
  assert.equal(raf.pendingCount(), 0, "destroy() stoppt eine laufende Schleife");
  assert.equal(io.store.disconnected, true, "IntersectionObserver wird disconnected");
  assert.equal(host.children.includes(canvas), false, "Canvas wird aus dem Host entfernt");
});
