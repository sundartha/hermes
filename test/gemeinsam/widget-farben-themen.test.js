import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const WIDGET_IDS = ["agent-status", "my-number", "calls", "call"];
const AA = 4.5;
const STEIN_BLOCK = /@media\s*\(prefers-color-scheme\s*:\s*light\)\s*\{/;
const STIL = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const WURZEL_REGEL = /(?:^|[}\s])\.w\s*\{([^{}]*--bg\s*:[^{}]*)\}/;
const EIGENSCHAFT = /(--[\w-]+)\s*:\s*([^;{}]+)/g;
const VAR = /var\(\s*(--[\w-]+)\s*\)/g;
const REGEL = /([^{}]+)\{([^{}]*)\}/g;
const TEXTFARBE = /(?<![\w-])color\s*:\s*([^;}]+)/;
const HINTERGRUND = /(?<![\w-])background\s*:\s*([^;}]+)/;
const HEX = /#([0-9a-fA-F]{6})(?![0-9a-zA-Z])/;
const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/;
const THEMEN = ["nacht", "stein"];
const BEKANNTE_GRUNDFARBE = { nacht: "#15130f", stein: "#e8e0d4" };

function stile(html) {
  return [...html.matchAll(STIL)].map((m) => m[1]).join("\n");
}

function steinBlock(css) {
  const m = STEIN_BLOCK.exec(css);
  assert.ok(m, "Stein-Block fehlt");
  let tiefe = 1;
  let i = m.index + m[0].length;
  while (tiefe > 0 && i < css.length) {
    if (css[i] === "{") tiefe += 1;
    if (css[i] === "}") tiefe -= 1;
    i += 1;
  }
  return { innen: css.slice(m.index + m[0].length, i - 1), ohne: css.slice(0, m.index) + css.slice(i) };
}

function variablen(regelInhalt) {
  return new Map([...regelInhalt.matchAll(EIGENSCHAFT)].map((m) => [m[1], m[2].trim()]));
}

function themaVariablen(css) {
  const { innen, ohne } = steinBlock(css);
  const nacht = variablen(WURZEL_REGEL.exec(ohne)[1]);
  const stein = new Map([...nacht, ...variablen(WURZEL_REGEL.exec(innen)[1])]);
  return { nacht, stein, ohne };
}

function aufloesen(wert, props) {
  const neu = wert.replace(VAR, (_, name) => props.get(name) ?? "");
  return neu === wert ? neu : aufloesen(neu, props);
}

function farbe(wert) {
  const hex = HEX.exec(wert);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)), alpha: 1 };
  const fn = RGB.exec(wert);
  if (fn) return { rgb: [fn[1], fn[2], fn[3]].map(Number), alpha: Number(fn[4] ?? 1) };
  return null;
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

function gruende(props) {
  const bg = farbe(aufloesen("var(--bg)", props)).rgb;
  const glas = farbe(aufloesen("var(--glass)", props));
  return [bg, mischen(glas.rgb, glas.alpha, bg)];
}

function textmessungen(css, props) {
  const grundflaechen = gruende(props);
  return [...css.matchAll(REGEL)].flatMap(([, selektor, inhalt]) => {
    const text = TEXTFARBE.exec(inhalt);
    if (!text || !/var\(--(fg2?|bg)\)/.test(text[1])) return [];
    const eigen = HINTERGRUND.exec(inhalt);
    const eigenerGrund = eigen ? farbe(aufloesen(eigen[1].trim(), props)) : null;
    const gruendeDieserRegel = eigenerGrund && eigenerGrund.alpha === 1 ? [eigenerGrund.rgb] : grundflaechen;
    const vorn = farbe(aufloesen(text[1].trim(), props));
    return gruendeDieserRegel.map((grund) => ({ selektor: selektor.trim(), wert: text[1].trim(), vorn, grund }));
  });
}

for (const thema of THEMEN) {
  test("Thema " + thema + ": der Grund der Karte ist der Wert aus der Designvorlage", () => {
    for (const id of WIDGET_IDS) {
      const props = themaVariablen(stile(WIDGETS[id]))[thema];
      assert.equal(props.get("--bg"), BEKANNTE_GRUNDFARBE[thema], id + ": --bg");
    }
  });

  test("Thema " + thema + ": jede Textfarbe erreicht auf dem Grund der Karte und auf Glas mindestens 4,5:1", () => {
    for (const id of WIDGET_IDS) {
      const { ohne, ...themen } = themaVariablen(stile(WIDGETS[id]));
      const messungen = textmessungen(ohne, themen[thema]);
      assert.ok(messungen.length >= 4, id + ": zu wenige Textfarben (" + messungen.length + ")");
      for (const m of messungen) {
        const wert = kontrast(mischen(m.vorn.rgb, m.vorn.alpha, m.grund), m.grund);
        assert.ok(wert >= AA, id + " " + thema + " " + m.selektor + " " + m.wert + " nur " + wert.toFixed(2) + ":1");
      }
    }
  });
}

test("Thema stein: die Variablen unterscheiden sich von Nacht in Grund, Text und Akzent", () => {
  for (const id of WIDGET_IDS) {
    const { nacht, stein } = themaVariablen(stile(WIDGETS[id]));
    for (const name of ["--bg", "--fg", "--fg2", "--accent"]) {
      assert.notEqual(stein.get(name), nacht.get(name), id + ": " + name + " gleich in beiden Themen");
    }
    assert.equal(stein.get("--fg"), "#1e1b17");
    assert.equal(stein.get("--accent"), "#76592f");
    assert.equal(nacht.get("--accent"), "#c8a673");
  }
});
