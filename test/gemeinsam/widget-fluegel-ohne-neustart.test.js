import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";
import { SZENARIEN } from "./widget-anruffolge-attrappe.mjs";

const DESIGNSYSTEM_ENGINE = "../../design-system/components/brand/wing-canvas-engine.js";
const RETURN_HANDLE_LINE = "      setStatus: requestStatus,";
const SCHREIBVORGAENGE_JE_WECHSEL = 2;
const WECHSEL_IM_ANRUF = 2;
const FRAME_MS = 40;
const STEPS_BEFORE_REPEAT = 4;
const CHROME = findChrome();
const OPTIONS = { skip: CHROME ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 120000 };
const ANRUF = { ...SZENARIEN.voll_de, waehlenS: 2, gespraechS: 30 };

function mitZeitleiste(text) {
  assert.ok(text.includes(RETURN_HANDLE_LINE), "setStatus-Zeile nicht gefunden");
  return text.replace(RETURN_HANDLE_LINE, `${RETURN_HANDLE_LINE} __zeitleiste: function () { return tl; },`);
}

async function engineKopien() {
  const { call } = await ausgelieferteWidgets();
  const imWidget = skriptbloecke(call).find((block) => block.includes(RETURN_HANDLE_LINE));
  assert.ok(imWidget, "Engine im ausgelieferten Widget nicht gefunden");
  const imDesignsystem = readFileSync(fileURLToPath(new URL(DESIGNSYSTEM_ENGINE, import.meta.url)), "utf8");
  return [
    ["im Widget", mitZeitleiste(imWidget)],
    ["im Designsystem", mitZeitleiste(imDesignsystem)],
  ];
}

function montiere(source, status, bildVerzoegert = false) {
  const wartendeBilder = [];
  let nextId = 1;
  const pending = new Map();
  const uhr = { value: 1000 };
  const ctx2d = new Proxy({}, { get: (ziel, name) => (name in ziel ? ziel[name] : () => {}), set: (ziel, name, wert) => Reflect.set(ziel, name, wert) });
  const canvas = { style: {}, parentNode: null, setAttribute() {}, getContext: () => ctx2d };
  const host = { appendChild(el) { return Object.assign(el, { parentNode: this }); }, removeChild() {} };
  function FakeImage() { this.naturalWidth = 200; this.naturalHeight = 400; }
  Object.defineProperty(FakeImage.prototype, "src", { set() { if (typeof this.onload !== "function") return; if (bildVerzoegert) wartendeBilder.push(this.onload); else this.onload(); } });
  const sandbox = {
    document: { visibilityState: "visible", createElement: () => canvas, addEventListener() {}, removeEventListener() {} },
    performance: { now: () => uhr.value },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    Image: FakeImage,
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    requestAnimationFrame: (fn) => { pending.set(nextId, fn); return nextId++; },
    cancelAnimationFrame: (id) => pending.delete(id),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const handle = sandbox.window.HermesWingCanvas.mount(host, { src: "data:image/png;base64,x", status });
  return {
    handle,
    bildLaden() { wartendeBilder.splice(0).forEach((laden) => laden()); },
    bild() {
      uhr.value += FRAME_MS;
      const [[id, fn]] = pending;
      pending.delete(id);
      fn(uhr.value);
    },
  };
}

for (const [ort, source] of await engineKopien()) {
  test(`Flügel-Engine ${ort}: ein Status vor dem fertigen Bild startet nichts und gilt nach dem Laden`, () => {
    const { handle, bild, bildLaden } = montiere(source, "connecting", true);
    handle.setStatus("working");
    assert.equal(handle.__zeitleiste(), undefined, "Zeitleiste vor dem Bild gestartet");
    bildLaden();
    const arbeit = handle.__zeitleiste();
    assert.ok(arbeit, "Zeitleiste nach dem Laden fehlt");
    bild();
    handle.setStatus("working");
    assert.equal(handle.__zeitleiste(), arbeit, "Wiederholung nach dem Laden startete neu");
    handle.setStatus("success");
    assert.notEqual(handle.__zeitleiste(), arbeit, "Wechsel nach dem Laden startete nicht neu");
  });

  test(`Flügel-Engine ${ort}: derselbe Status wiederholt startet die Zeitleiste nicht neu`, () => {
    const { handle, bild } = montiere(source, "working");
    for (let i = 0; i < STEPS_BEFORE_REPEAT; i += 1) bild();
    const laufend = handle.__zeitleiste();
    const zeit = laufend.time;
    assert.ok(zeit > 0, "Zeitleiste läuft nicht");
    for (let poll = 0; poll < 3; poll += 1) {
      handle.setStatus("working");
      assert.equal(handle.__zeitleiste(), laufend, `Poll ${poll + 1} hat die Zeitleiste ersetzt`);
      assert.ok(handle.__zeitleiste().time >= zeit, `Poll ${poll + 1} hat die Zeit zurückgesetzt`);
      bild();
    }
  });

  test(`Flügel-Engine ${ort}: ein Statuswechsel startet genau einmal neu`, () => {
    const { handle, bild } = montiere(source, "connecting");
    bild();
    const verbindung = handle.__zeitleiste();
    handle.setStatus("working");
    const arbeit = handle.__zeitleiste();
    assert.notEqual(arbeit, verbindung, "Wechsel startete nicht neu");
    assert.equal(arbeit.time, 0);
    bild();
    handle.setStatus("working");
    assert.equal(handle.__zeitleiste(), arbeit, "Wiederholung nach dem Wechsel startete neu");
  });
}

test("Karte schreibt die Flügel-Klasse nur bei einem Statuswechsel", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const beobachter = "<script>document.addEventListener('DOMContentLoaded',function(){var w=document.querySelector('[data-wing]');if(!w)return;new MutationObserver(function(){if(parent.__mess)parent.__mess.ereignisse.push({art:'wing_klasse',wert:w.className,ms:0,sim_ms:0});}).observe(w,{attributes:true,attributeFilter:['class']});});</script>";
  assert.ok(call.includes("<head>"), "Kopfbereich fehlt");
  const lauf = await messeAnruffolge(CHROME, call.replace("<head>", `<head>${beobachter}`), { szenario: ANRUF, tempo: 1 });
  const klassen = lauf.zeitliste.filter((eintrag) => eintrag.art === "wing_klasse").map((eintrag) => eintrag.wert);
  assert.ok(klassen.length >= 2, `zu wenige Klassenwechsel: ${klassen.join(" | ")}`);
  assert.ok(klassen.length <= SCHREIBVORGAENGE_JE_WECHSEL * WECHSEL_IM_ANRUF, `Klasse bei gleichem Status neu geschrieben: ${klassen.join(" | ")}`);
});
