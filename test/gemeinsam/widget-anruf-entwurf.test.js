import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { widgetPins } from "../../src/ui/registry.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const ANRUF = WIDGETS.call;
const NEUE_VERSION = 37;
const ERGEBNIS = "ui/notifications/tool-result";
const KURVE = "cubic-bezier(.22,1,.36,1)";

function stil(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

function regel(css, selektor) {
  const start = css.indexOf(selektor + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return css.slice(start + selektor.length + 1, css.indexOf("}", start)).replace(/\s+/g, "");
}

function knoten() {
  return {
    className: "",
    style: {},
    _text: "",
    children: [],
    get firstChild() {
      return this.children[0] ?? null;
    },
    get textContent() {
      return this._text;
    },
    set textContent(wert) {
      this._text = wert;
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
  };
}

function karte(optionen = {}) {
  const w = knoten();
  w.className = "w";
  const elemente = { ".w": w, "[data-wing-canvas]": knoten(), "[data-wing] img": { src: "data:wing" }, "[data-wing]": knoten() };
  const hoerer = [];
  const montiert = [];
  const fenster = {
    document: { querySelector: (sel) => elemente[sel] ?? null },
    addEventListener: (art, f) => hoerer.push({ art, f }),
    parent: { postMessage() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    HermesWingCanvas: optionen.fluegel
      ? { mount: (host, o) => (montiert.push(o), { setStatus: (s) => montiert.push(s) }) }
      : undefined,
  };
  fenster.window = fenster;
  const kontext = vm.createContext(fenster);
  const eigenes = skriptbloecke(ANRUF).filter((s) => s.includes("TOOL_GET_STATUS")).at(-1);
  vm.runInContext(eigenes, kontext);
  const melde = (status) => hoerer.filter((h) => h.art === "message").forEach((h) => h.f({ data: { method: ERGEBNIS, params: { structuredContent: { call_id: "c1", status } } } }));
  return { w, melde, montiert };
}

test("widget-anruf K6: beide Themen mit den Variablen der Vorlage, Karte 36 px, Überschrift 44/46 px", () => {
  const css = stil(ANRUF);
  assert.match(css, /--bg:#15130f;--fg:#f2ece3;--fg2:#b9af9f;--line2:#746b5e;--accent:#c8a673;/);
  assert.match(css, /--bg:#e8e0d4;--fg:#1e1b17;--fg2:#4a433b;--line2:#8c8273;--accent:#76592f;/);
  assert.match(css, /@media \(prefers-color-scheme:light\)/);
  assert.match(css, /\.w\{position:relative;isolation:isolate;overflow:hidden;[^}]*padding:24px 24px 12px;border-radius:36px/);
  assert.match(css, /\.w h1\{[^}]*font-size:44px;line-height:46px;letter-spacing:-0\.01em/);
  assert.match(css.replace(/\s+/g, ""), /\.sheet\{margin:0-12px;border-radius:24px;background:var\(--glass\);-webkit-backdrop-filter:blur\(26px\)saturate\(1\.5\)/);
});

test("widget-anruf K6: Lichter driften in 17, 23 und 29 s, Einblenden in 0,7 s mit der Standardkurve, bei reduzierter Bewegung Ruhe", () => {
  const css = stil(ANRUF);
  assert.match(regel(css, ".ga"), /animation:driftA17sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gb"), /animation:driftB23sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gc"), /animation:driftA29sease-in-outinfinitealternate-reverse/);
  assert.match(regel(css, ".rise"), new RegExp("animation:rise\\.7s" + KURVE.replace(/[\\().]/g, "\\$&") + "both"));
  assert.match(css.replace(/\s+/g, ""), /@media\(prefers-reduced-motion:reduce\)\{\.rise,\.glow\{animation:none!important\}/);
  assert.equal((ANRUF.match(/<span class="glow g[abc]"/g) || []).length, 3);
});

test("widget-anruf Aufbau: Schriftzug, Überschrift, Verbindungszeile, Glas mit Zeilen und Fuß mit Knopf; kein Ring, keine Kopfleiste", () => {
  const ohneSkript = skriptbloecke(ANRUF).reduce((text, skript) => text.split(skript).join(""), ANRUF);
  const body = ohneSkript.slice(ohneSkript.indexOf("<body>"));
  const reihenfolge = ['class="w"', 'class="szene"', 'class="marke"', 'class="kopf"', "<h1 ", 'class="verbindung"', 'class="wing-wrap"', 'class="track"', 'class="pill lens"', 'class="sheet"', 'class="fuss"', "data-cancel", 'class="rimcard"'];
  let pos = -1;
  for (const teil of reihenfolge) {
    const naechste = body.indexOf(teil, pos + 1);
    assert.ok(naechste > pos, teil + " fehlt oder steht an falscher Stelle");
    pos = naechste;
  }
  for (const weg of ["data-ring", "ring-wrap", "eyebrow", "foot-mark", "meander", "data-status-pill", "hud-cancel pill"]) {
    assert.ok(!body.includes(weg), weg + " darf nicht mehr im Markup stehen");
  }
  assert.match(body, /<span class="wing-canvas-mount" data-wing-canvas/);
  assert.match(body, /<b>Hermes<\/b>/);
});

test("widget-anruf Haken: Abbrechen, Flügel, Slots und Zeilen behalten ihre data-Attribute", () => {
  for (const haken of ["data-cancel", "data-wing", "data-wing-canvas", "data-hud-phase", "data-duration-display", "data-failure-display", "data-objective-display"]) {
    assert.ok(ANRUF.includes(haken), haken);
  }
  for (const slot of ["call_id", "status", "last_transcript_lines", "outcome", "result_summary", "next_step"]) {
    assert.ok(ANRUF.includes(`data-mcp="${slot}"`), slot);
  }
  for (const zeile of ["lines", "failure", "objective", "outcome", "summary", "next_step"]) {
    assert.match(ANRUF, new RegExp(`class="zeile[^"]*" data-row="${zeile}"`));
  }
});

test("widget-anruf Verbindungszeile: Punkt beim Wählen, Pille 56 und 112 px, Linie auf halbe Länge, Messinglicht je Zustand", () => {
  const css = stil(ANRUF);
  assert.match(regel(css, ".runner"), /display:none;position:absolute;top:-4px;width:9px;height:9px;[^}]*box-shadow:0014px2pxvar\(--ga\)/);
  assert.match(regel(css, ".ph-dial .runner"), /display:block/);
  assert.match(regel(css, ".track"), /flex:110;height:1px;background:var\(--fg2\);transform-origin:leftcenter/);
  assert.match(regel(css, ".ph-fail .track,.ph-cancel .track"), /transform:scaleX\(\.5\)/);
  assert.match(regel(css, ".pill"), /width:56px;height:56px;[^}]*border:1pxdashedtransparent;border-radius:999px;[^}]*font-size:22px;font-weight:500;font-variant-numeric:tabular-nums/);
  assert.match(regel(css, ".ph-live .pill,.ph-done .pill"), /width:112px/);
  assert.match(css.replace(/\s+/g, ""), /\}\.ph-done\.pill\{background:var\(--fg\);color:var\(--bg\)\}/);
  assert.match(regel(css, ".ph-fail .pill,.ph-cancel .pill"), /background:transparent;box-shadow:none;border-color:var\(--line2\)/);
  assert.match(css.replace(/\s+/g, ""), /\.ph-dial\.ga\{opacity:\.5\}\.ph-live\.ga\{opacity:1\}\.ph-done\.ga\{opacity:\.8\}/);
  assert.match(css.replace(/\s+/g, ""), /\.ph-fail\.ga,\.ph-cancel\.ga\{opacity:\.1\}\.ph-fail\.gb,\.ph-cancel\.gb\{opacity:\.35\}/);
  assert.match(regel(css, ".glow"), /transition:opacity1\.2sease/);
  assert.match(css, /@keyframes run\b/);
});

test("widget-anruf Fuß: Abbrechen-Knopf als Glasstück, 44 px hoch, 18 % heller beim Darüberfahren, Messing-Fokusring bleibt", () => {
  const css = stil(ANRUF);
  assert.match(regel(css, ".fuss"), /display:flex;align-items:center;[^}]*height:44px;margin-top:auto;font-size:13px;color:var\(--fg2\)/);
  assert.match(regel(css, "button.quiet"), /height:44px;padding:020px;margin-left:auto;border:0;border-radius:999px;color:var\(--fg\)/);
  assert.match(regel(css, "button.quiet:hover"), /filter:brightness\(1\.18\)/);
  assert.match(regel(css, ".hud-cancel:focus-visible"), /outline:2pxsolidvar\(--color-accent-light\)/);
  assert.match(ANRUF, /<button type="button" class="quiet lens hud-cancel" data-cancel data-i18n="Cancel call">Cancel call<\/button>/);
});

test("widget-anruf Zustände: die Karte trägt je Status die Klasse ph-dial, ph-live, ph-done, ph-fail oder ph-cancel", () => {
  const s = karte();
  assert.equal(s.w.className, "w ph-dial");
  const erwartet = { in_progress: "w ph-live", completed: "w ph-done", failed: "w ph-fail", cancelled: "w ph-cancel", dialing: "w ph-dial" };
  for (const [status, klasse] of Object.entries(erwartet)) {
    s.melde(status);
    assert.equal(s.w.className, klasse, status);
  }
  s.melde("in_progress");
  s.melde("unbekannt");
  assert.equal(s.w.className, "w ph-live");
});

test("widget-anruf Flügel: die Canvas-Engine bekommt 72 px und folgt dem Status", () => {
  assert.match(stil(ANRUF), /\.verbindung \.wing-wrap\{--wing-size:72px;margin-left:-8px\}/);
  const s = karte({ fluegel: true });
  assert.equal(s.montiert[0].size, 72);
  assert.equal(s.montiert[0].status, "connecting");
  s.melde("in_progress");
  assert.equal(s.montiert.at(-1), "working");
});

test("widget-anruf K8: call hat eine neue Version, die alten Pins bleiben", () => {
  const pins = widgetPins();
  assert.equal(Object.keys(pins.call).length, NEUE_VERSION);
  assert.match(pins.call[NEUE_VERSION], /^[0-9a-f]{64}$/);
  assert.equal(pins.call["35"], "05ef99c090b503e992fa9267834b11dc52abff27783ae603e50d33d3303630d0");
});
