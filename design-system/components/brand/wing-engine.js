/*
 * Hermes wing engine — a faithful browser port of apps/hermes-animation-lab.
 * ONE feathered wing as a deformable Pixi MeshPlane (16x24), driven by a GSAP
 * motion state. No clones, mirrors, trails or second layers. Renders to a
 * transparent <canvas>; status timelines (idle / connecting / working /
 * success / error) mirror the lab's HermesStatusController.
 *
 * Globals required: PIXI (pixi.js v8 UMD) and gsap (v3 UMD). ensure() injects
 * them from a CDN on first use. Exposes window.HermesWingEngine.
 *
 * Physics overlap with wing-canvas-engine.js (same directory): the geometry/
 * gain constants, smoothstep/buildWeights/deform, restState and the preset/
 * status choreographies are intentionally duplicated there, NOT shared - that
 * file must stay a single self-contained injectable script for widget iframes
 * (no CDN, no extra file load), while this file needs Pixi/GSAP from a CDN and
 * stays the engine for design-system/mcp previews (see README.md ICONOGRAPHY
 * for the full rationale). Change the physics/choreography here -> mirror it
 * in wing-canvas-engine.js too (and vice versa); no automated sync test for
 * this subset.
 */
(function () {
  if (window.HermesWingEngine) return;

  var PIXI_URL = "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js";
  var GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";

  // ---- geometry / gains (from HermesWing.ts + deform.ts) -------------------
  var WING_BBOX = { minX: 97, maxX: 404, minY: 21, maxY: 455 };
  var WING_CENTER_X = (WING_BBOX.minX + WING_BBOX.maxX) / 2;
  var WING_CENTER_Y = (WING_BBOX.minY + WING_BBOX.maxY) / 2;
  var WING_FIT = Math.max(WING_BBOX.maxX - WING_BBOX.minX, WING_BBOX.maxY - WING_BBOX.minY) / 0.92;
  var DEFAULT_ROOT = { x: 0.23, y: 0.88 };
  var SEGMENTS_X = 16, SEGMENTS_Y = 24;
  var LIFT_GAIN_PX = 30;
  var AMBIENT_X_PX = 5, AMBIENT_Y_PX = 9, AMBIENT_ROT = 0.022;

  var BEAT_GAIN = 0.33, FLAP_GAIN = 0.26, BEND_GAIN = 0.24, TIPLAG_GAIN = 0.22,
      ROOT_ROT_GAIN = 0.22, COMPRESS_GAIN = 0.28, MIN_COMPRESS_FACTOR = 0.55,
      NORMALIZE_HEADROOM = 0.85, WEIGHT_EXPONENT = 1.7, TIP_BAND_START = 0.45;

  function smoothstep(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function buildWeights(original, rootX, rootY) {
    var count = original.length / 2;
    var weights = new Float32Array(count), weightsTip = new Float32Array(count);
    var maxDist = 0, i, dx, dy, d;
    for (i = 0; i < count; i++) {
      dx = original[i * 2] - rootX; dy = original[i * 2 + 1] - rootY;
      d = Math.hypot(dx, dy); if (d > maxDist) maxDist = d;
    }
    var norm = maxDist * NORMALIZE_HEADROOM || 1;
    for (i = 0; i < count; i++) {
      dx = original[i * 2] - rootX; dy = original[i * 2 + 1] - rootY;
      var raw = Math.min(1, Math.hypot(dx, dy) / norm);
      weights[i] = Math.pow(raw, WEIGHT_EXPONENT);
      weightsTip[i] = smoothstep(TIP_BAND_START, 1, raw);
    }
    return { weights: weights, weightsTip: weightsTip };
  }
  function deform(ctx, s, out) {
    var original = ctx.original, weights = ctx.weights, weightsTip = ctx.weightsTip,
        rootX = ctx.rootX, rootY = ctx.rootY, count = original.length / 2, amp = s.intensity;
    var baseAngle = s.rootRotation * ROOT_ROT_GAIN;
    for (var i = 0; i < count; i++) {
      var w = weights[i], wTip = weightsTip[i];
      var angle = baseAngle + amp * (s.beat * BEAT_GAIN + s.flap * FLAP_GAIN * w +
        s.bend * BEND_GAIN * w * w + s.tipLag * TIPLAG_GAIN * wTip);
      var cf = Math.max(MIN_COMPRESS_FACTOR, 1 - s.compression * COMPRESS_GAIN * amp * w);
      var dx = (original[i * 2] - rootX) * cf, dy = (original[i * 2 + 1] - rootY) * cf;
      var cos = Math.cos(angle), sin = Math.sin(angle);
      out[i * 2] = rootX + (dx * cos - dy * sin);
      out[i * 2 + 1] = rootY + (dx * sin + dy * cos);
    }
  }

  // ---- motion state --------------------------------------------------------
  function restState() {
    return { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0,
             rootRotation: 0, intensity: 1, speed: 1 };
  }
  var REST_CHANNELS = { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 };

  // ---- presets (working loops, from presets.ts) ----------------------------
  function classicCycle(state, pause) {
    return gsap.timeline({ paused: true, repeat: -1, repeatDelay: pause })
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
    return gsap.timeline({ paused: true, repeat: -1, repeatDelay: pause })
      .set(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 })
      .to(state, { beat: -1.0, flap: -0.06, bend: 0.1, compression: 0.24, lift: -0.06, duration: 0.18, ease: "sine.inOut" })
      .to(state, { beat: 0.33, flap: 0.34, bend: 0.42, compression: 0, lift: 0.6, duration: 0.24, ease: "power3.out" })
      .to(state, { tipLag: 0.85, lift: 0.8, duration: 0.22, ease: "power2.out" }, "-=0.1")
      .to(state, { beat: -0.47, flap: 0.04, bend: 0.2, compression: 0.12, lift: 0.52, duration: 0.16, ease: "power2.inOut" })
      .to(state, { tipLag: -0.2, duration: 0.16, ease: "sine.inOut" }, "<")
      .to(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.28, ease: "sine.inOut" });
  }

  // ---- status timelines (from status.ts) -----------------------------------
  var SETTLE = 0.3;
  function buildIdle(state) {
    return gsap.timeline({ paused: true })
      .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: SETTLE, ease: "power2.out" })
      .to(state, { lift: 0.22, flap: 0.07, bend: 0.06, duration: 1.7, ease: "sine.inOut", repeat: -1, yoyo: true });
  }
  function buildConnecting(state) {
    var tl = gsap.timeline({ paused: true }).set(state, REST_CHANNELS);
    for (var i = 0; i < 2; i++) {
      tl.to(state, { flap: 0.4, bend: 0.25, compression: 0.16, lift: 0.2, duration: 0.1, ease: "power2.out" })
        .to(state, { flap: 0, bend: 0.05, compression: 0.02, lift: 0.05, duration: 0.13, ease: "power2.in" })
        .to(state, {}, "+=0.08");
    }
    return tl.to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.15, ease: "power2.out" });
  }
  function buildSuccess(state) {
    return gsap.timeline({ paused: true }).set(state, REST_CHANNELS)
      .to(state, { flap: 1, bend: 0.5, compression: 0.4, tipLag: 0.5, lift: 0.85, duration: 0.1, ease: "power4.out" })
      .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.5, ease: "elastic.out(1,0.4)" });
  }
  function buildError(state) {
    return gsap.timeline({ paused: true }).set(state, REST_CHANNELS)
      .to(state, { flap: 0.2, duration: 0.05, ease: "power1.out" })
      .to(state, { flap: -0.1, duration: 0.05, ease: "power1.inOut" })
      .to(state, { flap: 0.12, duration: 0.05, ease: "power1.inOut" })
      .to(state, { flap: -0.08, duration: 0.05, ease: "power1.inOut" })
      .to(state, { flap: -0.16, bend: 0.12, compression: 0.08, lift: -0.18, duration: 0.25, ease: "power2.out" });
  }

  // ---- script + texture loading -------------------------------------------
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded) return res();
        existing.addEventListener("load", function () { res(); });
        existing.addEventListener("error", rej);
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.addEventListener("load", function () { s.dataset.loaded = "1"; res(); });
      s.addEventListener("error", rej);
      document.head.appendChild(s);
    });
  }
  var libsReady = null;
  function ensureLibs() {
    if (libsReady) return libsReady;
    libsReady = (async function () {
      if (!window.PIXI) await loadScript(PIXI_URL);
      if (!window.gsap) await loadScript(GSAP_URL);
    })();
    return libsReady;
  }
  var textureCache = {};
  async function loadTexture(url) {
    if (textureCache[url]) return textureCache[url];
    textureCache[url] = await PIXI.Assets.load(url);
    return textureCache[url];
  }

  // ---- one wing instance ---------------------------------------------------
  async function mount(host, opts) {
    opts = opts || {};
    var size = opts.size || 200;
    var status = opts.status || "idle";
    var textureUrl = opts.textureUrl;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    await ensureLibs();
    var texture = await loadTexture(textureUrl);

    var app = new PIXI.Application();
    await app.init({
      width: size, height: size, backgroundAlpha: 0, antialias: true,
      preference: "webgl", preserveDrawingBuffer: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
    });
    host.appendChild(app.canvas);
    app.canvas.style.display = "block";

    var mesh = new PIXI.MeshPlane({ texture: texture, verticesX: SEGMENTS_X + 1, verticesY: SEGMENTS_Y + 1 });
    var posBuf = mesh.geometry.getBuffer("aPosition");
    var live = posBuf.data;
    var original = live.slice();

    var holder = new PIXI.Container();
    holder.position.set(-WING_CENTER_X, -WING_CENTER_Y);
    holder.addChild(mesh);
    var view = new PIXI.Container();
    view.addChild(holder);
    view.position.set(app.screen.width / 2, app.screen.height / 2);
    view.scale.set(size / WING_FIT);
    app.stage.addChild(view);

    var rootX = DEFAULT_ROOT.x * texture.width, rootY = DEFAULT_ROOT.y * texture.height;
    var wgt = buildWeights(original, rootX, rootY);
    var ctx = { original: original, weights: wgt.weights, weightsTip: wgt.weightsTip, rootX: rootX, rootY: rootY };

    var state = restState();
    var clock = performance.now();
    var ambient = !reduce;

    function applyState() {
      var liftPx = state.lift * LIFT_GAIN_PX * state.intensity;
      var ax = 0, ay = 0, sway = 0;
      if (ambient) {
        var t = (performance.now() - clock) / 1000;
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

    var tl = null;
    function setStatus(next) {
      if (tl) tl.kill();
      state.beat = 0; state.rootRotation = 0;
      if (reduce) {
        // static rest pose
        state.flap = 0; state.bend = 0; state.compression = 0; state.tipLag = 0; state.lift = 0;
        tl = null; applyState(); app.render(); return;
      }
      if (next === "idle") tl = buildIdle(state);
      else if (next === "connecting") tl = buildConnecting(state);
      else if (next === "working") tl = (opts.preset === "olympian" ? olympianCycle : classicCycle)(state, 0.12);
      else if (next === "success") tl = buildSuccess(state);
      else if (next === "error") tl = buildError(state);
      else tl = buildIdle(state);
      if (tl) { tl.timeScale(state.speed); tl.play(0); }
      status = next;
    }
    setStatus(status);

    // The ticker always runs (so the canvas always shows the current frame,
    // even in headless/preview capture). Only the motion timeline is gated by
    // visibility, to spare CPU when the wing is off-screen or the tab is hidden.
    var onScreen = true, pageVis = true;
    function syncPlay() {
      if (!tl) return;
      if (onScreen && pageVis) tl.play(); else tl.pause();
    }
    var io = new IntersectionObserver(function (es) {
      onScreen = !!(es[0] && es[0].isIntersecting); syncPlay();
    }, { threshold: 0.02 });
    io.observe(host);
    function onVis() { pageVis = document.visibilityState === "visible"; syncPlay(); }
    document.addEventListener("visibilitychange", onVis);
    app.render();

    return {
      setStatus: setStatus,
      get status() { return status; },
      destroy: function () {
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        if (tl) tl.kill();
        app.ticker.remove(applyState);
        app.destroy(true);
      },
    };
  }

  window.HermesWingEngine = { ensure: ensureLibs, mount: mount };
})();
