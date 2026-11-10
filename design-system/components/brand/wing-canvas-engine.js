(function () {
  "use strict";
  if (window.HermesWingCanvas) return;

  var WING_BBOX = { minX: 97, maxX: 404, minY: 21, maxY: 455 };
  var WING_CENTER_X = (WING_BBOX.minX + WING_BBOX.maxX) / 2;
  var WING_CENTER_Y = (WING_BBOX.minY + WING_BBOX.maxY) / 2;
  var WING_FIT = Math.max(WING_BBOX.maxX - WING_BBOX.minX, WING_BBOX.maxY - WING_BBOX.minY) / 0.92;
  const WING_IMAGE_BASE_PX = 500;
  var DEFAULT_ROOT = { x: 0.23, y: 0.88 };
  var LIFT_GAIN_PX = 30;
  var AMBIENT_X_PX = 5, AMBIENT_Y_PX = 9, AMBIENT_ROT = 0.022;

  var BEAT_GAIN = 0.33, FLAP_GAIN = 0.26, BEND_GAIN = 0.24, TIPLAG_GAIN = 0.22,
      ROOT_ROT_GAIN = 0.22, COMPRESS_GAIN = 0.28, MIN_COMPRESS_FACTOR = 0.55,
      NORMALIZE_HEADROOM = 0.85, WEIGHT_EXPONENT = 1.7, TIP_BAND_START = 0.45;

  var SEAM_PAD = 0.75;
  var SETTLE = 0.3;

  var HERMES_GOLD = "#e6be5c";
  var GOLD_ENABLED = false;
  var GOLD_STRENGTH = 0.35;
  var GOLD_PULSE_GAIN = 0.25;
  var FPS_CAP_DEFAULT = 30;
  var GRID_FINE = { x: 16, y: 24 };
  var GRID_COARSE = { x: 8, y: 12 };
  var COARSE_MAX_SIZE_PX = 96;
  var DPR_CAP = 2;
  var DEFAULT_SIZE_PX = 112;
  var DEFAULT_STATUS = "idle";
  var DEFAULT_PRESET = "classic";
  var WING_CYCLE_SEC = 1.2;
  var TAB_SWITCH_DT_CAP_SEC = 0.1;
  const FRAME_BUDGET_TOLERANCE = 0.9;
  var INTERSECTION_THRESHOLD = 0.02;
  var TERMINAL_WING_STATUSES = { success: true, error: true };

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

  function restState() {
    return { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0,
             rootRotation: 0, intensity: 1, speed: 1 };
  }
  var REST_CHANNELS = { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 };

  var POWER_EXP = { power1: 2, power2: 3, power3: 4, power4: 5 };
  function powerEase(exp, mode) {
    if (mode === "in") return function (p) { return Math.pow(p, exp); };
    if (mode === "inOut") return function (p) {
      return p < 0.5 ? Math.pow(2 * p, exp) / 2 : 1 - Math.pow(2 * (1 - p), exp) / 2;
    };
    return function (p) { return 1 - Math.pow(1 - p, exp); };
  }
  function sineEase(mode) {
    if (mode === "in") return function (p) { return 1 - Math.cos((p * Math.PI) / 2); };
    if (mode === "inOut") return function (p) { return -(Math.cos(Math.PI * p) - 1) / 2; };
    return function (p) { return Math.sin((p * Math.PI) / 2); };
  }
  function elasticOut(amplitude, period) {
    var p1 = amplitude >= 1 ? amplitude : 1;
    var p2 = period || 0.3;
    var p3 = (p2 / (Math.PI * 2)) * Math.asin(1 / p1);
    return function (t) {
      if (t === 0 || t === 1) return t;
      return p1 * Math.pow(2, -10 * t) * Math.sin(((t - p3) * (Math.PI * 2)) / p2) + 1;
    };
  }
  function parseEase(name) {
    if (!name) return function (p) { return p; };
    if (name.indexOf("elastic") === 0) {
      var m = name.match(/\(([^,]+),([^\)]+)\)/);
      var a = m ? parseFloat(m[1]) : 1, per = m ? parseFloat(m[2]) : 0.3;
      return elasticOut(a, per);
    }
    var parts = name.split("."), fam = parts[0], mode = parts[1] || "out";
    if (POWER_EXP[fam]) return powerEase(POWER_EXP[fam], mode);
    if (fam === "sine") return sineEase(mode);
    return function (p) { return p; };
  }

  var CONTROL_KEYS = { duration: 1, ease: 1, repeat: 1, yoyo: 1, repeatDelay: 1 };
  var DEFAULT_DURATION = 0.5;
  function extractProps(vars) {
    var props = [];
    for (var k in vars) if (!CONTROL_KEYS[k]) props.push({ name: k, end: vars[k] });
    return props;
  }
  function Timeline(opts) {
    opts = opts || {};
    this.tweens = [];
    this.cursor = 0;
    this.prevStart = 0;
    this.time = 0;
    this.ts = 1;
    this.paused = true;
    this.repeat = opts.repeat || 0;
    this.repeatDelay = opts.repeatDelay || 0;
    this._iterDur = null;
    this._curIter = 0;
  }
  Timeline.prototype._resolve = function (position, duration) {
    if (position === undefined) return this.cursor;
    if (typeof position === "number") return position;
    if (position === "<") return this.prevStart;
    if (position.indexOf("-=") === 0) return this.cursor - parseFloat(position.slice(2));
    if (position.indexOf("+=") === 0) return this.cursor + parseFloat(position.slice(2));
    return parseFloat(position) || this.cursor;
  };
  Timeline.prototype._add = function (target, vars, duration, position) {
    var start = this._resolve(position, duration);
    this.tweens.push({
      target: target, start: start, duration: duration,
      props: extractProps(vars), ease: parseEase(vars.ease),
      repeat: vars.repeat || 0, yoyo: !!vars.yoyo, repeatDelay: vars.repeatDelay || 0,
      captured: false, from: null,
    });
    this.prevStart = start;
    this.cursor = Math.max(this.cursor, start + duration);
    this._iterDur = null;
    return this;
  };
  Timeline.prototype.set = function (target, vars, position) {
    return this._add(target, vars, 0, position);
  };
  Timeline.prototype.to = function (target, vars, position) {
    var dur = vars.duration != null ? vars.duration : DEFAULT_DURATION;
    return this._add(target, vars, dur, position);
  };
  Timeline.prototype.timeScale = function (v) { this.ts = v; return this; };
  Timeline.prototype.iterationDuration = function () {
    if (this._iterDur != null) return this._iterDur;
    var d = 0;
    for (var i = 0; i < this.tweens.length; i++) {
      var t = this.tweens[i];
      if (t.repeat === 0) d = Math.max(d, t.start + t.duration);
    }
    this.tweens.sort(function (a, b) { return a.start - b.start; });
    this._iterDur = d;
    return d;
  };
  Timeline.prototype.play = function (from) {
    if (from !== undefined) {
      this.time = from; this._curIter = 0;
      this._resetCaptures();
    }
    this.paused = false;
    return this;
  };
  Timeline.prototype.kill = function () { this.paused = true; this.tweens = []; };
  Timeline.prototype._resetCaptures = function () {
    for (var i = 0; i < this.tweens.length; i++) this.tweens[i].captured = false;
  };
  function tweenProgress(t, local) {
    if (t.repeat === 0) return Math.min(1, Math.max(0, local / t.duration));
    var period = t.duration + t.repeatDelay;
    var iter = Math.floor(local / period);
    if (t.repeat > 0 && iter > t.repeat) iter = t.repeat;
    var tin = local - iter * period;
    if (tin > t.duration) tin = t.duration;
    var p = Math.min(1, Math.max(0, tin / t.duration));
    if (t.yoyo && iter % 2 === 1) p = 1 - p;
    return p;
  }
  Timeline.prototype.step = function (dt) {
    if (this.paused) return;
    this.time += dt * this.ts;
    var dur = this.iterationDuration();
    var lt = this.time;
    if (this.repeat !== 0 && dur > 0) {
      var period = dur + this.repeatDelay;
      var iter = Math.floor(this.time / period);
      if (iter !== this._curIter) { this._curIter = iter; this._resetCaptures(); }
      lt = this.time - iter * period;
      if (lt > dur) lt = dur;
    }
    this._apply(lt);
  };
  Timeline.prototype._apply = function (lt) {
    for (var i = 0; i < this.tweens.length; i++) {
      var t = this.tweens[i], local = lt - t.start;
      if (local < 0) continue;
      if (t.duration === 0) {
        for (var j = 0; j < t.props.length; j++) t.target[t.props[j].name] = t.props[j].end;
        continue;
      }
      if (!t.captured) {
        t.from = {};
        for (var k = 0; k < t.props.length; k++) t.from[t.props[k].name] = t.target[t.props[k].name];
        t.captured = true;
      }
      var e = t.ease(tweenProgress(t, local));
      for (var m = 0; m < t.props.length; m++) {
        var pr = t.props[m];
        t.target[pr.name] = t.from[pr.name] + (pr.end - t.from[pr.name]) * e;
      }
    }
  };
  function timeline(opts) { return new Timeline(opts); }

  function classicCycle(state, pause) {
    return timeline({ repeat: -1, repeatDelay: pause })
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
    return timeline({ repeat: -1, repeatDelay: pause })
      .set(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0 })
      .to(state, { beat: -1.0, flap: -0.06, bend: 0.1, compression: 0.24, lift: -0.06, duration: 0.18, ease: "sine.inOut" })
      .to(state, { beat: 0.33, flap: 0.34, bend: 0.42, compression: 0, lift: 0.6, duration: 0.24, ease: "power3.out" })
      .to(state, { tipLag: 0.85, lift: 0.8, duration: 0.22, ease: "power2.out" }, "-=0.1")
      .to(state, { beat: -0.47, flap: 0.04, bend: 0.2, compression: 0.12, lift: 0.52, duration: 0.16, ease: "power2.inOut" })
      .to(state, { tipLag: -0.2, duration: 0.16, ease: "sine.inOut" }, "<")
      .to(state, { beat: 0, flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.28, ease: "sine.inOut" });
  }

  function buildIdle(state) {
    return timeline()
      .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: SETTLE, ease: "power2.out" })
      .to(state, { lift: 0.22, flap: 0.07, bend: 0.06, duration: 1.7, ease: "sine.inOut", repeat: -1, yoyo: true });
  }
  function buildConnecting(state) {
    var tl = timeline().set(state, REST_CHANNELS);
    for (var i = 0; i < 2; i++) {
      tl.to(state, { flap: 0.4, bend: 0.25, compression: 0.16, lift: 0.2, duration: 0.1, ease: "power2.out" })
        .to(state, { flap: 0, bend: 0.05, compression: 0.02, lift: 0.05, duration: 0.13, ease: "power2.in" })
        .to(state, {}, "+=0.08");
    }
    return tl.to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.15, ease: "power2.out" });
  }
  function buildSuccess(state) {
    return timeline().set(state, REST_CHANNELS)
      .to(state, { flap: 1, bend: 0.5, compression: 0.4, tipLag: 0.5, lift: 0.85, duration: 0.1, ease: "power4.out" })
      .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.5, ease: "elastic.out(1,0.4)" });
  }
  function buildError(state) {
    return timeline().set(state, REST_CHANNELS)
      .to(state, { flap: 0.2, duration: 0.05, ease: "power1.out" })
      .to(state, { flap: -0.1, duration: 0.05, ease: "power1.inOut" })
      .to(state, { flap: 0.12, duration: 0.05, ease: "power1.inOut" })
      .to(state, { flap: -0.08, duration: 0.05, ease: "power1.inOut" })
      .to(state, { flap: -0.16, bend: 0.12, compression: 0.08, lift: -0.18, duration: 0.25, ease: "power2.out" });
  }

  const PAIR = 2;
  const TRIPLE = 3;
  const RGBA_STRIDE = 4;
  const ALPHA_OFFSET = 3;
  const EDGE_PX = 2;
  const INK_PAD_PX = 4;
  const DST = new Float64Array(TRIPLE * PAIR);
  const PUSH = new Float64Array(TRIPLE);
  const BOX = { left: 0, top: 0, width: 0, height: 0 };

  function combine(coef, offset) {
    return coef[0] * DST[offset] + coef[1] * DST[offset + PAIR] + coef[2] * DST[offset + PAIR + PAIR];
  }
  function loadCorners(scr, verts) {
    for (let j = 0; j < TRIPLE; j++) {
      DST[j * PAIR] = scr[verts[j]];
      DST[j * PAIR + 1] = scr[verts[j] + 1];
    }
    const cx = (DST[0] + DST[PAIR] + DST[PAIR + PAIR]) / TRIPLE;
    const cy = (DST[1] + DST[PAIR + 1] + DST[PAIR + PAIR + 1]) / TRIPLE;
    for (let j = 0; j < TRIPLE; j++) {
      PUSH[j] = 1 + SEAM_PAD / (Math.hypot(DST[j * PAIR] - cx, DST[j * PAIR + 1] - cy) || 1);
    }
    return { cx: cx, cy: cy };
  }
  function sourceBox(tri, view) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = 0; j < TRIPLE; j++) {
      const sx = tri.center.px + (tri.src[j].px - tri.center.px) * PUSH[j];
      const sy = tri.center.py + (tri.src[j].py - tri.center.py) * PUSH[j];
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    BOX.left = Math.max(0, Math.floor(minX - EDGE_PX));
    BOX.top = Math.max(0, Math.floor(minY - EDGE_PX));
    BOX.width = Math.min(view.width, Math.ceil(maxX + EDGE_PX)) - BOX.left;
    BOX.height = Math.min(view.height, Math.ceil(maxY + EDGE_PX)) - BOX.top;
  }
  function drawTriangle(ctx, tri, view) {
    const middle = loadCorners(view.scr, tri.verts);
    sourceBox(tri, view);
    if (BOX.width <= 0 || BOX.height <= 0) return;
    ctx.save();
    ctx.beginPath();
    for (let j = 0; j < TRIPLE; j++) {
      ctx.lineTo(middle.cx + (DST[j * PAIR] - middle.cx) * PUSH[j], middle.cy + (DST[j * PAIR + 1] - middle.cy) * PUSH[j]);
    }
    ctx.closePath();
    ctx.clip();
    const dpr = view.dpr;
    ctx.setTransform(
      combine(tri.coefA, 0) * dpr, combine(tri.coefA, 1) * dpr,
      combine(tri.coefC, 0) * dpr, combine(tri.coefC, 1) * dpr,
      combine(tri.coefE, 0) * dpr, combine(tri.coefE, 1) * dpr);
    ctx.drawImage(view.img, BOX.left, BOX.top, BOX.width, BOX.height, BOX.left, BOX.top, BOX.width, BOX.height);
    ctx.restore();
  }

  function hexToRgb(hex) {
    var bigint = parseInt(hex.replace("#", ""), 16);
    var r = (bigint >> 16) & 0xff;
    var g = (bigint >> 8) & 0xff;
    var b = bigint & 0xff;
    return r + "," + g + "," + b;
  }
  var GOLD_RGB = hexToRgb(HERMES_GOLD);

  function defaultGrid(size) {
    return size <= COARSE_MAX_SIZE_PX ? GRID_COARSE : GRID_FINE;
  }

  function readInk(img, doc) {
    try {
      const layer = doc.createElement("canvas");
      layer.width = img.naturalWidth;
      layer.height = img.naturalHeight;
      const layerCtx = layer.getContext("2d");
      layerCtx.drawImage(img, 0, 0);
      return { data: layerCtx.getImageData(0, 0, layer.width, layer.height).data, cols: layer.width, rows: layer.height };
    } catch {
      return null;
    }
  }
  function hasInk(ink, rect) {
    if (!ink) return true;
    const rowEnd = Math.min(ink.rows, Math.ceil(rect.bottom)), colEnd = Math.min(ink.cols, Math.ceil(rect.right));
    for (let row = Math.max(0, Math.floor(rect.top)); row < rowEnd; row++) {
      for (let col = Math.max(0, Math.floor(rect.left)); col < colEnd; col++) {
        if (ink.data[(row * ink.cols + col) * RGBA_STRIDE + ALPHA_OFFSET]) return true;
      }
    }
    return false;
  }
  function cornerOf(original, vertex) {
    return { px: original[vertex * PAIR], py: original[vertex * PAIR + 1] };
  }
  function makeTriangle(original, vertices) {
    const src = vertices.map((vertex) => cornerOf(original, vertex));
    const [p0, p1, p2] = src;
    const den = p0.px * (p1.py - p2.py) - p1.px * (p0.py - p2.py) + p2.px * (p0.py - p1.py);
    if (!den) return null;
    return {
      verts: vertices.map((vertex) => vertex * PAIR),
      src: src,
      center: { px: (p0.px + p1.px + p2.px) / TRIPLE, py: (p0.py + p1.py + p2.py) / TRIPLE },
      coefA: [(p1.py - p2.py) / den, (p2.py - p0.py) / den, (p0.py - p1.py) / den],
      coefC: [(p2.px - p1.px) / den, (p0.px - p2.px) / den, (p1.px - p0.px) / den],
      coefE: [(p1.px * p2.py - p2.px * p1.py) / den, (p2.px * p0.py - p0.px * p2.py) / den, (p0.px * p1.py - p1.px * p0.py) / den],
    };
  }
  function buildTriangles(layout, original) {
    const { grid, ink, width, height } = layout, cols = grid.x + 1, triangles = [];
    for (let row = 0; row < grid.y; row++) {
      for (let col = 0; col < grid.x; col++) {
        const rect = {
          left: (col / grid.x) * width - INK_PAD_PX, top: (row / grid.y) * height - INK_PAD_PX,
          right: ((col + 1) / grid.x) * width + INK_PAD_PX, bottom: ((row + 1) / grid.y) * height + INK_PAD_PX,
        };
        if (!hasInk(ink, rect)) continue;
        const corner = row * cols + col, opposite = corner + cols + 1;
        triangles.push(makeTriangle(original, [corner, corner + 1, opposite]), makeTriangle(original, [corner, opposite, corner + cols]));
      }
    }
    return triangles.filter(Boolean);
  }

  function buildDeformContext(img, grid, doc) {
    var imgW = img.naturalWidth, imgH = img.naturalHeight;
    var cols = grid.x + 1, rows = grid.y + 1, vcount = cols * rows;
    var original = new Float32Array(vcount * 2);
    for (var gy = 0; gy < rows; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        var vi = (gy * cols + gx) * 2;
        original[vi] = (gx / grid.x) * imgW;
        original[vi + 1] = (gy / grid.y) * imgH;
      }
    }
    var rootX = DEFAULT_ROOT.x * imgW, rootY = DEFAULT_ROOT.y * imgH;
    var wgt = buildWeights(original, rootX, rootY);
    return {
      img: img, toWing: imgW ? WING_IMAGE_BASE_PX / imgW : 1, cols: cols, rows: rows, segX: grid.x, segY: grid.y,
      original: original, live: original.slice(), scr: new Float32Array(vcount * 2),
      weights: wgt.weights, weightsTip: wgt.weightsTip, rootX: rootX, rootY: rootY,
      triangles: buildTriangles({ grid: grid, ink: readInk(img, doc), width: imgW, height: imgH }, original),
    };
  }

  function goldTintAlpha(s) {
    var pulse = Math.max(s.flap, s.lift, 0);
    return Math.min(1, Math.max(0, GOLD_STRENGTH + GOLD_PULSE_GAIN * pulse));
  }

  function mount(host, opts) {
    opts = opts || {};
    var size = opts.size || DEFAULT_SIZE_PX;
    var status = opts.status || DEFAULT_STATUS;
    var fpsCap = opts.fpsCap || FPS_CAP_DEFAULT;
    var grid = opts.grid || defaultGrid(size);
    var preset = opts.preset || DEFAULT_PRESET;
    var effectiveGold = GOLD_ENABLED && !!opts.gold;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var ambient = !reduce;

    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.style.display = "block";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    var ctx2d = canvas.getContext("2d");
    if (!ctx2d) throw new Error("HermesWingCanvas: 2D-Context nicht verfuegbar");

    var scale = size / WING_FIT, cxv = size / 2, cyv = size / 2;
    var state = restState(), tl = null, dctx = null;
    var raf = 0, running = false, stopped = false, last = 0, acc = 0;
    var frameBudgetSec = FRAME_BUDGET_TOLERANCE / fpsCap;
    var clock = performance.now();
    var onScreen = true, pageVisible = document.visibilityState !== "hidden";
    var io = null, onVis = null;

    function computeScreen() {
      var liftPx = state.lift * LIFT_GAIN_PX * state.intensity;
      var ax = 0, ay = 0, sway = 0;
      if (ambient) {
        var t = (performance.now() - clock) / 1000;
        ax = Math.sin(t * 0.9) * AMBIENT_X_PX;
        ay = Math.sin(t * 1.7 + 1.3) * AMBIENT_Y_PX;
        sway = Math.sin(t * 0.6) * AMBIENT_ROT;
      }
      var hx = -WING_CENTER_X + ax, hy = -WING_CENTER_Y - liftPx + ay;
      var cos = Math.cos(sway), sin = Math.sin(sway);
      deform(dctx, state, dctx.live);
      var vcount = dctx.cols * dctx.rows;
      for (var i = 0; i < vcount; i++) {
        var lx = (dctx.live[i * 2] * dctx.toWing + hx) * scale, ly = (dctx.live[i * 2 + 1] * dctx.toWing + hy) * scale;
        dctx.scr[i * 2] = cxv + (lx * cos - ly * sin);
        dctx.scr[i * 2 + 1] = cyv + (lx * sin + ly * cos);
      }
    }
    function drawMesh() {
      var view = { scr: dctx.scr, img: dctx.img, dpr: dpr, width: dctx.img.naturalWidth, height: dctx.img.naturalHeight };
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const tri of dctx.triangles) drawTriangle(ctx2d, tri, view);
    }
    function applyGoldTint() {
      var alpha = goldTintAlpha(state);
      ctx2d.globalCompositeOperation = "source-atop";
      ctx2d.fillStyle = "rgba(" + GOLD_RGB + "," + alpha.toFixed(3) + ")";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.globalCompositeOperation = "source-over";
    }
    function render() {
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      drawMesh();
      if (effectiveGold) applyGoldTint();
    }
    function isTerminalDone() {
      return !!TERMINAL_WING_STATUSES[status] && !!tl && tl.time >= tl.iterationDuration();
    }
    function frame(now) {
      var dt = (now - last) / 1000; last = now;
      if (dt > TAB_SWITCH_DT_CAP_SEC) dt = TAB_SWITCH_DT_CAP_SEC;
      acc += dt;
      if (acc < frameBudgetSec) { raf = requestAnimationFrame(frame); return; }
      if (tl) tl.step(acc);
      acc = 0;
      computeScreen();
      render();
      if (isTerminalDone()) { running = false; raf = 0; stopped = true; return; }
      raf = requestAnimationFrame(frame);
    }
    function startLoop() {
      if (running) return;
      running = true; last = performance.now(); acc = 0;
      raf = requestAnimationFrame(frame);
    }
    function stopLoop() {
      if (!running) return;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    function syncRun() {
      if (!dctx || reduce || stopped) return;
      if (onScreen && pageVisible) startLoop(); else stopLoop();
    }
    function applyReducedPose() {
      state.flap = 0; state.bend = 0; state.compression = 0; state.tipLag = 0; state.lift = 0;
      tl = null;
      computeScreen();
      render();
    }
    function workingCycle() {
      var cycle = (preset === "olympian" ? olympianCycle : classicCycle)(state, 0);
      cycle.repeatDelay = WING_CYCLE_SEC - cycle.iterationDuration();
      return cycle;
    }
    function applyStatus(next) {
      status = next;
      state.beat = 0; state.rootRotation = 0;
      if (tl) tl.kill();
      if (next === "connecting") tl = buildConnecting(state);
      else if (next === "working") tl = workingCycle();
      else if (next === "success") tl = buildSuccess(state);
      else if (next === "error") tl = buildError(state);
      else tl = buildIdle(state);
      tl.timeScale(state.speed);
      tl.play(0);
      stopped = false;
      if (reduce) { applyReducedPose(); return; }
      syncRun();
    }
    function requestStatus(next) {
      var changed = next !== status;
      status = next;
      if (dctx && changed) applyStatus(next);
    }

    var img = opts.image || new Image();
    function onImageReady() {
      dctx = buildDeformContext(img, grid, host.ownerDocument);
      applyStatus(status);
    }
    if (opts.image && img.complete && img.naturalWidth) onImageReady();
    else if (opts.image) img.addEventListener("load", onImageReady);
    else {
      img.onload = onImageReady;
      img.src = opts.src;
    }

    if (!reduce) {
      onVis = function () { pageVisible = document.visibilityState === "visible"; syncRun(); };
      document.addEventListener("visibilitychange", onVis);
      io = new IntersectionObserver(function (entries) {
        onScreen = !!(entries[0] && entries[0].isIntersecting);
        syncRun();
      }, { threshold: INTERSECTION_THRESHOLD });
      io.observe(host);
    }

    return {
      setStatus: requestStatus,
      destroy: function () {
        if (io) io.disconnect();
        if (onVis) document.removeEventListener("visibilitychange", onVis);
        stopLoop();
        if (tl) tl.kill();
        if (canvas.parentNode === host) host.removeChild(canvas);
      },
    };
  }

  window.HermesWingCanvas = { mount: mount };
})();
