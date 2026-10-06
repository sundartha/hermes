import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const enginePath = fileURLToPath(new URL("../design-system/components/brand/wing-canvas-engine.js", import.meta.url));

const EXPORT_LINE = "  window.HermesWingCanvas = { mount: mount };";
const INTERNAL_NAMES = [
  "smoothstep", "buildWeights", "deform",
  "restState", "REST_CHANNELS",
  "powerEase", "sineEase", "elasticOut", "parseEase",
  "Timeline", "timeline", "tweenProgress",
  "classicCycle", "olympianCycle",
  "buildIdle", "buildConnecting", "buildSuccess", "buildError",
  "hexToRgb", "defaultGrid", "buildDeformContext", "goldTintAlpha",
];
const EXPORT_LINE_WITH_INTERNAL =
  "  window.HermesWingCanvas = { mount: mount, __internal: { " +
  INTERNAL_NAMES.map((n) => `${n}: ${n}`).join(", ") +
  " } };";

function loadInternal() {
  const source = readFileSync(enginePath, "utf8");
  assert.ok(source.includes(EXPORT_LINE), "Export-Zeile nicht gefunden - Datei umstrukturiert?");
  const patched = source.replace(EXPORT_LINE, EXPORT_LINE_WITH_INTERNAL);
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox);
  return sandbox.window.HermesWingCanvas.__internal;
}

const I = loadInternal();

test("T-wing-physics-smoothstep: klemmt an den Raendern, Mittelpunkt=0.5 (G3 Grenzfaelle)", () => {
  assert.equal(I.smoothstep(0, 1, -5), 0, "unterhalb e0 -> 0");
  assert.equal(I.smoothstep(0, 1, 5), 1, "oberhalb e1 -> 1");
  assert.equal(I.smoothstep(0, 1, 0), 0, "genau e0 -> 0");
  assert.equal(I.smoothstep(0, 1, 1), 1, "genau e1 -> 1");
  assert.equal(I.smoothstep(0, 1, 0.5), 0.5, "Mittelpunkt bleibt 0.5");
});

test("T-wing-physics-buildWeights: Wurzel-Punkt Gewicht 0, entferntester Punkt Gewicht 1", () => {
  const original = new Float32Array([0, 0, 10, 0, 20, 0, 30, 0]);
  const { weights, weightsTip } = I.buildWeights(original, 0, 0);
  assert.equal(weights[0], 0, "Punkt AUF der Wurzel -> Gewicht 0 (unabhaengig vom Exponenten)");
  assert.equal(weightsTip[0], 0, "Wurzel-Punkt liegt klar unter der Tip-Band-Schwelle -> 0");
  assert.equal(weights[3], 1, "am weitesten entfernter Punkt -> Gewicht exakt 1 (auf 1 geklemmt)");
  assert.equal(weightsTip[3], 1, "gleiches gilt fuer die Tip-Gewichtung");
  assert.ok(weights[1] < weights[2] && weights[2] < weights[3], "Gewicht waechst monoton mit dem Abstand");
});

test("T-wing-physics-deform: restState() ist eine Identitaets-Transformation", () => {
  const original = new Float32Array([5, 7, -3, 12]);
  const ctx = {
    original,
    rootX: 1, rootY: 2,
    weights: new Float32Array([0.4, 0.9]),
    weightsTip: new Float32Array([0.1, 0.8]),
  };
  const out = new Float32Array(4);
  I.deform(ctx, I.restState(), out);
  assert.deepEqual(Array.from(out), Array.from(original), "ohne Bewegung (alle Kanaele 0) bleiben die Punkte unveraendert");
});

test("T-wing-physics-deform: hoeheres Gewicht -> staerkere Auslenkung bei gleichem flap-Kanal", () => {
  const original = new Float32Array([0, 0, 0, 100]);
  const ctx = {
    original, rootX: 0, rootY: 0,
    weights: new Float32Array([0, 1]), weightsTip: new Float32Array([0, 1]),
  };
  const state = { ...I.restState(), flap: 1 };
  const out = new Float32Array(4);
  I.deform(ctx, state, out);
  assert.deepEqual([out[0], out[1]], [0, 0], "Punkt mit Gewicht 0 bleibt an der Wurzel stehen");
  assert.notDeepEqual([out[2], out[3]], [0, 100], "Punkt mit Gewicht 1 wird durch flap ausgelenkt");
});

test("T-wing-physics-restChannels: REST_CHANNELS deckt genau die per Status-Timeline zurueckgesetzten Kanaele ab", () => {
  assert.deepEqual(
    Object.keys(I.REST_CHANNELS).sort(),
    ["bend", "compression", "flap", "lift", "tipLag"].sort(),
    "beat/rootRotation/intensity/speed werden separat behandelt, nicht ueber REST_CHANNELS",
  );
});

test("T-wing-physics-elasticOut: t=0 und t=1 sind exakte Fixpunkte (G3 Grenzfaelle)", () => {
  const ease = I.elasticOut(1, 0.3);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
});

test("T-wing-physics-easings: power/sine (in/out/inOut) sind bei p=0/p=1 exakt 0/1", () => {
  for (const fam of [I.powerEase(3, "in"), I.powerEase(3, "out"), I.powerEase(3, "inOut"),
                      I.sineEase("in"), I.sineEase("out"), I.sineEase("inOut")]) {
    assert.ok(Math.abs(fam(0)) < 1e-9, "p=0 -> ~0");
    assert.ok(Math.abs(fam(1) - 1) < 1e-9, "p=1 -> ~1");
  }
});

test("T-wing-physics-parseEase: benannte Eases + elastic-Regex + unbekannt/leer -> Identitaet", () => {
  assert.equal(I.parseEase("power2.out")(0.5), I.powerEase(3, "out")(0.5), "power2 -> Exponent 3");
  assert.equal(I.parseEase("sine.inOut")(0.3), I.sineEase("inOut")(0.3));
  assert.equal(
    I.parseEase("elastic.out(1,0.4)")(0.5),
    I.elasticOut(1, 0.4)(0.5),
    "elastic.out(amp,period) wird korrekt aus dem String extrahiert",
  );
  assert.equal(I.parseEase("")(0.42), 0.42, "leer -> Identitaet");
  assert.equal(I.parseEase(undefined)(0.42), 0.42, "undefined -> Identitaet");
  assert.equal(I.parseEase("mystery.out")(0.42), 0.42, "unbekannte Familie -> Identitaet");
});

test("T-wing-physics-timeline-resolve: Positions-Syntax (Zahl/<//-=/+=/undefined)", () => {
  const target = { x: 0 };
  const tl = new I.Timeline();
  assert.equal(tl._resolve(undefined), 0, "undefined -> aktueller cursor (anfangs 0)");
  tl.to(target, { x: 1, duration: 2 });
  assert.equal(tl.cursor, 2, "cursor wandert auf start+duration");
  assert.equal(tl._resolve(undefined), 2, "undefined -> neuer cursor");
  assert.equal(tl._resolve("<"), 0, "'<' -> Start des zuletzt hinzugefuegten Tweens");
  assert.equal(tl._resolve("-=0.5"), 1.5, "'-=x' -> cursor - x");
  assert.equal(tl._resolve("+=0.5"), 2.5, "'+=x' -> cursor + x");
  assert.equal(tl._resolve(5), 5, "absolute Zahl bleibt unveraendert");
  assert.equal(tl._resolve("0.75"), 0.75, "numerischer String ohne Praefix wird geparst");
});

test("T-wing-physics-timeline-set: duration=0 wendet Endwerte sofort an (0-Werte, G3)", () => {
  const target = { x: 0 };
  const tl = new I.Timeline();
  tl.set(target, { x: 5 });
  tl.play(0);
  tl.step(0);
  assert.equal(target.x, 5, ".set() greift sofort bei lt=0, keine Interpolation");
});

test("T-wing-physics-timeline-step: linearer .to() interpoliert ueber duration (identitaets-ease)", () => {
  const target = { x: 0 };
  const tl = new I.Timeline();
  tl.to(target, { x: 10, duration: 2 });
  tl.play(0);
  tl.step(1);
  assert.equal(target.x, 5, "nach der Haelfte der duration -> Haelfte des Wegs");
  tl.step(1);
  assert.equal(target.x, 10, "nach voller duration -> Endwert erreicht");
});

test("T-wing-physics-tweenProgress: repeat-Arithmetik klemmt an der letzten Iteration", () => {
  const t = { repeat: 2, duration: 1, repeatDelay: 0, yoyo: false };
  assert.equal(I.tweenProgress(t, 0), 0);
  assert.equal(I.tweenProgress(t, 0.5), 0.5);
  assert.equal(I.tweenProgress(t, 3), 1, "local jenseits von repeat*period -> auf letzte Iteration geklemmt (iter>repeat)");
});

test("T-wing-physics-tweenProgress: yoyo spiegelt den Fortschritt in ungeraden Iterationen", () => {
  const t = { repeat: 2, duration: 1, repeatDelay: 0, yoyo: true };
  assert.equal(I.tweenProgress(t, 1), 1, "Uebergang in Iteration 1 (gespiegelt) startet bei Fortschritt 1");
  assert.equal(I.tweenProgress(t, 1.5), 0.5, "Iteration 1 (gespiegelt) laeuft rueckwaerts");
});

test("T-wing-physics-tweenProgress: repeatDelay haelt die Endpose (kein Zurueckspringen)", () => {
  const t = { repeat: 1, duration: 0.5, repeatDelay: 0.2, yoyo: false };
  assert.equal(I.tweenProgress(t, 0.6), 1, "0.6s liegt in der repeatDelay-Pause nach der ersten duration -> Endpose haelt");
});

test("T-wing-physics-presets: classicCycle/olympianCycle liefern endliche, wiederholende Timelines", () => {
  for (const buildFn of [I.classicCycle, I.olympianCycle]) {
    const state = I.restState();
    const tl = buildFn(state, 0.12);
    assert.equal(tl.repeat, -1, "Arbeits-Loop wiederholt unendlich");
    assert.equal(tl.repeatDelay, 0.12, "Pause zwischen Zyklen wird durchgereicht");
    assert.ok(tl.iterationDuration() > 0, "eine Iteration hat eine endliche Dauer");
  }
});

test("T-wing-physics-status-timelines: buildSuccess/buildError enden endlich (kein repeat)", () => {
  const successState = I.restState();
  const success = I.buildSuccess(successState);
  assert.ok(Math.abs(success.iterationDuration() - 0.6) < 1e-9, "buildSuccess: 0.1s Peak + 0.5s Rueckfeder = 0.6s");

  const errorState = I.restState();
  const error = I.buildError(errorState);
  assert.ok(error.iterationDuration() > 0, "buildError hat eine endliche Dauer");
});

test("T-wing-physics-hexToRgb: #e6be5c (HERMES_GOLD) -> 230,190,92", () => {
  assert.equal(I.hexToRgb("#e6be5c"), "230,190,92");
  assert.equal(I.hexToRgb("#ffffff"), "255,255,255");
  assert.equal(I.hexToRgb("#000000"), "0,0,0");
});

test("T-wing-physics-defaultGrid: Groessen-Schwelle exakt bei COARSE_MAX_SIZE_PX=96 (G3)", () => {
  const coarse = I.defaultGrid(96);
  assert.equal(coarse.x, 8, "96 -> genau an der Schwelle -> coarse.x");
  assert.equal(coarse.y, 12, "96 -> genau an der Schwelle -> coarse.y");
  const fine = I.defaultGrid(97);
  assert.equal(fine.x, 16, "97 -> ueber der Schwelle -> fine.x");
  assert.equal(fine.y, 24, "97 -> ueber der Schwelle -> fine.y");
});

test("T-wing-physics-goldTintAlpha: negativer Puls kann die Basis-Alpha nicht unterschreiten, hoher Puls klemmt bei 1", () => {
  const base = I.goldTintAlpha({ flap: 0, lift: 0 });
  assert.ok(base > 0 && base < 1, "Basis-Alpha ist ein plausibler Bruchteil");
  assert.equal(I.goldTintAlpha({ flap: -50, lift: -50 }), base, "negativer Puls wird auf 0 geklemmt, nicht auf Basis addiert");
  assert.equal(I.goldTintAlpha({ flap: 50, lift: 0 }), 1, "grosser Puls -> Alpha klemmt bei 1");
});

test("T-wing-physics-buildDeformContext: Gitter/Wurzel-Koordinaten aus Bildmassen + DEFAULT_ROOT", () => {
  const fakeImg = { naturalWidth: 100, naturalHeight: 200 };
  const dctx = I.buildDeformContext(fakeImg, { x: 2, y: 2 });
  assert.equal(dctx.cols, 3, "grid.x=2 -> 3 Spalten Vertices");
  assert.equal(dctx.rows, 3, "grid.y=2 -> 3 Zeilen Vertices");
  assert.equal(dctx.original[0], 0, "erster Vertex liegt bei (0,0)");
  assert.equal(dctx.original[dctx.original.length - 2], 100, "letzter Vertex.x = imgW");
  assert.equal(dctx.original[dctx.original.length - 1], 200, "letzter Vertex.y = imgH");
  assert.equal(dctx.rootX, 23, "rootX = DEFAULT_ROOT.x(0.23) * imgW(100)");
  assert.equal(dctx.rootY, 176, "rootY = DEFAULT_ROOT.y(0.88) * imgH(200)");
  assert.notEqual(dctx.live, dctx.original, "live ist eine unabhaengige Kopie (slice), keine Referenz");
  assert.deepEqual(Array.from(dctx.live), Array.from(dctx.original), "live startet aber wertgleich zu original");
});
