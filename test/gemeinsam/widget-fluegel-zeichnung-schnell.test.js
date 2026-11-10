import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const BILD = 224;
const ZELLEN_FEIN = 16 * 24;
const DREIECKE_FEIN = ZELLEN_FEIN * 2;
const WIDGETS = await ausgelieferteWidgets();
const ENGINE = skriptbloecke(WIDGETS.call).find((block) => block.includes("HermesWingCanvas") && block.includes("FPS_CAP_DEFAULT"));

function tinte(bis) {
  const data = new Uint8ClampedArray(BILD * BILD * 4);
  for (let y = 0; y < BILD; y += 1) for (let x = 0; x < bis; x += 1) data[(y * BILD + x) * 4 + 3] = 255;
  return data;
}

function zeichne({ alpha, ruhepose = true }) {
  const aufrufe = [];
  const recorder = new Proxy({}, {
    get(_target, name) {
      if (name === "getImageData") {
        return () => {
          if (!alpha) throw new Error("Pixel nicht lesbar");
          return { data: alpha };
        };
      }
      return (...args) => { aufrufe.push({ name, args }); };
    },
    set() { return true; },
  });
  const neueLeinwand = () => ({ style: {}, parentNode: null, setAttribute() {}, getContext: () => recorder });
  const sandbox = {
    document: { visibilityState: "visible", createElement: neueLeinwand, addEventListener() {}, removeEventListener() {} },
    performance: { now: () => 1000 },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: ruhepose }),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  sandbox.window = sandbox;
  sandbox.process = process;
  vm.createContext(sandbox);
  vm.runInContext(ENGINE, sandbox);
  const host = { appendChild: (el) => el, removeChild: (el) => el, ownerDocument: sandbox.document };
  const image = { complete: true, naturalWidth: BILD, naturalHeight: BILD };
  sandbox.window.HermesWingCanvas.mount(host, { status: "working", image, size: 112, fpsCap: 60 });
  return aufrufe;
}

function anzahl(aufrufe, name) {
  return aufrufe.filter((aufruf) => aufruf.name === name).length;
}

function dreiecke(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.name === "drawImage" && aufruf.args.length === 9);
}

test("T-fluegel-zeichnung-leere-zellen: Zellen ohne Bildpunkte werden pro Bild nicht gezeichnet", () => {
  const aufrufe = zeichne({ alpha: tinte(BILD / 4) });
  const gezeichnet = dreiecke(aufrufe).length;
  assert.ok(gezeichnet > 0, "der sichtbare Teil wird gezeichnet");
  assert.ok(gezeichnet < DREIECKE_FEIN / 2, `gezeichnet: ${gezeichnet}`);
  assert.equal(anzahl(aufrufe, "clip"), gezeichnet);
});

test("T-fluegel-zeichnung-ohne-lesbare-pixel: ohne lesbare Bildpunkte wird der ganze Fluegel gezeichnet", () => {
  const aufrufe = zeichne({ alpha: null });
  assert.equal(dreiecke(aufrufe).length, DREIECKE_FEIN);
});

test("T-fluegel-zeichnung-teilbild: jedes Dreieck zeichnet nur seinen Bildausschnitt", () => {
  const aufrufe = dreiecke(zeichne({ alpha: tinte(BILD) }));
  assert.equal(aufrufe.length, DREIECKE_FEIN);
  for (const { args } of aufrufe) {
    assert.equal(args.length, 9);
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = args;
    assert.deepEqual([dx, dy, dw, dh], [sx, sy, sw, sh]);
    assert.ok(sw > 0 && sh > 0 && sw < BILD / 2 && sh < BILD / 2, `Ausschnitt ${sw}x${sh}`);
  }
});

test("T-fluegel-zeichnung-lage: in Ruhepose liegt jedes Dreieck mit derselben Abbildung im Bild", () => {
  const aufrufe = zeichne({ alpha: tinte(BILD) });
  const matrizen = aufrufe.filter((aufruf) => aufruf.name === "setTransform" && aufruf.args[0] !== 1).map((aufruf) => aufruf.args);
  assert.equal(matrizen.length, DREIECKE_FEIN);
  const [erste] = matrizen;
  assert.ok(erste[0] > 0 && erste[3] > 0);
  for (const matrix of matrizen) {
    matrix.forEach((wert, i) => assert.ok(Math.abs(wert - erste[i]) < 1e-3, `Eintrag ${i}: ${wert} statt ${erste[i]}`));
  }
});

test("T-fluegel-zeichnung-zustand: jedes Dreieck sichert und stellt den Zeichenzustand wieder her", () => {
  const aufrufe = zeichne({ alpha: tinte(BILD) });
  assert.equal(anzahl(aufrufe, "save"), anzahl(aufrufe, "restore"));
  assert.equal(anzahl(aufrufe, "save"), anzahl(aufrufe, "clip"));
});
