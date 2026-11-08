(() => {

const __ds_ns = (window.HermesDesignSystem_738510 = window.HermesDesignSystem_738510 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

try { (() => {
(function () {
  var v = document.getElementById("hermesSky");
  if (!v) return;
  v.muted = true;
  v.playsInline = true;
  v.loop = true;
  var RATE = 0.7;
  var onScreen = true;
  var apply = function () {
    try {
      v.playbackRate = RATE;
    } catch (e) {}
  };
  var play = function () {
    apply();
    if (onScreen && document.visibilityState === "visible") {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
  };
  v.addEventListener("loadedmetadata", apply);
  v.addEventListener("play", apply);
  v.addEventListener("pause", function () {
    if (onScreen) setTimeout(play, 140);
  });
  document.addEventListener("visibilitychange", play);
  try {
    var io = new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting;
      if (onScreen) play();else v.pause();
    }, {
      threshold: 0.02
    });
    io.observe(v);
  } catch (e) {}
  play();
  setTimeout(play, 200);
  setTimeout(play, 800);
  setTimeout(play, 2000);
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/imagery/hero.js", error: String((e && e.message) || e) }); }

try { (() => {
(function () {
  if (window.HermesWingEngine) return;
  var PIXI_URL = "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js";
  var GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";

  var WING_BBOX = {
    minX: 97,
    maxX: 404,
    minY: 21,
    maxY: 455
  };
  var WING_CENTER_X = (WING_BBOX.minX + WING_BBOX.maxX) / 2;
  var WING_CENTER_Y = (WING_BBOX.minY + WING_BBOX.maxY) / 2;
  var WING_FIT = Math.max(WING_BBOX.maxX - WING_BBOX.minX, WING_BBOX.maxY - WING_BBOX.minY) / 0.92;
  var DEFAULT_ROOT = {
    x: 0.23,
    y: 0.88
  };
  var SEGMENTS_X = 16,
    SEGMENTS_Y = 24;
  var LIFT_GAIN_PX = 30;
  var AMBIENT_X_PX = 5,
    AMBIENT_Y_PX = 9,
    AMBIENT_ROT = 0.022;
  var BEAT_GAIN = 0.33,
    FLAP_GAIN = 0.26,
    BEND_GAIN = 0.24,
    TIPLAG_GAIN = 0.22,
    ROOT_ROT_GAIN = 0.22,
    COMPRESS_GAIN = 0.28,
    MIN_COMPRESS_FACTOR = 0.55,
    NORMALIZE_HEADROOM = 0.85,
    WEIGHT_EXPONENT = 1.7,
    TIP_BAND_START = 0.45;
  function smoothstep(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function buildWeights(original, rootX, rootY) {
    var count = original.length / 2;
    var weights = new Float32Array(count),
      weightsTip = new Float32Array(count);
    var maxDist = 0,
      i,
      dx,
      dy,
      d;
    for (i = 0; i < count; i++) {
      dx = original[i * 2] - rootX;
      dy = original[i * 2 + 1] - rootY;
      d = Math.hypot(dx, dy);
      if (d > maxDist) maxDist = d;
    }
    var norm = maxDist * NORMALIZE_HEADROOM || 1;
    for (i = 0; i < count; i++) {
      dx = original[i * 2] - rootX;
      dy = original[i * 2 + 1] - rootY;
      var raw = Math.min(1, Math.hypot(dx, dy) / norm);
      weights[i] = Math.pow(raw, WEIGHT_EXPONENT);
      weightsTip[i] = smoothstep(TIP_BAND_START, 1, raw);
    }
    return {
      weights: weights,
      weightsTip: weightsTip
    };
  }
  function deform(ctx, s, out) {
    var original = ctx.original,
      weights = ctx.weights,
      weightsTip = ctx.weightsTip,
      rootX = ctx.rootX,
      rootY = ctx.rootY,
      count = original.length / 2,
      amp = s.intensity;
    var baseAngle = s.rootRotation * ROOT_ROT_GAIN;
    for (var i = 0; i < count; i++) {
      var w = weights[i],
        wTip = weightsTip[i];
      var angle = baseAngle + amp * (s.beat * BEAT_GAIN + s.flap * FLAP_GAIN * w + s.bend * BEND_GAIN * w * w + s.tipLag * TIPLAG_GAIN * wTip);
      var cf = Math.max(MIN_COMPRESS_FACTOR, 1 - s.compression * COMPRESS_GAIN * amp * w);
      var dx = (original[i * 2] - rootX) * cf,
        dy = (original[i * 2 + 1] - rootY) * cf;
      var cos = Math.cos(angle),
        sin = Math.sin(angle);
      out[i * 2] = rootX + (dx * cos - dy * sin);
      out[i * 2 + 1] = rootY + (dx * sin + dy * cos);
    }
  }

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
      speed: 1
    };
  }
  var REST_CHANNELS = {
    flap: 0,
    bend: 0,
    compression: 0,
    tipLag: 0,
    lift: 0
  };

  function classicCycle(state, pause) {
    return gsap.timeline({
      paused: true,
      repeat: -1,
      repeatDelay: pause
    }).set(state, {
      beat: 0,
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0
    }).to(state, {
      flap: -0.34,
      bend: 0.12,
      lift: -0.08,
      duration: 0.12,
      ease: "power2.inOut"
    }).to(state, {
      flap: 1,
      bend: 0.64,
      compression: 0.5,
      duration: 0.12,
      ease: "power3.out"
    }).to(state, {
      tipLag: 0.55,
      lift: 0.62,
      duration: 0.2,
      ease: "power2.out"
    }, "-=0.08").to(state, {
      flap: -0.1,
      bend: 0.2,
      compression: 0.08,
      lift: 0.7,
      duration: 0.24,
      ease: "sine.out"
    }).to(state, {
      tipLag: -0.26,
      duration: 0.22,
      ease: "power2.out"
    }, "<").to(state, {
      flap: 0.5,
      bend: 0.34,
      compression: 0.22,
      lift: 0.4,
      duration: 0.16,
      ease: "power2.inOut"
    }).to(state, {
      tipLag: 0.22,
      duration: 0.16,
      ease: "power2.out"
    }, "<").to(state, {
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0,
      duration: 0.36,
      ease: "sine.inOut"
    });
  }
  function olympianCycle(state, pause) {
    return gsap.timeline({
      paused: true,
      repeat: -1,
      repeatDelay: pause
    }).set(state, {
      beat: 0,
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0
    }).to(state, {
      beat: -1.0,
      flap: -0.06,
      bend: 0.1,
      compression: 0.24,
      lift: -0.06,
      duration: 0.18,
      ease: "sine.inOut"
    }).to(state, {
      beat: 0.33,
      flap: 0.34,
      bend: 0.42,
      compression: 0,
      lift: 0.6,
      duration: 0.24,
      ease: "power3.out"
    }).to(state, {
      tipLag: 0.85,
      lift: 0.8,
      duration: 0.22,
      ease: "power2.out"
    }, "-=0.1").to(state, {
      beat: -0.47,
      flap: 0.04,
      bend: 0.2,
      compression: 0.12,
      lift: 0.52,
      duration: 0.16,
      ease: "power2.inOut"
    }).to(state, {
      tipLag: -0.2,
      duration: 0.16,
      ease: "sine.inOut"
    }, "<").to(state, {
      beat: 0,
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0,
      duration: 0.28,
      ease: "sine.inOut"
    });
  }

  var SETTLE = 0.3;
  function buildIdle(state) {
    return gsap.timeline({
      paused: true
    }).to(state, {
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0,
      duration: SETTLE,
      ease: "power2.out"
    }).to(state, {
      lift: 0.22,
      flap: 0.07,
      bend: 0.06,
      duration: 1.7,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true
    });
  }
  function buildConnecting(state) {
    var tl = gsap.timeline({
      paused: true
    }).set(state, REST_CHANNELS);
    for (var i = 0; i < 2; i++) {
      tl.to(state, {
        flap: 0.4,
        bend: 0.25,
        compression: 0.16,
        lift: 0.2,
        duration: 0.1,
        ease: "power2.out"
      }).to(state, {
        flap: 0,
        bend: 0.05,
        compression: 0.02,
        lift: 0.05,
        duration: 0.13,
        ease: "power2.in"
      }).to(state, {}, "+=0.08");
    }
    return tl.to(state, {
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0,
      duration: 0.15,
      ease: "power2.out"
    });
  }
  function buildSuccess(state) {
    return gsap.timeline({
      paused: true
    }).set(state, REST_CHANNELS).to(state, {
      flap: 1,
      bend: 0.5,
      compression: 0.4,
      tipLag: 0.5,
      lift: 0.85,
      duration: 0.1,
      ease: "power4.out"
    }).to(state, {
      flap: 0,
      bend: 0,
      compression: 0,
      tipLag: 0,
      lift: 0,
      duration: 0.5,
      ease: "elastic.out(1,0.4)"
    });
  }
  function buildError(state) {
    return gsap.timeline({
      paused: true
    }).set(state, REST_CHANNELS).to(state, {
      flap: 0.2,
      duration: 0.05,
      ease: "power1.out"
    }).to(state, {
      flap: -0.1,
      duration: 0.05,
      ease: "power1.inOut"
    }).to(state, {
      flap: 0.12,
      duration: 0.05,
      ease: "power1.inOut"
    }).to(state, {
      flap: -0.08,
      duration: 0.05,
      ease: "power1.inOut"
    }).to(state, {
      flap: -0.16,
      bend: 0.12,
      compression: 0.08,
      lift: -0.18,
      duration: 0.25,
      ease: "power2.out"
    });
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded) return res();
        existing.addEventListener("load", function () {
          res();
        });
        existing.addEventListener("error", rej);
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.addEventListener("load", function () {
        s.dataset.loaded = "1";
        res();
      });
      s.addEventListener("error", rej);
      document.head.appendChild(s);
    });
  }
  var libsReady = null;
  function ensureLibs() {
    if (libsReady) return libsReady;
    libsReady = async function () {
      if (!window.PIXI) await loadScript(PIXI_URL);
      if (!window.gsap) await loadScript(GSAP_URL);
    }();
    return libsReady;
  }
  var textureCache = {};
  async function loadTexture(url) {
    if (textureCache[url]) return textureCache[url];
    textureCache[url] = await PIXI.Assets.load(url);
    return textureCache[url];
  }

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
      width: size,
      height: size,
      backgroundAlpha: 0,
      antialias: true,
      preference: "webgl",
      preserveDrawingBuffer: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true
    });
    host.appendChild(app.canvas);
    app.canvas.style.display = "block";
    var mesh = new PIXI.MeshPlane({
      texture: texture,
      verticesX: SEGMENTS_X + 1,
      verticesY: SEGMENTS_Y + 1
    });
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
    var rootX = DEFAULT_ROOT.x * texture.width,
      rootY = DEFAULT_ROOT.y * texture.height;
    var wgt = buildWeights(original, rootX, rootY);
    var ctx = {
      original: original,
      weights: wgt.weights,
      weightsTip: wgt.weightsTip,
      rootX: rootX,
      rootY: rootY
    };
    var state = restState();
    var clock = performance.now();
    var ambient = !reduce;
    function applyState() {
      var liftPx = state.lift * LIFT_GAIN_PX * state.intensity;
      var ax = 0,
        ay = 0,
        sway = 0;
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
      if (next === "idle") tl = buildIdle(state);else if (next === "connecting") tl = buildConnecting(state);else if (next === "working") tl = (opts.preset === "olympian" ? olympianCycle : classicCycle)(state, 0.12);else if (next === "success") tl = buildSuccess(state);else if (next === "error") tl = buildError(state);else tl = buildIdle(state);
      if (tl) {
        tl.timeScale(state.speed);
        tl.play(0);
      }
      status = next;
    }
    setStatus(status);

    var onScreen = true,
      pageVis = true;
    function syncPlay() {
      if (!tl) return;
      if (onScreen && pageVis) tl.play();else tl.pause();
    }
    var io = new IntersectionObserver(function (es) {
      onScreen = !!(es[0] && es[0].isIntersecting);
      syncPlay();
    }, {
      threshold: 0.02
    });
    io.observe(host);
    function onVis() {
      pageVis = document.visibilityState === "visible";
      syncPlay();
    }
    document.addEventListener("visibilitychange", onVis);
    app.render();
    return {
      setStatus: setStatus,
      get status() {
        return status;
      },
      destroy: function () {
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        if (tl) tl.kill();
        app.ticker.remove(applyState);
        app.destroy(true);
      }
    };
  }
  window.HermesWingEngine = {
    ensure: ensureLibs,
    mount: mount
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/wing-engine.js", error: String((e && e.message) || e) }); }

try { (() => {
const WING_PNG = "data:image/png;base64,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";
Object.assign(__ds_scope, { WING_PNG });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/wing-image.js", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function whenEngine(cb) {
  if (window.HermesWingEngine) return cb();
  const t = setInterval(() => {
    if (window.HermesWingEngine) {
      clearInterval(t);
      cb();
    }
  }, 50);
  return () => clearInterval(t);
}
function LiveWing({
  size = 180,
  status = "idle",
  preset = "classic",
  style,
  ...rest
}) {
  const hostRef = React.useRef(null);
  const ctrlRef = React.useRef(null);
  React.useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    const cancel = whenEngine(() => {
      if (!alive || !host) return;
      window.HermesWingEngine.mount(host, {
        size,
        status,
        preset,
        textureUrl: __ds_scope.WING_PNG
      }).then(ctrl => {
        if (!alive) {
          ctrl.destroy();
          return;
        }
        ctrlRef.current = ctrl;
      }).catch(e => console.error("LiveWing mount failed", e));
    });
    return () => {
      alive = false;
      if (cancel) cancel();
      if (ctrlRef.current) {
        ctrlRef.current.destroy();
        ctrlRef.current = null;
      }
      if (host) host.innerHTML = "";
    };
  }, [size, preset]);
  React.useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.setStatus(status);
  }, [status]);
  return React.createElement("div", _extends({
    ref: hostRef,
    style: {
      width: size,
      height: size,
      display: "inline-block",
      lineHeight: 0,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { LiveWing });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/LiveWing.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-hermes-wing", "");
  el.textContent = `
@keyframes hermesWingDrift {
  0%   { transform: translate(0%, 0%) rotate(0deg); }
  22%  { transform: translate(-0.7%, -1.1%) rotate(-1deg); }
  48%  { transform: translate(0.5%, 0.5%) rotate(0.6deg); }
  74%  { transform: translate(0.8%, -0.7%) rotate(1.3deg); }
  100% { transform: translate(0%, 0%) rotate(0deg); }
}
@keyframes hermesWingBob {
  0%   { transform: translateY(0%); }
  50%  { transform: translateY(-5%); }
  100% { transform: translateY(0%); }
}
@keyframes hermesWingConnect {
  0%, 48%, 100% { transform: rotate(0deg) translateY(0%); }
  10% { transform: rotate(11deg) translateY(-5%); }
  20% { transform: rotate(0deg)  translateY(0%); }
  30% { transform: rotate(11deg) translateY(-5%); }
  40% { transform: rotate(0deg)  translateY(0%); }
}
@keyframes hermesWingFlap {
  0%   { transform: rotate(-7deg) translateY(0%); }
  35%  { transform: rotate(15deg) translateY(-8%); }
  60%  { transform: rotate(9deg)  translateY(-4%); }
  100% { transform: rotate(-7deg) translateY(0%); }
}
@keyframes hermesWingSuccess {
  0%   { transform: rotate(-7deg) translateY(0%)   scale(1); }
  30%  { transform: rotate(17deg) translateY(-18%) scale(1.05); }
  55%  { transform: rotate(4deg)  translateY(-4%)  scale(1); }
  72%  { transform: rotate(-4deg) translateY(3%)   scale(.99); }
  100% { transform: rotate(0deg)  translateY(0%)   scale(1); }
}
@keyframes hermesWingError {
  0%   { transform: rotate(0deg)  translateY(0%); }
  10%  { transform: rotate(5deg); }
  22%  { transform: rotate(-4deg); }
  34%  { transform: rotate(4deg); }
  46%  { transform: rotate(-3deg); }
  100% { transform: rotate(-9deg) translateY(6%); }
}
@media (prefers-reduced-motion: reduce) {
  .hermes-wing, .hermes-wing * { animation: none !important; }
}`;
  document.head.appendChild(el);
}
const INNER_ANIM = {
  idle: "hermesWingBob 3.9s ease-in-out infinite",
  connecting: "hermesWingConnect 1.9s ease-in-out infinite",
  working: "hermesWingFlap 0.52s ease-in-out infinite",
  success: "hermesWingSuccess 0.95s cubic-bezier(.2,1.1,.3,1) 1 forwards",
  error: "hermesWingError 0.9s ease-out 1 forwards"
};
function WingMark({
  size = 56,
  status = "idle",
  float = true,
  shadow = true,
  alt = "Hermes wing",
  style,
  ...rest
}) {
  ensureKeyframes();
  const st = INNER_ANIM[status] ? status : "idle";
  const outer = {
    display: "inline-block",
    width: `${size}px`,
    height: `${size}px`,
    transformOrigin: "26% 86%",
    animation: float && st === "idle" ? "hermesWingDrift 6.8s ease-in-out infinite" : "none",
    willChange: "transform",
    ...style
  };
  const inner = {
    display: "block",
    width: "100%",
    height: "100%",
    transformOrigin: "26% 86%",
    animation: INNER_ANIM[st]
  };
  const active = st === "working" || st === "connecting";
  const img = {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    filter: shadow ? `drop-shadow(0 3px 10px rgba(7,18,40,.32))${active ? " brightness(1.06)" : ""}` : "none",
    transition: "filter .3s ease",
    userSelect: "none"
  };
  return React.createElement("span", _extends({
    className: "hermes-wing",
    style: outer
  }, rest), React.createElement("span", {
    key: st,
    style: inner
  }, React.createElement("img", {
    src: __ds_scope.WING_PNG,
    alt: alt,
    style: img,
    draggable: false
  })));
}
Object.assign(__ds_scope, { WingMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/WingMark.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  href,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const pads = {
    sm: "8px 14px",
    md: "20px 16px",
    lg: "22px 28px"
  };
  const palette = {
    primary: {
      bg: hover && !disabled ? "var(--color-action-hover)" : "var(--color-action)",
      fg: "var(--color-on-action)"
    },
    ghost: {
      bg: hover && !disabled ? "var(--color-gray-100)" : "var(--color-gray-75)",
      fg: "var(--color-text)"
    }
  }[variant] || {};
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-tight)",
    padding: size === "md" ? "var(--space-gap) var(--space-inline)" : pads[size],
    border: 0,
    borderRadius: "var(--radius-card)",
    background: palette.bg,
    color: palette.fg,
    fontFamily: "var(--font-body)",
    fontSize: "var(--text-body)",
    fontWeight: "var(--weight-label)",
    lineHeight: 1.2,
    textDecoration: "none",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "background var(--motion-duration) var(--motion-ease)",
    ...style
  };
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: disabled ? undefined : onClick
  };
  if (href && !disabled) {
    return React.createElement("a", _extends({
      href: href,
      style: base
    }, handlers, rest), children);
  }
  return React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    style: base
  }, handlers, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  title,
  children,
  style,
  bodyStyle,
  ...rest
}) {
  return React.createElement("section", _extends({
    style: {
      background: "var(--color-card)",
      border: "var(--border-width) solid var(--color-border)",
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--shadow-card)",
      padding: "var(--space-card)",
      ...style
    }
  }, rest), title && React.createElement("h3", {
    style: {
      margin: "0 0 var(--space-stack)",
      fontFamily: "var(--font-heading)",
      fontSize: "var(--text-subtitle)",
      fontWeight: "var(--weight-heading)",
      letterSpacing: "var(--tracking-heading)",
      color: "var(--color-text)"
    }
  }, title), React.createElement("div", {
    style: bodyStyle
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function PillCTA({
  children,
  href = "#",
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement("a", _extends({
    href: href,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-block",
      padding: "var(--space-cozy) var(--space-roomy)",
      borderRadius: "var(--radius-pill-cta)",
      background: "var(--pill-bg)",
      color: "var(--pill-ink)",
      fontFamily: "var(--font-grotesk)",
      fontWeight: "var(--weight-medium)",
      fontSize: "var(--text-lead)",
      textDecoration: "none",
      boxShadow: "var(--shadow-pill)",
      transform: hover ? "translateY(-1px)" : "none",
      transition: "transform var(--motion-duration) var(--motion-ease)",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { PillCTA });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/PillCTA.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function LiveDot({
  live = false,
  size = 12,
  style,
  ...rest
}) {
  return React.createElement("span", _extends({
    style: {
      display: "inline-block",
      width: size,
      height: size,
      borderRadius: "var(--radius-round)",
      flexShrink: 0,
      background: live ? "var(--color-indicator-live)" : "var(--color-indicator-off)",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { LiveDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/LiveDot.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Stat({
  value,
  label,
  style,
  ...rest
}) {
  return React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-hairline)",
      padding: "var(--space-cozy)",
      border: "var(--border-width) solid var(--color-border)",
      borderRadius: "var(--radius-control)",
      background: "var(--color-surface)",
      ...style
    }
  }, rest), React.createElement("span", {
    style: {
      fontSize: "var(--text-title)",
      fontWeight: "var(--weight-heading)",
      letterSpacing: "var(--tracking-heading)",
      color: "var(--color-text)"
    }
  }, value), React.createElement("span", {
    style: {
      fontSize: "var(--text-eyebrow)",
      color: "var(--color-muted)"
    }
  }, label));
}
Object.assign(__ds_scope, { Stat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Stat.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  active: {
    bg: "var(--color-status-positive)",
    fg: "var(--color-on-action)"
  },
  completed: {
    bg: "var(--color-status-positive-surface)",
    fg: "var(--color-status-positive)"
  },
  cancelled: {
    bg: "var(--color-status-neutral-surface)",
    fg: "var(--color-status-neutral)"
  },
  failed: {
    bg: "var(--color-status-critical-surface)",
    fg: "var(--color-status-critical)"
  },
  info: {
    bg: "var(--color-status-info-surface)",
    fg: "var(--color-status-info)"
  },
  neutral: {
    bg: "var(--color-status-neutral-surface)",
    fg: "var(--color-status-neutral)"
  }
};

function StatusBadge({
  tone = "neutral",
  children,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  return React.createElement("span", _extends({
    style: {
      display: "inline-block",
      flexShrink: 0,
      padding: "var(--space-hairline) var(--space-cozy)",
      borderRadius: "var(--radius-badge)",
      background: t.bg,
      color: t.fg,
      fontFamily: "var(--font-body)",
      fontSize: "var(--text-eyebrow)",
      fontWeight: "var(--weight-label)",
      textTransform: "uppercase",
      letterSpacing: "var(--tracking-label)",
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusBadge.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Field({
  label,
  id,
  value,
  defaultValue,
  placeholder,
  type = "text",
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const fieldId = id || (label ? String(label).toLowerCase().replace(/\s+/g, "-") : undefined);
  return React.createElement("label", {
    htmlFor: fieldId,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-tight)",
      ...style
    }
  }, label && React.createElement("span", {
    style: {
      fontSize: "var(--text-eyebrow)",
      fontWeight: "var(--weight-label)",
      textTransform: "uppercase",
      letterSpacing: "var(--tracking-label)",
      color: "var(--color-muted)"
    }
  }, label), React.createElement("input", _extends({
    id: fieldId,
    type: type,
    value: value,
    defaultValue: defaultValue,
    placeholder: placeholder,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: "100%",
      padding: "var(--space-cozy)",
      border: `var(--border-width) solid ${focus ? "var(--color-field-border-focus)" : "var(--color-field-border)"}`,
      borderRadius: "var(--radius-control)",
      background: "var(--color-card)",
      color: "var(--color-text)",
      fontFamily: "var(--font-body)",
      fontSize: "var(--text-body)",
      outline: "none"
    }
  }, rest)));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  checked,
  defaultChecked,
  onChange,
  disabled = false,
  style,
  ...rest
}) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : internal;
  const toggle = e => {
    if (disabled) return;
    if (!isControlled) setInternal(e.target.checked);
    onChange && onChange(e.target.checked);
  };
  const W = 44,
    H = 24,
    KNOB = 20,
    PAD = 4;
  return React.createElement("span", {
    style: {
      position: "relative",
      display: "inline-block",
      width: W,
      height: H,
      flexShrink: 0,
      opacity: disabled ? 0.6 : 1,
      ...style
    }
  }, React.createElement("input", _extends({
    type: "checkbox",
    checked: on,
    onChange: toggle,
    disabled: disabled,
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), React.createElement("span", {
    onClick: e => {
      const input = e.currentTarget.previousSibling;
      if (input) input.click();
    },
    style: {
      position: "absolute",
      inset: 0,
      background: on ? "var(--color-action)" : "var(--color-indicator-off)",
      borderRadius: "var(--radius-badge)",
      cursor: disabled ? "default" : "pointer",
      transition: "background var(--motion-duration) var(--motion-ease)"
    }
  }, React.createElement("span", {
    style: {
      position: "absolute",
      left: PAD,
      top: PAD,
      width: KNOB,
      height: KNOB,
      background: "var(--color-card)",
      borderRadius: "var(--radius-round)",
      transform: on ? `translateX(${W - KNOB - PAD * 2}px)` : "none",
      transition: "transform var(--motion-duration) var(--motion-ease)"
    }
  })));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

__ds_ns.LiveWing = __ds_scope.LiveWing;

__ds_ns.WingMark = __ds_scope.WingMark;

__ds_ns.WING_PNG = __ds_scope.WING_PNG;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.PillCTA = __ds_scope.PillCTA;

__ds_ns.LiveDot = __ds_scope.LiveDot;

__ds_ns.Stat = __ds_scope.Stat;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Switch = __ds_scope.Switch;

})();
