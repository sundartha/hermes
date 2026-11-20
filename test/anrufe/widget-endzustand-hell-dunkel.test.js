import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "../gemeinsam/ausgelieferte-widgets.js";

const ANRUF = (await ausgelieferteWidgets()).call;
const LESBAR = 4.5;
const HELL_BLOCK = /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*\.w\{([^}]*)\}/;
const DUNKEL_BLOCK = /(?:^|\n)\s*\.w\{(--bg:[^}]*)\}/;

function variablen(block) {
  return Object.fromEntries([...block.matchAll(/(--[a-z0-9]+):(#[0-9a-f]{6})\b/gi)].map(([, name, wert]) => [name, wert]));
}

function leuchtdichte(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

function thema(name) {
  const treffer = (name === "hell" ? HELL_BLOCK : DUNKEL_BLOCK).exec(ANRUF);
  assert.ok(treffer, `Variablen des ${name}en Themas stehen im ausgelieferten Widget`);
  return variablen(treffer[1]);
}

function pruefeEndzustand(name) {
  const v = thema(name);
  assert.ok(v["--bg"] && v["--fg"] && v["--fg2"], "Hintergrund und beide Textfarben sind aufgelöst");
  assert.ok(kontrast(v["--fg"], v["--bg"]) >= LESBAR, `Phasentext "Nobody picked up." im ${name}en Thema lesbar`);
  assert.ok(kontrast(v["--fg2"], v["--bg"]) >= LESBAR, `Grund "No answer" im ${name}en Thema lesbar`);
}

test("widget-endzustand: Texte des nicht angenommenen Anrufs stehen im Widget, ph-fail nutzt die Themenvariablen", () => {
  assert.match(ANRUF, /hudPhase: "Nobody picked up\."/);
  assert.match(ANRUF, /"no-answer": "No answer"/);
  assert.match(ANRUF, /\.ph-fail \.pill::before[^}]*border-color:var\(--line2\)/);
});

test("widget-endzustand: dunkles Thema, Phasentext und Grund haben mindestens 4.5:1 gegen den Hintergrund", () => {
  pruefeEndzustand("dunkel");
});

test("widget-endzustand: helles Thema, Phasentext und Grund haben mindestens 4.5:1 gegen den Hintergrund", () => {
  pruefeEndzustand("hell");
});

test("widget-endzustand: Kontrastrechnung trennt lesbar von unlesbar", () => {
  assert.ok(kontrast("#000000", "#ffffff") > 20.9 && kontrast("#000000", "#ffffff") < 21.1);
  assert.ok(kontrast("#777777", "#808080") < LESBAR);
});
