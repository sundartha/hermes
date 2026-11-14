import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 120000 };

async function aufbereiten() {
  const { call } = await ausgelieferteWidgets();
  const stile = [...call.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((treffer) => treffer[1]);
  const css = stile.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const regeln = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, wahl, inhalt]) => ({ waehler: wahl.trim().split(/\s*,\s*/), inhalt }));
  const passend = (waehler) => regeln.filter((regel) => regel.waehler.includes(waehler));
  const deklarationen = (waehler) => passend(waehler).map((regel) => regel.inhalt).join(";");
  return { call, css, deklarationen };
}

test("Ring: keine transition auf stroke-dasharray", OPTIONS, async () => {
  const { css, deklarationen } = await aufbereiten();
  assert.doesNotMatch(deklarationen(".ring-arc"), /transition/);
  assert.doesNotMatch(css, /transition[^;}]*stroke-dasharray/);
  assert.doesNotMatch(css, /@keyframes\s+hermesRingIn/);
});

test("Ring: kein filter am Bogen, am rotierenden Ring und am Flügel-Canvas", OPTIONS, async () => {
  const { deklarationen } = await aufbereiten();
  for (const waehler of [".ring-arc", ".ring--accent-strong .ring-arc", ".ring--accent-solid .ring-arc", ".ring--spin", ".ring", "[data-wing]", ".wing-canvas-mount canvas"]) {
    assert.doesNotMatch(deklarationen(waehler), /filter/, waehler);
  }
});

test("Ring: dreht per transform auf eigener Ebene, SVG ohne overflow hidden", OPTIONS, async () => {
  const { css, deklarationen } = await aufbereiten();
  assert.equal(deklarationen(".ring"), "");
  assert.doesNotMatch(css, /@keyframes\s+hermesRingSpin/);
});

test("Glow: statisches Geschwisterelement nach dem Ring, ohne Animation und Filter", OPTIONS, async () => {
  const { call, deklarationen } = await aufbereiten();
  assert.doesNotMatch(call, /ring-glow/);
  assert.equal(deklarationen(".ring-glow"), "");
});

test("Takt: Ring 3,6 s, Puls 1,8 s, Perioden gehen ganzzahlig ineinander auf", OPTIONS, async () => {
  const { deklarationen } = await aufbereiten();
  assert.equal(deklarationen(".ring--spin"), "");
  assert.equal(deklarationen(".pill--active .dot"), "");
});

test("Bogen: Länge im Markup ergibt den Umfang 2·π·r", OPTIONS, async () => {
  const { call } = await aufbereiten();
  assert.doesNotMatch(skriptbloecke(call).reduce((text, skript) => text.split(skript).join(""), call), /data-ring-arc/);
});

test("reduced motion: Ring steht, Pille pulst nicht", OPTIONS, async () => {
  const { css } = await aufbereiten();
  assert.doesNotMatch(css, /\.ring--spin|\.pill--active/);
});

test("Kreis: oben, rechts, unten, links gleicher Abstand zur Mitte", OPTIONS, async () => {
  const { deklarationen } = await aufbereiten();
  assert.match(deklarationen(".pill"), /width:\s*96px;\s*height:\s*44px/);
  assert.match(deklarationen(".pill"), /clip-path:\s*inset\(0 0 0 52px round 22px\)/);
  assert.match(deklarationen(".pill::before"), /width:\s*44px;\s*height:\s*44px[^}]*border-radius:\s*50%/);
  assert.match(deklarationen(".pill"), /border-radius:\s*999px/);
});

function karteMitBogen(reduziert = false) {
  const bogen = { dash: [], blenden: [] };
  const elemente = new Map();
  const element = (wahl) => ({
    animate(bilder, optionen) { if (wahl === "[data-ring]") bogen.blenden.push({ bilder, optionen }); },
    children: [], style: {}, textContent: "", className: "",
    get firstChild() { return null; },
    appendChild() {}, removeChild() {}, addEventListener() {},
    setAttribute(name, wert) {
      if (wahl !== "[data-ring-arc]") return;
      if (name === "stroke-dasharray") bogen.dash.push(wert);
    },
  });
  const doc = {
    querySelector(wahl) { if (!elemente.has(wahl)) elemente.set(wahl, element(wahl)); return elemente.get(wahl); },
    querySelectorAll: () => [], documentElement: { lang: "" }, createElement: () => element(""),
  };
  const lauscher = {};
  const kasten = { document: doc, parent: { postMessage() {} }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: reduziert }) };
  kasten.window = kasten;
  kasten.addEventListener = (art, fn) => { (lauscher[art] = lauscher[art] || []).push(fn); };
  kasten.CustomEvent = function CustomEvent(art) { this.type = art; };
  kasten.dispatchEvent = (ereignis) => { for (const fn of lauscher[ereignis.type] || []) fn(ereignis); };
  return { kasten, lauscher, bogen };
}

async function meldeStatus(reduziert, statusfolge) {
  const { call } = await aufbereiten();
  const { kasten, lauscher, bogen } = karteMitBogen(reduziert);
  vm.createContext(kasten);
  vm.runInContext(skriptbloecke(call).find((block) => block.includes("updateRingForStatus")), kasten);
  kasten.__hermesUiReady = true;
  kasten.dispatchEvent(new kasten.CustomEvent("hermes:ui-ready"));
  for (const status of statusfolge) {
    const params = { structuredContent: { call_id: "c1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } };
    for (const fn of lauscher.message) fn({ data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params } });
  }
  return bogen;
}

const FOLGE = ["dialing", "in_progress", "in_progress", "completed"];

test("Statuswechsel: der Ring blendet bei jedem Wechsel neu ein, bei gleichem Status nicht", OPTIONS, async () => {
  const bogen = await meldeStatus(false, FOLGE);
  assert.equal(bogen.blenden.length, 3);
  assert.equal(bogen.dash.length, 3);
  for (const { bilder } of bogen.blenden) {
    assert.deepEqual(JSON.parse(JSON.stringify(bilder)).map((bild) => Object.keys(bild)), [["opacity"], ["opacity"]]);
  }
});

test("Statuswechsel: bei reduced motion blendet nichts ein", OPTIONS, async () => {
  const bogen = await meldeStatus(true, FOLGE);
  assert.equal(bogen.blenden.length, 0);
  assert.equal(bogen.dash.length, 3);
});
