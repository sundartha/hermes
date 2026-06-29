// Hermes-Wing-Engine fuer die Live-Seite: EIN gefiederter Fluegel als
// deformierbarer Pixi-MeshPlane (16x24), getrieben von einer GSAP-Bewegung.
// Renderzt in ein transparentes <canvas>. KEINE Klone, Spiegelungen, Trails
// oder zweiten Ebenen (Owner-Prinzip).
//
// Portiert aus design-system/components/brand/wing-engine.js (selbst ein
// Browser-Port von apps/hermes-animation-lab) — identische Geometrie, Gains,
// Presets und Status-Timelines. EINZIGER Unterschied: pixi.js + gsap werden
// als echte, gebuendelte Deps importiert (NICHT als window-Globals vom CDN
// nachgeladen). Grund: die Produktions-CSP des Static-Service ist strikt
// (default-src 'self') und verbietet CDN-Scripts und data:-URLs; Vite emittiert
// den Bundle same-origin -> CSP-konform. Die Textur kommt als same-origin PNG.

import { Application, Container, MeshPlane, Texture } from "pixi.js";
import { gsap } from "gsap";

// --- Geometrie / Gains (aus HermesWing.ts + deform.ts) ---------------------
// Sichtbare Fluegel-Bounding-Box in Textur-Pixeln (Alpha-Analyse der 500x500-
// Quelle). Dient dem passgenauen Zentrieren und der uniformen Skalierung.
const WING_BBOX = { minX: 97, maxX: 404, minY: 21, maxY: 455 };
const WING_CENTER_X = (WING_BBOX.minX + WING_BBOX.maxX) / 2;
const WING_CENTER_Y = (WING_BBOX.minY + WING_BBOX.maxY) / 2;
const WING_FIT =
  Math.max(WING_BBOX.maxX - WING_BBOX.minX, WING_BBOX.maxY - WING_BBOX.minY) /
  0.92;
// Wurzelpunkt (Schulter) als Anteil der Texturkante: unten-links, dort dreht
// der Fluegel -> Rotation liest sich als Schlag um die Schulter.
const DEFAULT_ROOT = { x: 0.23, y: 0.88 };
const SEGMENTS_X = 16;
const SEGMENTS_Y = 24;
// Hub in Textur-Pixeln pro Einheit `lift` (Schweben hebt den ganzen Fluegel).
const LIFT_GAIN_PX = 30;
// Ambient-Schweben (immer laufend, kein Deform): Amplituden in Pixel bzw. rad.
const AMBIENT_X_PX = 5;
const AMBIENT_Y_PX = 9;
const AMBIENT_ROT = 0.022;

// Verformungs-Gains (Kanal -> Wirkung) + Gewichts-Profil der Feder-Kaskade.
const BEAT_GAIN = 0.33;
const FLAP_GAIN = 0.26;
const BEND_GAIN = 0.24;
const TIPLAG_GAIN = 0.22;
const ROOT_ROT_GAIN = 0.22;
const COMPRESS_GAIN = 0.28;
const MIN_COMPRESS_FACTOR = 0.55;
const NORMALIZE_HEADROOM = 0.85;
const WEIGHT_EXPONENT = 1.7;
const TIP_BAND_START = 0.45;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Pro Vertex zwei Gewichte: `weights` (radiale Naehe zur Wurzel, exponentiell)
// treibt Flap/Bend/Compression; `weightsTip` (nur das aeussere Feder-Band)
// treibt das verzoegerte Spitzen-Nachziehen (tipLag = Overlapping Action).
function buildWeights(original, rootX, rootY) {
  const count = original.length / 2;
  const weights = new Float32Array(count);
  const weightsTip = new Float32Array(count);
  let maxDist = 0;
  for (let i = 0; i < count; i++) {
    const dx = original[i * 2] - rootX;
    const dy = original[i * 2 + 1] - rootY;
    const d = Math.hypot(dx, dy);
    if (d > maxDist) maxDist = d;
  }
  const norm = maxDist * NORMALIZE_HEADROOM || 1;
  for (let i = 0; i < count; i++) {
    const dx = original[i * 2] - rootX;
    const dy = original[i * 2 + 1] - rootY;
    const raw = Math.min(1, Math.hypot(dx, dy) / norm);
    weights[i] = Math.pow(raw, WEIGHT_EXPONENT);
    weightsTip[i] = smoothstep(TIP_BAND_START, 1, raw);
  }
  return { weights, weightsTip };
}

// Deterministische Verformung: jeder Vertex wird um die Wurzel rotiert (Winkel
// aus den Kanaelen x Gewicht) und radial komprimiert. Schreibt nach `out`.
function deform(ctx, s, out) {
  const { original, weights, weightsTip, rootX, rootY } = ctx;
  const count = original.length / 2;
  const amp = s.intensity;
  const baseAngle = s.rootRotation * ROOT_ROT_GAIN;
  for (let i = 0; i < count; i++) {
    const w = weights[i];
    const wTip = weightsTip[i];
    const angle =
      baseAngle +
      amp *
        (s.beat * BEAT_GAIN +
          s.flap * FLAP_GAIN * w +
          s.bend * BEND_GAIN * w * w +
          s.tipLag * TIPLAG_GAIN * wTip);
    const cf = Math.max(
      MIN_COMPRESS_FACTOR,
      1 - s.compression * COMPRESS_GAIN * amp * w,
    );
    const dx = (original[i * 2] - rootX) * cf;
    const dy = (original[i * 2 + 1] - rootY) * cf;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    out[i * 2] = rootX + (dx * cos - dy * sin);
    out[i * 2 + 1] = rootY + (dx * sin + dy * cos);
  }
}

// --- Bewegungs-State -------------------------------------------------------
function restState() {
  return {
    beat: 0,
    flap: 0,
    bend: 0,
    compression: 0,
    tipLag: 0,
    lift: 0,
    rootRotation: 0,
    intensity: 1,
    speed: 1,
  };
}
// Nur die ANIMIERTEN Kanaele (ohne beat/rootRotation, die separat genullt werden).
const REST_CHANNELS = { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 };

// --- Presets (Arbeits-Loops, aus presets.ts) -------------------------------
function classicCycle(state, pause) {
  return gsap
    .timeline({ paused: true, repeat: -1, repeatDelay: pause })
    .set(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 })
    .to(state, { flap: -0.34, bend: 0.12, lift: -0.08, duration: 0.12, ease: "power2.inOut" })
    .to(state, { flap: 1, bend: 0.64, compression: 0.5, duration: 0.12, ease: "power3.out" })
    .to(state, { tipLag: 0.55, lift: 0.62, duration: 0.2, ease: "power2.out" }, "-=0.08")
    .to(state, { flap: -0.1, bend: 0.2, compression: 0.08, lift: 0.7, duration: 0.24, ease: "sine.out" })
    .to(state, { tipLag: -0.26, duration: 0.22, ease: "power2.out" }, "<")
    .to(state, { flap: 0.5, bend: 0.34, compression: 0.22, lift: 0.4, duration: 0.16, ease: "power2.inOut" })
    .to(state, { tipLag: 0.22, duration: 0.16, ease: "power2.out" }, "<")
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.36, ease: "sine.inOut" });
}
function olympianCycle(state, pause) {
  return gsap
    .timeline({ paused: true, repeat: -1, repeatDelay: pause })
    .set(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 })
    .to(state, { beat: -1.0, flap: -0.06, bend: 0.1, compression: 0.24, lift: -0.06, duration: 0.18, ease: "sine.inOut" })
    .to(state, { beat: 0.33, flap: 0.34, bend: 0.42, compression: 0, lift: 0.6, duration: 0.24, ease: "power3.out" })
    .to(state, { tipLag: 0.85, lift: 0.8, duration: 0.22, ease: "power2.out" }, "-=0.1")
    .to(state, { beat: -0.47, flap: 0.04, bend: 0.2, compression: 0.12, lift: 0.52, duration: 0.16, ease: "power2.inOut" })
    .to(state, { tipLag: -0.2, duration: 0.16, ease: "sine.inOut" }, "<")
    .to(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.28, ease: "sine.inOut" });
}

// --- Status-Timelines (aus status.ts) --------------------------------------
const SETTLE = 0.3;
function buildIdle(state) {
  return gsap
    .timeline({ paused: true })
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: SETTLE, ease: "power2.out" })
    .to(state, { lift: 0.22, flap: 0.07, bend: 0.06, duration: 1.7, ease: "sine.inOut", repeat: -1, yoyo: true });
}
function buildConnecting(state) {
  const tl = gsap.timeline({ paused: true }).set(state, REST_CHANNELS);
  for (let i = 0; i < 2; i++) {
    tl.to(state, { flap: 0.4, bend: 0.25, compression: 0.16, lift: 0.2, duration: 0.1, ease: "power2.out" })
      .to(state, { flap: 0, bend: 0.05, compression: 0.02, lift: 0.05, duration: 0.13, ease: "power2.in" })
      .to(state, {}, "+=0.08");
  }
  return tl.to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.15, ease: "power2.out" });
}
function buildSuccess(state) {
  return gsap
    .timeline({ paused: true })
    .set(state, REST_CHANNELS)
    .to(state, { flap: 1, bend: 0.5, compression: 0.4, tipLag: 0.5, lift: 0.85, duration: 0.1, ease: "power4.out" })
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.5, ease: "elastic.out(1,0.4)" });
}
function buildError(state) {
  return gsap
    .timeline({ paused: true })
    .set(state, REST_CHANNELS)
    .to(state, { flap: 0.2, duration: 0.05, ease: "power1.out" })
    .to(state, { flap: -0.1, duration: 0.05, ease: "power1.inOut" })
    .to(state, { flap: 0.12, duration: 0.05, ease: "power1.inOut" })
    .to(state, { flap: -0.08, duration: 0.05, ease: "power1.inOut" })
    .to(state, { flap: -0.16, bend: 0.12, compression: 0.08, lift: -0.18, duration: 0.25, ease: "power2.out" });
}

function timelineFor(status, state, preset) {
  if (status === "connecting") return buildConnecting(state);
  if (status === "working") return (preset === "olympian" ? olympianCycle : classicCycle)(state, 0.12);
  if (status === "success") return buildSuccess(state);
  if (status === "error") return buildError(state);
  return buildIdle(state);
}

// --- Eine Fluegel-Instanz --------------------------------------------------
/**
 * Mountet genau einen Fluegel in `host` (ein leeres Block-Element). Liefert
 * eine Steuerung mit `setStatus(next)` und `destroy()`.
 *
 * opts: { size:number, status:string, preset:string, textureUrl:string }
 * Bei prefers-reduced-motion wird eine statische Ruhepose gerendert.
 */
export async function mountWing(host, opts = {}) {
  const size = opts.size || 200;
  const preset = opts.preset || "classic";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Textur worker-frei laden: das PNG als HTMLImageElement (img-src 'self'),
  // dann eine pixi-Texture daraus. Bewusst KEIN Assets.load -- dessen Hintergrund-
  // Worker (Blob) wird von der strikten CSP blockiert und der Load haengt.
  const img = new Image();
  img.src = opts.textureUrl;
  await new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth) return resolve();
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => reject(new Error("wing texture load failed")), { once: true });
  });
  const texture = Texture.from(img);

  const app = new Application();
  await app.init({
    width: size,
    height: size,
    backgroundAlpha: 0,
    antialias: true,
    preference: "webgl",
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  host.appendChild(app.canvas);
  app.canvas.style.display = "block";

  const mesh = new MeshPlane({
    texture,
    verticesX: SEGMENTS_X + 1,
    verticesY: SEGMENTS_Y + 1,
  });
  const posBuf = mesh.geometry.getBuffer("aPosition");
  const live = posBuf.data;
  const original = live.slice();

  const holder = new Container();
  holder.position.set(-WING_CENTER_X, -WING_CENTER_Y);
  holder.addChild(mesh);
  const view = new Container();
  view.addChild(holder);
  view.position.set(app.screen.width / 2, app.screen.height / 2);
  view.scale.set(size / WING_FIT);
  app.stage.addChild(view);

  const rootX = DEFAULT_ROOT.x * texture.width;
  const rootY = DEFAULT_ROOT.y * texture.height;
  const wgt = buildWeights(original, rootX, rootY);
  const ctx = { original, weights: wgt.weights, weightsTip: wgt.weightsTip, rootX, rootY };

  const state = restState();
  const clock = performance.now();
  const ambient = !reduce;

  function applyState() {
    const liftPx = state.lift * LIFT_GAIN_PX * state.intensity;
    let ax = 0;
    let ay = 0;
    let sway = 0;
    if (ambient) {
      const t = (performance.now() - clock) / 1000;
      ax = Math.sin(t * 0.9) * AMBIENT_X_PX;
      ay = Math.sin(t * 1.7 + 1.3) * AMBIENT_Y_PX;
      sway = Math.sin(t * 0.6) * AMBIENT_ROT;
    }
    holder.position.set(-WING_CENTER_X + ax, -WING_CENTER_Y - liftPx + ay);
    view.rotation = sway;
    deform(ctx, state, live);
    posBuf.update();
  }
  app.ticker.add(applyState);

  let tl = null;
  function setStatus(next) {
    if (tl) tl.kill();
    state.beat = 0;
    state.rootRotation = 0;
    if (reduce) {
      state.flap = 0;
      state.bend = 0;
      state.compression = 0;
      state.tipLag = 0;
      state.lift = 0;
      tl = null;
      applyState();
      app.render();
      return;
    }
    tl = timelineFor(next, state, preset);
    tl.timeScale(state.speed);
    tl.play(0);
  }
  setStatus(opts.status || "idle");

  // Der Ticker laeuft immer (Canvas zeigt stets den aktuellen Frame); nur die
  // Bewegungs-Timeline wird per Sichtbarkeit gegated (spart CPU off-screen /
  // bei verstecktem Tab).
  let onScreen = true;
  let pageVisible = true;
  function syncPlay() {
    if (!tl) return;
    if (onScreen && pageVisible) tl.play();
    else tl.pause();
  }
  const io = new IntersectionObserver(
    (entries) => {
      onScreen = !!(entries[0] && entries[0].isIntersecting);
      syncPlay();
    },
    { threshold: 0.02 },
  );
  io.observe(host);
  function onVisibility() {
    pageVisible = document.visibilityState === "visible";
    syncPlay();
  }
  document.addEventListener("visibilitychange", onVisibility);
  app.render();

  return {
    setStatus,
    get status() {
      return state;
    },
    destroy() {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (tl) tl.kill();
      app.ticker.remove(applyState);
      app.destroy(true);
    },
  };
}
