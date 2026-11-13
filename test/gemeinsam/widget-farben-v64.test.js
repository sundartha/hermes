import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const WIDGET_IDS = ["agent-status", "my-number", "calls", "call"];

const NIGHT = "#15130f";
const CARD = "#201d18";
const CARD_2 = "#2a2620";
const BRASS = "#c8a673";
const BRASS_RGB = "200,166,115";
const AA = 4.5;
const BLAU_VON = 180;
const BLAU_BIS = 260;
const SAETTIGUNG_GRAU = 0.15;
const ENTWURF_KUEHLES_GRAU = "rgba(70,92,104,.40)";
const STEIN_BLOCK = /@media\s*\(prefers-color-scheme\s*:\s*light\)\s*\{/;

const HEX = /(?:#|%23)([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;
const RGB_FUNKTION = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/g;
const RGB_TRIPEL = /--[\w-]+-rgb\s*:\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
const STIL = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const EIGENSCHAFT = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
const VAR = /var\(\s*(--[\w-]+)\s*\)/g;
const TEXTFARBE = /(?<![\w-])color\s*:\s*([^;}]+)/g;

function hexZuRgb(hex) {
  const voll = hex.length === 3 ? [...hex].map((z) => z + z).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(voll.slice(i, i + 2), 16));
}

function farbtonUndSaettigung([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return { ton: 0, saettigung: 0 };
  const hell = (max + min) / 2;
  const saettigung = d / (1 - Math.abs(2 * hell - 1));
  const roh = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { ton: (roh * 60 + 360) % 360, saettigung };
}

function istBlau(rgb) {
  const { ton, saettigung } = farbtonUndSaettigung(rgb);
  return saettigung > SAETTIGUNG_GRAU && ton >= BLAU_VON && ton <= BLAU_BIS;
}

function alleFarben(html) {
  const hex = [...html.matchAll(HEX)].map((m) => ({ wert: m[0], rgb: hexZuRgb(m[1]) }));
  const funktion = [...html.matchAll(RGB_FUNKTION)].map((m) => ({ wert: m[0], rgb: [m[1], m[2], m[3]].map(Number) }));
  const tripel = [...html.matchAll(RGB_TRIPEL)].map((m) => ({ wert: m[0], rgb: [m[1], m[2], m[3]].map(Number) }));
  return [...hex, ...funktion, ...tripel];
}

function stile(html) {
  return [...html.matchAll(STIL)].map((m) => m[1]).join("\n");
}

function ohneSteinBlock(css) {
  const m = STEIN_BLOCK.exec(css);
  if (!m) return css;
  let tiefe = 1;
  let i = m.index + m[0].length;
  while (tiefe > 0 && i < css.length) {
    if (css[i] === "{") tiefe += 1;
    if (css[i] === "}") tiefe -= 1;
    i += 1;
  }
  return ohneSteinBlock(css.slice(0, m.index) + css.slice(i));
}

function eigenschaften(css) {
  return new Map([...css.matchAll(EIGENSCHAFT)].map((m) => [m[1], m[2].trim()]));
}

function aufloesen(wert, props, tiefe = 0) {
  if (tiefe > 10) return wert;
  const neu = wert.replace(VAR, (_, name) => props.get(name) ?? "");
  return neu === wert ? neu : aufloesen(neu, props, tiefe + 1);
}

function regel(css, selektor) {
  const start = css.indexOf(selektor + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return css.slice(start + selektor.length + 1, css.indexOf("}", start));
}

function luminanz(rgb) {
  const [r, g, b] = rgb.map((k) => {
    const s = k / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [hell, dunkel] = [luminanz(a), luminanz(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

function mischen(vorn, alpha, hinten) {
  return vorn.map((k, i) => k * alpha + hinten[i] * (1 - alpha));
}

function hellsteKartenstelle(css, props) {
  const grund = aufloesen(regel(css, ".card").match(/background:([^;]+);/)[1], props);
  const flaechen = [...grund.matchAll(HEX)].map((m) => hexZuRgb(m[1]));
  const hellste = flaechen.sort((a, b) => luminanz(b) - luminanz(a))[0];
  return [...grund.matchAll(RGB_FUNKTION)]
    .map((m) => ({ rgb: [m[1], m[2], m[3]].map(Number), alpha: Number(m[4] ?? 1) }))
    .reduce((unten, schicht) => mischen(schicht.rgb, schicht.alpha, unten), hellste);
}

const REGEL_BLOCK = /([^{}]+)\{([^{}]*)\}/g;
const HINTERGRUND = /(?<![\w-])background\s*:\s*([^;}]+)/;

function farbwerte(wert) {
  const hex = [...wert.matchAll(HEX)].map((m) => ({ wert, rgb: hexZuRgb(m[1]), alpha: 1 }));
  const fn = [...wert.matchAll(RGB_FUNKTION)].map((m) => ({ wert, rgb: [m[1], m[2], m[3]].map(Number), alpha: Number(m[4] ?? 1) }));
  return [...hex, ...fn];
}

function textfarben(css, props, kartenstelle) {
  return [...css.matchAll(REGEL_BLOCK)].flatMap(([, , inhalt]) => {
    const eigener = HINTERGRUND.exec(inhalt);
    const flaechen = eigener ? farbwerte(aufloesen(eigener[1].trim(), props)) : [];
    const grund = flaechen.length === 1 && flaechen[0].alpha === 1 ? flaechen[0].rgb : kartenstelle;
    return [...inhalt.matchAll(TEXTFARBE)].flatMap((m) =>
      farbwerte(aufloesen(m[1].trim(), props)).map((f) => ({ ...f, grund })),
    );
  });
}

test("v64: im ausgelieferten HTML aller vier Widgets steht keine blaue Farbe", () => {
  for (const id of WIDGET_IDS) {
    const blau = alleFarben(WIDGETS[id]).filter((f) => istBlau(f.rgb) && f.wert !== ENTWURF_KUEHLES_GRAU).map((f) => f.wert);
    assert.deepEqual(blau, [], id + " enthaelt Blau");
  }
});

test("v64: die Kartenflaeche ist Night, Card und Card-2, Rahmen und Glow sind Brass", () => {
  for (const id of WIDGET_IDS) {
    const css = ohneSteinBlock(stile(WIDGETS[id]));
    const props = eigenschaften(css);
    const karte = aufloesen(regel(css, ".card"), props).toLowerCase();
    for (const flaeche of [CARD_2, CARD, NIGHT]) assert.ok(karte.includes(flaeche), id + ": Kartenflaeche ohne " + flaeche);
    assert.match(karte, new RegExp("border:1px solid rgba\\(" + BRASS_RGB + ","), id + ": Kartenrahmen nicht Brass");
    assert.match(karte, new RegExp("radial-gradient\\([^;]*rgba\\(" + BRASS_RGB + ","), id + ": Kartenglow nicht Brass");
  }
});

test("v64: Ring und Status-Pill tragen Brass als Akzent", () => {
  const callCss = stile(WIDGETS.call);
  const callProps = eigenschaften(callCss);
  assert.equal(aufloesen(regel(callCss, ".ring--accent .ring-arc"), callProps).toLowerCase(), "stroke:" + BRASS);
  assert.equal(aufloesen(regel(callCss, ".ring--accent-solid .ring-arc"), callProps).toLowerCase(), "stroke:" + BRASS);
  assert.match(aufloesen(regel(callCss, ".pill--active"), callProps).toLowerCase(), new RegExp("^color:" + BRASS + ";"));
});

test("v64: jede Textfarbe erreicht auf der hellsten Kartenstelle mindestens 4,5:1", () => {
  for (const id of WIDGET_IDS) {
    const css = ohneSteinBlock(stile(WIDGETS[id]));
    const props = eigenschaften(css);
    const grund = hellsteKartenstelle(css, props);
    const farben = textfarben(css, props, grund);
    assert.ok(farben.length > 3, id + ": keine Textfarben gefunden");
    for (const f of farben) {
      const wert = kontrast(mischen(f.rgb, f.alpha, f.grund), f.grund);
      assert.ok(wert >= AA, id + ": " + f.wert + " nur " + wert.toFixed(2) + ":1");
    }
  }
});

test("v64: der Abbrechen-Knopf zeigt bei Tastaturfokus einen Brass-Ring", () => {
  const css = stile(WIDGETS.call);
  const fokus = aufloesen(regel(css, ".hud-cancel:focus-visible"), eigenschaften(css)).toLowerCase();
  assert.match(fokus, new RegExp("outline:2px solid " + BRASS));
});
