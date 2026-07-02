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

// H2-S1 (Review-Blocker Runde 2): applyGoldTint() ist ueber mount() nur erreichbar,
// wenn GOLD_ENABLED im Quelltext true ist (Owner-Gate). Dieselbe Patch-Technik wie
// mcp-ui-wing-canvas-physics.test.js (EXPORT_LINE) - hier wird NUR die eigene
// In-Memory-Kopie der Quelle fuer diesen einen Test umgeschaltet, die produktiv
// ausgelieferte Datei bleibt unveraendert.
const GOLD_ENABLED_LINE = "  var GOLD_ENABLED = false; // Owner-Gate auf Quell-Ebene";
const GOLD_ENABLED_LINE_PATCHED = "  var GOLD_ENABLED = true; // Owner-Gate auf Quell-Ebene (Test-Patch)";
assert.ok(ENGINE_SOURCE.includes(GOLD_ENABLED_LINE), "GOLD_ENABLED-Zeile nicht gefunden - Datei umstrukturiert?");
const ENGINE_SOURCE_GOLD_ENABLED = ENGINE_SOURCE.replace(GOLD_ENABLED_LINE, GOLD_ENABLED_LINE_PATCHED);

// H2-S1 (Review-Blocker Runde 3, T1): applyStatus()s Preset-Switch (tl = preset ===
// "olympian" ? olympianCycle : classicCycle) laeuft komplett innerhalb der mount()-
// Closure - der zurueckgegebene Handle exponiert nur setStatus/destroy, kein Zugriff
// auf den internen state. Gleiche Patch-Technik wie GOLD_ENABLED_LINE oben: NUR die
// eigene In-Memory-Kopie der Quelle haengt eine __debugState-Referenz an den
// mount()-Rueckgabewert, die produktiv ausgelieferte Datei bleibt unveraendert. state
// ist eine einzige, nie neu zugewiesene Objekt-Referenz pro Instanz (siehe
// "var state = restState()" in mount()) - die Timeline mutiert sie in place,
// __debugState.beat liest also live mit.
const RETURN_HANDLE_LINE = "      setStatus: requestStatus,";
const RETURN_HANDLE_LINE_PATCHED = "      setStatus: requestStatus, __debugState: state, // Test-Patch (H2-S1 Runde 3)";
assert.ok(ENGINE_SOURCE.includes(RETURN_HANDLE_LINE), "setStatus-Return-Zeile nicht gefunden - Datei umstrukturiert?");
const ENGINE_SOURCE_DEBUG_STATE = ENGINE_SOURCE.replace(RETURN_HANDLE_LINE, RETURN_HANDLE_LINE_PATCHED);

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
  // fillRectFillStyle/fillRectComposite: Momentaufnahme von fillStyle/
  // globalCompositeOperation ZUM ZEITPUNKT des fillRect()-Aufrufs (nicht der
  // Endzustand danach) - noetig, um applyGoldTint()s source-atop-Compositing zu
  // pruefen, das die Engine direkt nach dem Fill wieder auf source-over zuruecksetzt.
  const calls = { clearRect: 0, drawImage: 0, fillRect: 0, fillRectFillStyle: null, fillRectComposite: null };
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    setTransform() {},
    clearRect() { calls.clearRect += 1; },
    drawImage() { calls.drawImage += 1; },
    fillRect() {
      calls.fillRect += 1;
      calls.fillRectFillStyle = this.fillStyle;
      calls.fillRectComposite = this.globalCompositeOperation;
    },
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
// performance.now(); reduce steuert prefers-reduced-motion; source erlaubt eine
// gepatchte Engine-Quelle (siehe ENGINE_SOURCE_GOLD_ENABLED); gold wird 1:1 als
// opts.gold an mount() durchgereicht. Rueckgabe buendelt alle Spies/Handles, die
// die Tests fuer Build-Operate-Check brauchen (P13).
// preset/size/grid/fpsCap: 1:1 an opts.* durchgereicht (undefined -> Engine-Default
// greift, wie bei opts.size||DEFAULT_SIZE_PX etc.). dpr steuert sandbox.devicePixelRatio
// separat von reduce/status (H2-S1 Runde 3, T1: fuer die Nicht-Default-Options-Tests).
function mountInSandbox({
  reduce = false, status = "idle", source = ENGINE_SOURCE, gold = false,
  preset, size, grid, fpsCap, dpr = 1,
} = {}) {
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
  sandbox.devicePixelRatio = dpr;
  sandbox.matchMedia = () => ({ matches: reduce });
  sandbox.Image = makeFakeImage();
  sandbox.IntersectionObserver = io.FakeIntersectionObserver;
  sandbox.requestAnimationFrame = raf.requestAnimationFrame;
  sandbox.cancelAnimationFrame = raf.cancelAnimationFrame;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  const handle = sandbox.window.HermesWingCanvas.mount(host, {
    src: "data:image/png;base64,x", status, gold, preset, size, grid, fpsCap,
  });

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

test("T-wing-mount-gold: GOLD_ENABLED(Quell-Patch)+opts.gold=true zeichnet genau einen Gold-Tint-Layer (H2-S1)", () => {
  const { raf, ctx2d, clockRef } = mountInSandbox({ source: ENGINE_SOURCE_GOLD_ENABLED, gold: true });
  assert.equal(raf.pendingCount(), 1, "Loop laeuft (idle-Status, kein reduced motion)");

  // Klar ueber dem Frame-Budget (~33.3ms), Sicherheitsmarge wie im framecap-Test oben.
  clockRef.value += FRAME_BUDGET_MS + 5;
  raf.fire(clockRef.value);

  assert.equal(ctx2d.calls.fillRect, 1, "applyGoldTint() zeichnet genau einen Fill-Layer pro Render");
  assert.equal(
    ctx2d.calls.fillRectFillStyle,
    "rgba(230,190,92,0.350)",
    "fillStyle = HERMES_GOLD als rgb-Tripel + goldTintAlpha (idle-Settle-Phase: flap/lift=0 -> Basis-Alpha GOLD_STRENGTH)",
  );
  assert.equal(ctx2d.calls.fillRectComposite, "source-atop", "der Fill laeuft mit source-atop, faerbt also nur bereits gezeichnete Wing-Pixel");
  assert.equal(ctx2d.globalCompositeOperation, "source-over", "Composite-Mode wird nach dem Tint wieder zurueckgesetzt");
});

test("T-wing-mount-gold-gated: GOLD_ENABLED=false (Produktions-Default) ignoriert opts.gold=true", () => {
  const { raf, ctx2d, clockRef } = mountInSandbox({ gold: true }); // ungepatchte Quelle, GOLD_ENABLED bleibt false
  clockRef.value += FRAME_BUDGET_MS + 5;
  raf.fire(clockRef.value);
  assert.equal(ctx2d.calls.fillRect, 0, "Owner-Gate auf Quell-Ebene sperrt applyGoldTint(), unabhaengig von opts.gold");
});

// H2-S1 (Review-Blocker Runde 3, T1): der Preset-Switch in applyStatus() -
// tl = (preset === "olympian" ? olympianCycle : classicCycle)(state, ...) - war ueber
// die public API unverifiziert. Beobachtungspunkt: state.beat wird von KEINEM Tween in
// classicCycle je angefasst (nur die initiale .set(..., {beat:0,...})); olympianCycle
// dagegen tweent beat schon im allerersten Schritt (0 -> -1.0 ueber 0.18s). Ein
// vertauschtes Ternary wuerde also GENAU in dem Preset, das eigentlich olympian laeuft,
// beat auf 0 halten (bzw. umgekehrt bei classic beat!=0 liefern) - beide Tests unten
// werden dann ROT.
test("T-wing-mount-preset-olympian: preset='olympian' fuehrt olympianCycle aus (beat-Kanal wird animiert)", () => {
  const { handle, raf, clockRef } = mountInSandbox({
    source: ENGINE_SOURCE_DEBUG_STATE, preset: "olympian", status: "working",
  });
  assert.equal(raf.pendingCount(), 1, "working-Loop laeuft");

  clockRef.value += 100; // ein Frame reicht: olympianCycle tweent beat schon im ersten Schritt
  raf.fire(clockRef.value);

  assert.notEqual(
    handle.__debugState.beat, 0,
    "olympianCycle ist der einzige Zyklus, der den beat-Kanal ueberhaupt tweent",
  );
});

test("T-wing-mount-preset-classic: preset='classic' fuehrt classicCycle aus (beat-Kanal bleibt 0)", () => {
  const { handle, raf, clockRef } = mountInSandbox({
    source: ENGINE_SOURCE_DEBUG_STATE, preset: "classic", status: "working",
  });
  assert.equal(raf.pendingCount(), 1, "working-Loop laeuft");

  clockRef.value += 100;
  raf.fire(clockRef.value);

  assert.equal(
    handle.__debugState.beat, 0,
    "classicCycle setzt beat nur per .set() auf 0 zurueck, tweent es nie",
  );
});

test("T-wing-mount-terminal-error: status='error' stoppt die Schleife, sobald die Timeline fertig ist", () => {
  const { raf, clockRef } = mountInSandbox({ status: "error" });
  assert.equal(raf.pendingCount(), 1, "Loop startet fuer den error-Status");

  // buildError dauert 0.45s (4x 0.05s Zittern + 0.25s Rueckfeder); dt ist pro Frame auf
  // TAB_SWITCH_DT_CAP_SEC=0.1s gekappt, mehrere 100ms-Schritte reichen zum Abschluss.
  let iterations = 0;
  while (raf.pendingCount() > 0 && iterations < 20) {
    clockRef.value += 100;
    raf.fire(clockRef.value);
    iterations += 1;
  }
  assert.equal(raf.pendingCount(), 0, "Terminal-Stop: keine weitere rAF-Anfrage nach Timeline-Ende");
  assert.ok(iterations < 20, "Timeline ist tatsaechlich fertig geworden, nicht die Schleifen-Grenze erreicht");
});

test("T-wing-mount-options: Nicht-Default size/grid/fpsCap werden uebernommen (H2-S1 Runde 3, T1c)", () => {
  const grid = { x: 2, y: 3 }; // bewusst grob abweichend von beiden Defaults (8x12 grob / 16x24 fein)
  const { canvas, ctx2d, raf, clockRef } = mountInSandbox({ size: 200, grid, fpsCap: 5, dpr: 3 });

  // Canvas-Dimension: size * min(devicePixelRatio, DPR_CAP=2) -> 200*2=400, NICHT 200*3=600.
  assert.equal(canvas.width, 400, "DPR wird bei DPR_CAP=2 gekappt statt die volle devicePixelRatio(3) zu uebernehmen");
  assert.equal(canvas.height, 400);
  assert.equal(canvas.style.width, "200px", "CSS-Groesse folgt der logischen size, nicht der physischen Canvas-Dimension");

  assert.equal(raf.pendingCount(), 1, "Loop laeuft (idle-Status, kein reduced motion)");

  // fpsCap=5 -> Budget 200ms; TAB_SWITCH_DT_CAP_SEC kappt jeden einzelnen Schritt auf
  // 100ms, ein einzelner Schritt kann das Budget also gar nicht erreichen (anders als der
  // Default-Cap 30 mit 33ms-Budget, der schon nach einem 100ms-Schritt rendern wuerde) -
  // das unterscheidet den konfigurierten Cap sauber vom (ignorierten) Default.
  clockRef.value += 100;
  raf.fire(clockRef.value);
  assert.equal(ctx2d.calls.clearRect, 0, "1. Schritt (100ms) < konfiguriertes Budget (200ms) -> kein Render");

  clockRef.value += 100;
  raf.fire(clockRef.value);
  assert.equal(ctx2d.calls.clearRect, 1, "kumuliert 200ms >= konfiguriertes Budget -> jetzt wird gezeichnet");

  // Gitter: grid.x=2 * grid.y=3 Zellen * 2 Dreiecke/Zelle = 12 drawImage-Aufrufe.
  assert.equal(ctx2d.calls.drawImage, 12, "explizites Gitter wurde uebernommen, nicht defaultGrid(size=200)=GRID_FINE(16x24)");
});
