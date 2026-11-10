import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";
import { decodePng, findChrome, renderInFrame } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 120000 };
const RADIUS = 74;
const UMFANG = 2 * Math.PI * RADIUS;
const BOGEN_TOLERANZ = 0.01;
const RUND_TOLERANZ_PX = 1.5;
const FARB_TOLERANZ = 14;
const AKZENT_RGB = [94, 161, 224];
const RAHMENBREITE = 900;

async function aufbereiten() {
  const { call } = await ausgelieferteWidgets();
  const stile = [...call.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((treffer) => treffer[1]);
  const css = stile.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const regeln = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, wahl, inhalt]) => ({ waehler: wahl.trim().split(/\s*,\s*/), inhalt }));
  const passend = (waehler) => regeln.filter((regel) => regel.waehler.includes(waehler));
  const deklarationen = (waehler) => passend(waehler).map((regel) => regel.inhalt).join(";");
  return { call, css, deklarationen };
}

const dauer = (text) => Number(/(\d+(?:\.\d+)?)s/.exec(text)[1]);

test("Ring: keine transition auf stroke-dasharray, Statuswechsel blendet per opacity", OPTIONS, async () => {
  const { css, deklarationen } = await aufbereiten();
  assert.doesNotMatch(deklarationen(".ring-arc"), /transition/);
  assert.doesNotMatch(css, /transition[^;}]*stroke-dasharray/);
  const bild = /@keyframes\s+hermesRingIn\w*\s*\{([\s\S]*?\})\s*\}/.exec(css);
  assert.ok(bild, "Keyframes fuer das Einblenden des Bogens");
  assert.match(bild[1], /opacity/);
  assert.doesNotMatch(bild[1], /dasharray|filter/);
});

test("Ring: kein filter am Bogen, am rotierenden Ring und am Flügel-Canvas", OPTIONS, async () => {
  const { deklarationen } = await aufbereiten();
  for (const waehler of [".ring-arc", ".ring--accent-strong .ring-arc", ".ring--accent-solid .ring-arc", ".ring--spin", ".ring", "[data-wing]", ".wing-canvas-mount canvas"]) {
    assert.doesNotMatch(deklarationen(waehler), /filter/, waehler);
  }
});

test("Ring: dreht per transform auf eigener Ebene, SVG ohne overflow hidden", OPTIONS, async () => {
  const { css, deklarationen } = await aufbereiten();
  assert.match(deklarationen(".ring"), /overflow:\s*visible/);
  assert.match(deklarationen(".ring"), /will-change:\s*transform/);
  assert.match(css, /@keyframes\s+hermesRingSpin\s*\{\s*to\s*\{\s*transform:\s*rotate\(/);
});

test("Glow: statisches Geschwisterelement nach dem Ring, ohne Animation und Filter", OPTIONS, async () => {
  const { call, deklarationen } = await aufbereiten();
  assert.match(call, /<\/svg>\s*<span class="ring-glow"/);
  const glow = deklarationen(".ring-glow");
  assert.ok(glow.length > 0);
  assert.doesNotMatch(glow, /animation|filter/);
});

test("Takt: Ring 3,6 s, Puls 1,8 s, Perioden gehen ganzzahlig ineinander auf", OPTIONS, async () => {
  const { deklarationen } = await aufbereiten();
  const ring = dauer(deklarationen(".ring--spin"));
  const puls = dauer(deklarationen(".pill--active .dot"));
  assert.equal(ring, 3.6);
  assert.equal(puls, 1.8);
  assert.equal(Math.round((ring / puls) * 1000) / 1000, Math.round(ring / puls));
});

test("Bogen: Länge im Markup ergibt den Umfang 2·π·r", OPTIONS, async () => {
  const { call } = await aufbereiten();
  const [, strich, luecke] = /data-ring-arc[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(call);
  assert.ok(Math.abs(Number(strich) + Number(luecke) - UMFANG) < BOGEN_TOLERANZ);
  assert.match(call, new RegExp(`data-ring-arc cx="84" cy="84" r="${RADIUS}"`));
});

test("reduced motion: Ring steht, Pille pulst nicht, Bogen blendet nicht ein", OPTIONS, async () => {
  const { css } = await aufbereiten();
  const block = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\s{2}\}/g)].map((treffer) => treffer[1]).find((inhalt) => inhalt.includes(".ring--spin"));
  assert.match(block, /\.ring--spin\s*\{\s*animation:\s*none/);
  assert.match(block, /\.pill--active \.dot\s*\{\s*animation:\s*none/);
  assert.match(block, /\.ring-arc--in-a[^{]*\{\s*animation:\s*none/);
});

test("Kreis: oben, rechts, unten, links gleicher Abstand zur Mitte", OPTIONS, async () => {
  const { call } = await aufbereiten();
  const ruhend = call
    .replace("</head>", `<style>.ring--spin,.ring-arc,.pill--active .dot{animation:none!important}.ring-arc{stroke-dasharray:${UMFANG} 0!important}</style></head>`);
  const bild = decodePng((await renderInFrame(chrome, ruhend, { width: RAHMENBREITE })).png);
  const spalten = [];
  const zeilen = [];
  for (let y = 0; y < bild.height; y += 1) {
    for (let x = 0; x < bild.width; x += 1) {
      if (bild.at(x, y).every((kanal, i) => Math.abs(kanal - AKZENT_RGB[i]) <= FARB_TOLERANZ)) { spalten.push(x); zeilen.push(y); }
    }
  }
  const [links, rechts] = [Math.min(...spalten), Math.max(...spalten)];
  const [oben, unten] = [Math.min(...zeilen), Math.max(...zeilen)];
  const mitteX = (links + rechts) / 2;
  const mitteY = (oben + unten) / 2;
  const abstaende = [mitteY - oben, rechts - mitteX, unten - mitteY, mitteX - links];
  assert.ok(Math.min(...abstaende) >= RADIUS - 2, `Bogen ist zu klein: ${abstaende}`);
  assert.ok(Math.max(...abstaende) - Math.min(...abstaende) <= RUND_TOLERANZ_PX, `Abstaende ${abstaende}`);
});

function karteMitBogen() {
  const bogen = { klassen: [], dash: [] };
  const elemente = new Map();
  const element = (wahl) => ({
    children: [], style: {}, textContent: "", className: "",
    get firstChild() { return null; },
    appendChild() {}, removeChild() {}, addEventListener() {},
    setAttribute(name, wert) {
      if (wahl !== "[data-ring-arc]") return;
      if (name === "class") bogen.klassen.push(wert);
      if (name === "stroke-dasharray") bogen.dash.push(wert);
    },
  });
  const doc = {
    querySelector(wahl) { if (!elemente.has(wahl)) elemente.set(wahl, element(wahl)); return elemente.get(wahl); },
    querySelectorAll: () => [], documentElement: { lang: "" }, createElement: () => element(""),
  };
  const lauscher = {};
  const kasten = { document: doc, parent: { postMessage() {} }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} };
  kasten.window = kasten;
  kasten.addEventListener = (art, fn) => { (lauscher[art] = lauscher[art] || []).push(fn); };
  kasten.CustomEvent = function CustomEvent(art) { this.type = art; };
  kasten.dispatchEvent = (ereignis) => { for (const fn of lauscher[ereignis.type] || []) fn(ereignis); };
  return { kasten, lauscher, bogen };
}

test("Statuswechsel: der Bogen blendet bei jedem Wechsel neu ein, bei gleichem Status nicht", OPTIONS, async () => {
  const { call } = await aufbereiten();
  const { kasten, lauscher, bogen } = karteMitBogen();
  vm.createContext(kasten);
  vm.runInContext(skriptbloecke(call).find((block) => block.includes("updateRingForStatus")), kasten);
  kasten.__hermesUiReady = true;
  kasten.dispatchEvent(new kasten.CustomEvent("hermes:ui-ready"));
  const melden = (status) => {
    const params = { structuredContent: { call_id: "c1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } };
    for (const fn of lauscher.message) fn({ data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params } });
  };
  for (const status of ["dialing", "in_progress", "in_progress", "completed"]) melden(status);
  assert.deepEqual(bogen.klassen, ["ring-arc ring-arc--in-a", "ring-arc ring-arc--in-b", "ring-arc ring-arc--in-a"]);
  assert.equal(bogen.dash.length, 3);
});
