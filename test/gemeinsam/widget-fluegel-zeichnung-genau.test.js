import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const BILD = 224;
const SPALTEN = 16;
const ZEILEN = 24;
const RAND_PX = 4;
const WIDGETS = await ausgelieferteWidgets();
const ENGINE = skriptbloecke(WIDGETS.call).find((block) => block.includes("HermesWingCanvas") && block.includes("FPS_CAP_DEFAULT"));

function zeichne({ alpha, dpr = 1, hoehe = BILD }) {
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
  const neueLeinwand = (tag) => {
    assert.equal(tag, "canvas");
    return {
      style: {},
      parentNode: null,
      setAttribute() {},
      getContext: (art) => (art === "2d" ? recorder : null),
    };
  };
  const sandbox = {
    document: { visibilityState: "visible", createElement: neueLeinwand, addEventListener() {}, removeEventListener() {} },
    performance: { now: () => 1000 },
    devicePixelRatio: dpr,
    matchMedia: () => ({ matches: true }),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  sandbox.window = sandbox;
  sandbox.process = process;
  vm.createContext(sandbox);
  vm.runInContext(ENGINE, sandbox);
  const host = { appendChild: (el) => el, removeChild: (el) => el, ownerDocument: sandbox.document };
  const image = { complete: true, naturalWidth: BILD, naturalHeight: hoehe };
  sandbox.window.HermesWingCanvas.mount(host, { status: "working", image, size: 112, fpsCap: 60 });
  return aufrufe;
}

function einPixel(x, y) {
  const data = new Uint8ClampedArray(BILD * BILD * 4);
  data[(y * BILD + x) * 4 + 3] = 1;
  return data;
}

function erwarteteDreiecke(x, y) {
  let zellen = 0;
  for (let zeile = 0; zeile < ZEILEN; zeile++) {
    for (let spalte = 0; spalte < SPALTEN; spalte++) {
      const links = Math.floor((spalte / SPALTEN) * BILD - RAND_PX);
      const rechts = Math.ceil(((spalte + 1) / SPALTEN) * BILD + RAND_PX);
      const oben = Math.floor((zeile / ZEILEN) * BILD - RAND_PX);
      const unten = Math.ceil(((zeile + 1) / ZEILEN) * BILD + RAND_PX);
      if (x >= links && x < rechts && y >= oben && y < unten) zellen++;
    }
  }
  return zellen * 2;
}

function ausschnitte(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.name === "drawImage" && aufruf.args.length === 9);
}

function matrizen(aufrufe) {
  return aufrufe
    .map((aufruf, nr) => (aufruf.name === "drawImage" && aufruf.args.length === 9 ? aufrufe[nr - 1].args : null))
    .filter(Boolean);
}

test("T-fluegel-zeichnung-pixel: ein einzelner Bildpunkt macht genau die Zellen sichtbar, deren Rand ihn einschliesst", () => {
  for (let i = 0; i < BILD; i++) {
    const x = (i * 7) % BILD;
    const gezeichnet = ausschnitte(zeichne({ alpha: einPixel(x, i) })).length;
    assert.equal(gezeichnet, erwarteteDreiecke(x, i), `Punkt ${x}/${i}`);
  }
});

test("T-fluegel-zeichnung-dpr: die Abbildung jedes Dreiecks waechst mit der Pixeldichte, Verschiebung eingeschlossen", () => {
  const alpha = new Uint8ClampedArray(BILD * BILD * 4).fill(255);
  const einfach = matrizen(zeichne({ alpha, dpr: 1 }));
  const doppelt = matrizen(zeichne({ alpha, dpr: 2 }));
  assert.equal(einfach.length, SPALTEN * ZEILEN * 2);
  assert.equal(doppelt.length, einfach.length);
  einfach.forEach((matrix, nr) => matrix.forEach((wert, i) => {
    assert.ok(Math.abs(doppelt[nr][i] - 2 * wert) < 1e-6, `Dreieck ${nr} Eintrag ${i}: ${doppelt[nr][i]} statt ${2 * wert}`);
  }));
  const verschiebung = einfach.filter((matrix) => Math.abs(matrix[4]) > 1e-3 && Math.abs(matrix[5]) > 1e-3);
  assert.ok(verschiebung.length > 0, "mindestens ein Dreieck hat eine Verschiebung in beiden Achsen");
});

test("T-fluegel-zeichnung-ohne-hoehe: ein Bild ohne Hoehe zeichnet nichts und bricht nicht ab", () => {
  const aufrufe = zeichne({ alpha: null, hoehe: 0 });
  assert.equal(ausschnitte(aufrufe).length, 0);
});
