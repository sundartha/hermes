import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HUD_CARD_CSS } from "../src/ui/hud-card-css.js";

const scriptPath = fileURLToPath(new URL("../src/ui/wing-canvas-mount-idle.js", import.meta.url));
const SCRIPT_SOURCE = readFileSync(scriptPath, "utf8");

function makeFakeElement({ src } = {}) {
  return { style: {}, src };
}

function runInSandbox({ hasEngine = true, mountImpl, querySelectorAnswers = {} } = {}) {
  const mountCalls = [];
  const defaultMountImpl = () => {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = {
    querySelector(selector) {
      return Object.prototype.hasOwnProperty.call(querySelectorAnswers, selector)
        ? querySelectorAnswers[selector]
        : null;
    },
  };
  if (hasEngine) {
    sandbox.window.HermesWingCanvas = {
      mount(host, opts) {
        mountCalls.push({ host, opts });
        return (mountImpl || defaultMountImpl)(host, opts);
      },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_SOURCE, sandbox);
  return { sandbox, mountCalls };
}

test("T-wing-mount-idle-no-engine: HermesWingCanvas fehlt -> kein Crash, kein mount()-Aufruf", () => {
  assert.doesNotThrow(() => runInSandbox({ hasEngine: false }));
});

test("T-wing-mount-idle-no-host: [data-wing-canvas] fehlt -> frueher Return, kein mount()-Aufruf", () => {
  const wingImg = makeFakeElement({ src: "data:image/png;base64,x" });
  const { mountCalls } = runInSandbox({
    querySelectorAnswers: { ".wing img": wingImg },
  });
  assert.equal(mountCalls.length, 0, "kein mount()-Aufruf ohne Host");
});

test("T-wing-mount-idle-no-img: .wing img fehlt -> frueher Return, kein mount()-Aufruf", () => {
  const host = {};
  const { mountCalls } = runInSandbox({
    querySelectorAnswers: { "[data-wing-canvas]": host },
  });
  assert.equal(mountCalls.length, 0, "kein mount()-Aufruf ohne Wing-Bild");
});

test("T-wing-mount-idle-mount-throws: mount() wirft -> kein Crash, .wing bleibt sichtbar", () => {
  const host = {};
  const wingImg = makeFakeElement({ src: "data:image/png;base64,x" });
  const wing = makeFakeElement();
  assert.doesNotThrow(() =>
    runInSandbox({
      mountImpl: () => { throw new Error("kein 2D-Context"); },
      querySelectorAnswers: { "[data-wing-canvas]": host, ".wing img": wingImg, ".wing": wing },
    }),
  );
});

test("T-wing-mount-idle-success: mount() gelingt -> exakte Optionen, .wing wird display:none", () => {
  const host = {};
  const wingImg = makeFakeElement({ src: "data:image/png;base64,x" });
  const wing = makeFakeElement();
  const { mountCalls } = runInSandbox({
    querySelectorAnswers: { "[data-wing-canvas]": host, ".wing img": wingImg, ".wing": wing },
  });

  assert.equal(mountCalls.length, 1, "genau ein mount()-Aufruf");
  assert.equal(mountCalls[0].host, host, "Host ist der [data-wing-canvas]-Container");
  const opts = mountCalls[0].opts;
  assert.equal(Object.keys(opts).sort().join(","), "fpsCap,size,src,status", "Options tragen genau diese vier Felder");
  assert.equal(opts.size, 86, "size=86");
  assert.equal(opts.fpsCap, 24, "fpsCap=24");
  assert.equal(opts.status, "idle", "status=idle");
  assert.equal(opts.src, wingImg.src, "src = wingImg.src");
  assert.equal(wing.style.display, "none", ".wing wird nach Erfolg versteckt (Canvas ersetzt die CSS-Marke)");
});

test("T-wing-mount-idle-drift-guard: WING_CANVAS_SIZE_PX deckt sich mit --wing-size in HUD_CARD_CSS (86)", () => {
  assert.match(SCRIPT_SOURCE, /var WING_CANVAS_SIZE_PX = 86;/, "benannte Konstante WING_CANVAS_SIZE_PX=86 im Quelltext");
  assert.match(HUD_CARD_CSS, /--wing-size:86px/, "hud-card-css.js traegt denselben Wert");
});

test("T-wing-mount-idle-fps-cap-constant: WING_CANVAS_FPS_CAP=24 als benannte Konstante (H0-Entscheidungsregel)", () => {
  assert.match(SCRIPT_SOURCE, /var WING_CANVAS_FPS_CAP = 24;/, "benannte Konstante WING_CANVAS_FPS_CAP=24 im Quelltext");
});
