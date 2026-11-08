import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WING_BASE64_MAX = 20000;
const GRENZE_ROH = { call: 102400, "my-number": 71680, calls: 71680, "agent-status": 71680 };
const PNG_URI = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g;

test("Jedes ausgelieferte Widget bleibt unter seiner Größengrenze", async () => {
  const widgets = await ausgelieferteWidgets();
  assert.deepEqual(Object.keys(widgets).sort(), Object.keys(GRENZE_ROH).sort());
  for (const [id, grenze] of Object.entries(GRENZE_ROH)) {
    const bytes = Buffer.byteLength(widgets[id]);
    assert.ok(bytes <= grenze, `${id}: ${bytes} B über ${grenze} B`);
  }
});

test("Der Flügel steht je Widget genau einmal und ist höchstens 20.000 B Base64 groß", async () => {
  const widgets = await ausgelieferteWidgets();
  for (const id of Object.keys(GRENZE_ROH)) {
    const bilder = widgets[id].match(PNG_URI) ?? [];
    assert.equal(bilder.length, 1, `${id}: Anzahl Bilder`);
    assert.ok(bilder[0].length <= WING_BASE64_MAX, `${id}: Flügel ${bilder[0].length} B`);
  }
});

function baueUmgebung(engine, optionen, BildKlasse) {
  const wege = [];
  const ctx2d = {
    save() {}, restore() {}, clip() {}, setTransform() {}, clearRect() {}, drawImage() {}, fillRect() {},
    beginPath() {}, closePath() {},
    moveTo(x, y) { wege.push([x, y]); },
    lineTo(x, y) { wege.push([x, y]); },
  };
  const canvas = { style: {}, parentNode: null, setAttribute() {}, getContext: () => ctx2d };
  const host = { appendChild: (el) => el, removeChild() {} };
  const umgebung = { wege, rafFn: null };
  const sandbox = {
    document: { visibilityState: "visible", createElement: () => canvas, addEventListener() {}, removeEventListener() {} },
    performance: { now: () => 1000 },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    requestAnimationFrame: (fn) => { umgebung.rafFn = fn; return 1; },
    cancelAnimationFrame() {},
    Image: BildKlasse,
    process,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engine, sandbox);
  sandbox.window.HermesWingCanvas.mount(host, { size: 86, status: "idle", ...optionen });
  return umgebung;
}

function zeichne(umgebung) {
  if (umgebung.rafFn) {
    umgebung.rafFn(1000);
    umgebung.rafFn(1100);
  }
  return umgebung.wege;
}

const KEIN_NEUES_BILD = function () { throw new Error("neues Bild geladen"); };

function fertigesBild(naturalWidth) {
  return { complete: true, naturalWidth, naturalHeight: naturalWidth, addEventListener() { throw new Error("kein load erwartet"); } };
}

function wartendesBild(eigenschaften) {
  const bild = { naturalHeight: eigenschaften.naturalWidth, ...eigenschaften, geladen: null };
  bild.addEventListener = (art, fn) => { assert.equal(art, "load"); bild.geladen = fn; };
  return bild;
}

async function engineAusCall() {
  const { call } = await ausgelieferteWidgets();
  const engine = skriptbloecke(call).find((block) => block.includes("HermesWingCanvas"));
  assert.ok(engine, "Engine nicht im ausgelieferten Widget");
  return engine;
}

function rundeWege(wege) {
  return wege.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(";");
}

function hashVon(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const WEGE_ANZAHL = 576;
const WEGE_HASH = "ceda4a25e190ef2c6066a143a394cb5502cac087474a045b296160848e93fce1";
const ERSTE_PUNKTE = [[-3.38, 0.96], [9.35, 0.78], [9.18, 9.39], [-3.12, 0.59]];
const LETZTER_PUNKT = [76.47, 92.76];

test("Ein 500-px-Bild wird in der Karte an festen Koordinaten gezeichnet", async () => {
  const wege = zeichne(baueUmgebung(await engineAusCall(), { image: fertigesBild(500) }, KEIN_NEUES_BILD));
  assert.equal(wege.length, WEGE_ANZAHL);
  assert.equal(hashVon(rundeWege(wege)), WEGE_HASH);
  ERSTE_PUNKTE.forEach(([x, y], i) => {
    assert.ok(Math.abs(wege[i][0] - x) < 0.01 && Math.abs(wege[i][1] - y) < 0.01, `Punkt ${i}: ${wege[i]}`);
  });
  const letzter = wege[wege.length - 1];
  assert.ok(Math.abs(letzter[0] - LETZTER_PUNKT[0]) < 0.01 && Math.abs(letzter[1] - LETZTER_PUNKT[1]) < 0.01, `letzter Punkt ${letzter}`);
});

test("Ein 224-px-Bild landet an denselben festen Koordinaten, ohne dass ein Bild neu geladen wird", async () => {
  const engine = await engineAusCall();
  const klein = zeichne(baueUmgebung(engine, { image: fertigesBild(224) }, KEIN_NEUES_BILD));
  assert.equal(klein.length, WEGE_ANZAHL);
  ERSTE_PUNKTE.forEach(([x, y], i) => {
    assert.ok(Math.abs(klein[i][0] - x) < 0.01 && Math.abs(klein[i][1] - y) < 0.01, `Punkt ${i}: ${klein[i]}`);
  });
  assert.equal(hashVon(rundeWege(klein)), WEGE_HASH);
});

test("Ein noch nicht geladenes Bild wird erst nach dem load-Ereignis gezeichnet", async () => {
  const engine = await engineAusCall();
  const bild = wartendesBild({ complete: false, naturalWidth: 224 });
  const umgebung = baueUmgebung(engine, { image: bild }, KEIN_NEUES_BILD);
  assert.equal(typeof bild.geladen, "function", "kein load-Handler registriert");
  assert.equal(zeichne(umgebung).length, 0, "vor dem Laden gezeichnet");
  bild.geladen();
  assert.equal(zeichne(umgebung).length, WEGE_ANZAHL);
});

test("Ein Bild ohne Breite wird erst nach dem load-Ereignis gezeichnet, auch wenn es als fertig gilt", async () => {
  const engine = await engineAusCall();
  const bild = wartendesBild({ complete: true, naturalWidth: 0 });
  const umgebung = baueUmgebung(engine, { image: bild }, KEIN_NEUES_BILD);
  assert.equal(typeof bild.geladen, "function", "kein load-Handler registriert");
  assert.equal(zeichne(umgebung).length, 0);
});

test("Ein Bild, das nicht als fertig gilt, wartet auch bei vorhandener Breite", async () => {
  const engine = await engineAusCall();
  const bild = wartendesBild({ naturalWidth: 224 });
  const umgebung = baueUmgebung(engine, { image: bild }, KEIN_NEUES_BILD);
  assert.equal(typeof bild.geladen, "function", "kein load-Handler registriert");
  assert.equal(zeichne(umgebung).length, 0);
});

test("Ohne Option image lädt die Engine das Bild über src in ein neues Image", async () => {
  const engine = await engineAusCall();
  const geladen = [];
  function BildKlasse() {
    this.complete = true;
    this.naturalWidth = 500;
    this.naturalHeight = 500;
    Object.defineProperty(this, "src", { set: (wert) => { geladen.push(wert); this.onload(); } });
  }
  const wege = zeichne(baueUmgebung(engine, { src: "data:image/png;base64,eA==" }, BildKlasse));
  assert.deepEqual(geladen, ["data:image/png;base64,eA=="]);
  assert.equal(hashVon(rundeWege(wege)), WEGE_HASH);
});
