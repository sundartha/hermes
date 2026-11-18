import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const MARMOR = [0xf2, 0xec, 0xe3];
const STEIN_GRUND = [0xe8, 0xe0, 0xd4];
const MINDEST_KONTRAST = 3;
const STEIN_BLOCK = /@media\s*\(prefers-color-scheme\s*:\s*light\)\s*\{\s*\.w\s*\{([^{}]*)\}/;
const WURZEL = /(?:^|[}\s])\.w\s*\{([^{}]*--bg\s*:[^{}]*)\}/;
const FLUEGEL_FILTER = /--wingf\s*:\s*([^;}]+)/;
const HELLIGKEIT = /^brightness\(\s*(\d*\.?\d+)\s*\)$/;

function stil(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

function leuchtdichte(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

for (const [id, html] of Object.entries(WIDGETS)) {
  test(`widget-fluegel-stein-dunkel: der Flügel von ${id} ist im Stein-Thema dunkel genug zum Hintergrund`, () => {
    const css = stil(html);
    const stein = FLUEGEL_FILTER.exec(STEIN_BLOCK.exec(css)[1]);
    assert.ok(stein, "Stein-Thema setzt --wingf");
    const faktor = Number(HELLIGKEIT.exec(stein[1].trim())?.[1]);
    assert.ok(faktor > 0 && faktor < 1, "brightness zwischen 0 und 1: " + stein[1]);
    const fluegel = MARMOR.map((c) => Math.round(c * faktor));
    assert.ok(kontrast(fluegel, STEIN_GRUND) >= MINDEST_KONTRAST, "Kontrast " + kontrast(fluegel, STEIN_GRUND));
    assert.equal(stein[1].trim(), "brightness(.25)");
  });

  test(`widget-fluegel-stein-dunkel: der Flügel von ${id} bleibt im Nacht-Thema unverändert`, () => {
    const nacht = FLUEGEL_FILTER.exec(WURZEL.exec(stil(html).replace(STEIN_BLOCK, ""))[1]);
    assert.equal(nacht[1].trim(), "none");
  });
}

test("widget-fluegel-stein-dunkel: Kontrast des unveränderten Flügels im Stein-Thema liegt unter 3:1", () => {
  assert.ok(kontrast(MARMOR, STEIN_GRUND) < MINDEST_KONTRAST);
});
