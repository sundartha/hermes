// Handy-Startseite im Browserfenster: Blaettern (eine Geste = genau ein Screen)
// und Safari-Leisten (Farbe = Bildkante). Rein, ohne astro-Build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  PAGE_COMMIT_RATIO,
  PAGE_FLICK_MIN_PX,
  PAGE_FLICK_SPEED,
  PAGE_MS_MAX,
  PAGE_MS_MIN,
  pageDuration,
  pageStep,
  pageTarget,
  wheelPixels,
} from "../src/lib/mobile-pager.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");

// Screenhoehe eines grossen iPhones in Safari (zwischen Status- und Toolbar).
const HEIGHT = 796;
const SCREENS = 5;
const LAST = SCREENS - 1;
const SLOW = 0.05;
const MEDIUM = 1;
const HARD = 6;
const WILD = 60;
const TWITCH_PX = 3;
const TWITCH_BACK_PX = -5;
const MARGIN_PX = 4;
const SHARE_SHORT = 0.2;
const SHARE_LONG = 0.9;
const SHARE_BEYOND = 3;
const HALF = 398;
const FOUR_SCREENS = 3184;
const WHEEL_PX = 12;
const WHEEL_LINES = 3;
const LINE_PX = 16;
const MODE_PIXELS = 0;
const MODE_LINES = 1;
const MODE_PAGES = 2;
const MIDDLE = 2;
const STRIP_COMMENTS = /\/\*[\s\S]*?\*\//g;

test("pageStep: Antippen und Zittern blaettern nie", () => {
  for (const moved of [0, TWITCH_PX, TWITCH_BACK_PX, PAGE_FLICK_MIN_PX - 1]) {
    assert.equal(pageStep({ moved, velocity: HARD, height: HEIGHT }), 0, `moved ${moved}`);
  }
});

test("pageStep: langsamer Zug blaettert erst ab dem Schwellenanteil, in beide Richtungen", () => {
  const edge = Math.ceil(HEIGHT * PAGE_COMMIT_RATIO);
  assert.equal(pageStep({ moved: edge - 1, velocity: SLOW, height: HEIGHT }), 0);
  assert.equal(pageStep({ moved: edge, velocity: SLOW, height: HEIGHT }), 1);
  assert.equal(pageStep({ moved: -edge, velocity: -SLOW, height: HEIGHT }), -1);
});

test("pageStep: kurzer schneller Wisch blaettert, Zurueckschnippen bricht ab", () => {
  const short = PAGE_FLICK_MIN_PX + MARGIN_PX;
  assert.equal(pageStep({ moved: short, velocity: PAGE_FLICK_SPEED, height: HEIGHT }), 1);
  assert.equal(pageStep({ moved: -short, velocity: -PAGE_FLICK_SPEED, height: HEIGHT }), -1);
  assert.equal(pageStep({ moved: HALF, velocity: -HARD, height: HEIGHT }), 0);
});

test("pageStep + pageTarget: egal wie hart oder weit - hoechstens ein Screen, nie ueber den Rand", () => {
  for (const moved of [HEIGHT * SHARE_SHORT, HEIGHT * SHARE_LONG, HEIGHT * SHARE_BEYOND]) {
    for (const velocity of [SLOW, MEDIUM, HARD, WILD]) {
      const step = pageStep({ moved, velocity, height: HEIGHT });
      assert.equal(step, 1);
      assert.equal(pageTarget(1, step, SCREENS), MIDDLE);
    }
  }
  assert.equal(pageTarget(0, -1, SCREENS), 0);
  assert.equal(pageTarget(LAST, 1, SCREENS), LAST);
  assert.equal(
    pageTarget(MIDDLE, WILD, SCREENS),
    MIDDLE + 1,
    "ein grosses Rad-Delta ist trotzdem nur ein Schritt",
  );
});

test("pageDuration: kurzer Rest schnell, ganzer Screen hoechstens PAGE_MS_MAX", () => {
  assert.equal(pageDuration(0, HEIGHT), PAGE_MS_MIN);
  assert.equal(pageDuration(HEIGHT, HEIGHT), PAGE_MS_MAX);
  assert.equal(pageDuration(-FOUR_SCREENS, HEIGHT), PAGE_MS_MAX);
  const half = pageDuration(HALF, HEIGHT);
  assert.ok(half > PAGE_MS_MIN && half < PAGE_MS_MAX);
});

test("wheelPixels: Pixel, Zeilen und Seiten", () => {
  assert.equal(wheelPixels(WHEEL_PX, MODE_PIXELS, HEIGHT), WHEEL_PX);
  assert.equal(wheelPixels(WHEEL_LINES, MODE_LINES, HEIGHT), WHEEL_LINES * LINE_PX);
  assert.equal(wheelPixels(-1, MODE_PAGES, HEIGHT), -HEIGHT);
});

test("Blaettern: mit Skript sind natives Scrollen und Scroll-Snap aus, das Skript setzt data-pager", () => {
  const css = read("src/styles/hermes-mobile-viewport.css");
  const rule = css.match(/\.mh\[data-pager\] \.mh-scroll \{([^}]*)\}/);
  assert.ok(rule, "Regel .mh[data-pager] .mh-scroll fehlt");
  assert.match(rule[1], /overflow-y: hidden/);
  assert.match(rule[1], /scroll-snap-type: none/);
  assert.match(rule[1], /touch-action: none/);
  assert.match(read("src/scripts/hermes-mobile.js"), /setAttribute\("data-pager", ""\)/);
});

test("Safari-Leisten: fixierte Farbquelle oben, Seitenfarbe unten = unterste Bildfarbe", () => {
  const css = read("src/styles/hermes-mobile-viewport.css");
  const tint = css.replace(STRIP_COMMENTS, "").match(/\.mh-tint \{([^}]*)\}/);
  assert.ok(tint, "Regel .mh-tint fehlt");
  assert.match(tint[1], /position: fixed/);
  assert.match(tint[1], /top: 0/);
  assert.match(tint[1], /background-color: var\(--mh-top\)/);
  assert.doesNotMatch(
    tint[1],
    /pointer-events:\s*none/,
    "Safari findet die Farbquelle per Treffertest",
  );
  const bottom = (css.match(/--mh-bottom: (#[0-9a-f]{6})/) || [])[1];
  const root = (css.match(/html:has\(\.mh\) body \{\s*background-color: (#[0-9a-f]{6})/) || [])[1];
  assert.ok(bottom && root, "--mh-bottom oder die html/body-Farbe fehlt");
  assert.equal(root, bottom, "html/body muessen die Farbe der untersten Bildzeile tragen");
  const markup = read("src/components/MobileHome.astro");
  assert.ok(
    markup.includes('<div class="mh-tint" aria-hidden="true"></div>'),
    "mh-tint fehlt im Markup",
  );
  assert.ok(
    markup.includes('import "../styles/hermes-mobile-viewport.css";'),
    "viewport-CSS nicht eingebunden",
  );
});
