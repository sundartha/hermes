import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { widgetPins } from "../../src/ui/registry.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const ANRUF = (await ausgelieferteWidgets()).call;
const NEUE_VERSION = 37;
const ERGEBNIS = "ui/notifications/tool-result";
const KURVE = "cubic-bezier(.22,1,.36,1)";

function stil() {
  const bloecke = [...ANRUF.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  return bloecke.join("\n").replace(/\s+/g, "");
}

function regel(css, selektor) {
  const name = selektor.replace(/\s+/g, "");
  const start = css.indexOf("}" + name + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return css.slice(start + name.length + 2, css.indexOf("}", start + 1));
}

function knoten() {
  return { className: "", style: {}, _text: "", children: [], firstChild: null, get textContent() { return this._text; }, set textContent(w) { this._text = w; }, setAttribute() {}, removeAttribute() {}, addEventListener() {} };
}

function karte(optionen = {}) {
  const anstoss = knoten();
  const takt = [];
  anstoss.addEventListener = (art, f) => takt.push({ art, f });
  const elemente = { "[data-wing-nudge]": anstoss, ".w": knoten(), "[data-wing-canvas]": knoten(), "[data-wing] img": { src: "data:wing" }, "[data-wing]": knoten() };
  const hoerer = [];
  const engine = [];
  const fenster = {
    document: { querySelector: (sel) => elemente[sel] ?? null },
    addEventListener: (art, f) => hoerer.push({ art, f }),
    parent: { postMessage() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (f) => (f(), 1),
    clearTimeout() {},
    HermesWingCanvas: optionen.ohneEngine ? undefined : { mount: () => ({ setStatus: (s) => engine.push(s) }) },
  };
  fenster.window = fenster;
  const kontext = vm.createContext(fenster);
  vm.runInContext(skriptbloecke(ANRUF).filter((s) => s.includes("TOOL_GET_STATUS")).at(-1), kontext);
  const melde = (status) => hoerer.filter((h) => h.art === "message").forEach((h) => h.f({ data: { method: ERGEBNIS, params: { structuredContent: { call_id: "c1", status } } } }));
  return { melde, engine, takt };
}

test("widget-anruf K5: der Punkt wandert beim Wählen in 2,1 s mit der Kurve (.65,0,.35,1) von links nach rechts und blendet an den Enden aus", () => {
  const css = stil();
  assert.match(css, /@keyframesrun\{0%\{left:0;opacity:0\}12%\{opacity:1\}88%\{opacity:1\}100%\{left:100%;opacity:0\}\}/);
  assert.match(regel(css, ".ph-dial .runner"), /^display:block;animation:run2\.1scubic-bezier\(\.65,0,\.35,1\)infinite$/);
});

test("widget-anruf K5: die Pille wächst in 0,7 s mit der Standardkurve, Farben wechseln in 0,5 s, die Linie staucht in 0,7 s", () => {
  const css = stil();
  assert.match(regel(css, ".pill"), new RegExp("transition:width\\.7s" + KURVE.replace(/[\\().,]/g, "\\$&") + ",background-color\\.5sease,border-color\\.5sease,color\\.5sease$"));
  assert.match(regel(css, ".track"), new RegExp("transition:transform\\.7s" + KURVE.replace(/[\\().,]/g, "\\$&") + "$"));
  assert.match(regel(css, ".ph-fail .track,.ph-cancel .track"), /transform:scaleX\(\.5\)/);
});

test("widget-anruf K6: bei reduzierter Bewegung stehen Punkt, Pille, Linie und Flügel-Anstoß still", () => {
  assert.match(stil(), /@media\(prefers-reduced-motion:reduce\)\{\.runner,\.anstoss\{animation:none!important\}\.pill,\.track\{transition:none\}\}/);
});

test("widget-anruf K5: der Flügel wird beim Wählen alle 2 s mit connecting neu angestoßen, nur beim Wählen und nicht bei reduzierter Bewegung", () => {
  const css = stil();
  assert.match(regel(css, ".ph-dial .anstoss"), /^display:block;animation:anstoss2slinearinfinite$/);
  assert.match(regel(css, ".anstoss"), /^display:none;/);
  assert.match(css, /@keyframesanstoss\{to\{opacity:\.01\}\}/);
  assert.match(css, /\{\.runner,\.anstoss\{animation:none!important\}/);
  const s = karte();
  assert.deepEqual(s.takt.map((t) => t.art), ["animationiteration"]);
  const vorher = s.engine.length;
  s.takt[0].f();
  assert.deepEqual(s.engine.slice(vorher), ["idle", "connecting"]);
  assert.match(ANRUF, /<span class="anstoss" data-wing-nudge aria-hidden="true"><\/span>/);
});

test("widget-anruf K5: ohne Flügel-Engine bleibt der Anstoß ohne Wirkung und ohne Fehler", () => {
  const s = karte({ ohneEngine: true });
  assert.doesNotThrow(() => s.takt[0].f());
  assert.deepEqual(s.engine, []);
});

test("widget-anruf K8: call hat Version 37, die alten Pins bleiben", () => {
  const pins = widgetPins();
  assert.equal(Object.keys(pins.call).length, NEUE_VERSION);
  assert.match(pins.call[NEUE_VERSION], /^[0-9a-f]{64}$/);
  assert.equal(pins.call["36"], "d815d8f193472aaed4dacd088732bea4b3f0d781a01f3187e0ea94a5b02ab31c");
});
