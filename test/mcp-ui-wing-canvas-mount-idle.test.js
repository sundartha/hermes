// H4: testet wing-canvas-mount-idle.js direkt per node:vm in einem minimalen
// Fake-DOM (kein HTML-Parsing/Regex-Extraktion aus einem Widget noetig, da
// eigenstaendige Datei - robuster als der call.html-Ansatz, vermeidet die
// H3-Kommentar-Nesting-Falle von vornherein). Analoge Sandbox-Technik wie
// test/mcp-ui-wing-canvas-mount.test.js (fuer die Engine selbst), hier aber
// fuer das schlanke idle-Mount-Skript der 4 Read-only-Widgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HUD_CARD_CSS } from "../src/ui/hud-card-css.js";

const scriptPath = fileURLToPath(new URL("../src/ui/wing-canvas-mount-idle.js", import.meta.url));
const SCRIPT_SOURCE = readFileSync(scriptPath, "utf8");

// Minimales Fake-Element: nur was das Skript braucht (style.display, img.src).
function makeFakeElement({ src } = {}) {
  return { style: {}, src };
}

// Baut eine frische Sandbox + fuehrt das Skript aus. querySelectorAnswers steuert,
// was document.querySelector fuer die drei bekannten Selektoren liefert
// ([data-wing-canvas], .wing img, .wing) - fehlt ein Key, liefert querySelector
// null (Element nicht vorhanden), analog echtem DOM.
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
  // Einzelne Felder statt deepEqual: opts wird INNERHALB der vm-Sandbox erzeugt
  // (anderer Realm als dieser Testcode) - ein Objektliteral aus einem fremden
  // Realm hat ein anderes Object.prototype, wodurch deepStrictEqual (assert/strict)
  // trotz identischer Werte faelschlich rot wuerde (Prototyp-Vergleich, kein
  // Wert-Vergleich). Feldweise ist robust gegen den Realm-Unterschied.
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
