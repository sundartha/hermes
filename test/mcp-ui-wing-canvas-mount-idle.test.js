import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { HUD_CARD_CSS } from "../src/ui/hud-card-css.js";
import { ausgelieferteWidgets, skriptbloecke } from "./gemeinsam/ausgelieferte-widgets.js";

const MOUNT_HOST = "[data-wing-canvas]";
const ANZEIGE_WIDGET = "agent-status";
const [SCRIPT_SOURCE] = skriptbloecke((await ausgelieferteWidgets())[ANZEIGE_WIDGET]).filter((block) =>
  block.includes(MOUNT_HOST),
);

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
  const { mountCalls } = runInSandbox({
    querySelectorAnswers: {
      [MOUNT_HOST]: {},
      ".wing img": makeFakeElement({ src: "data:image/png;base64,x" }),
      ".wing": makeFakeElement(),
    },
  });
  const groesse = mountCalls[0].opts.size;
  assert.ok(HUD_CARD_CSS.includes(`--wing-size:${groesse}px`), "hud-card-css.js traegt denselben Wert");
});
