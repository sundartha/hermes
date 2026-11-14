import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home.css"), "utf8");
const SNAP = "(max-width: 760px) and (min-height: 560px)";
const IPHONE_17E_SVH = 699;
const IPHONE_18_PRO_SVH = 714;
const IPHONE_18_PRO_MAX_SVH = 796;
const IPHONE_SVH = [IPHONE_17E_SVH, IPHONE_18_PRO_SVH, IPHONE_18_PRO_MAX_SVH];
const PERCENT = 100;
const MIN_TOP_SPACE = 12;
const OLD_SPACE_MARGIN = 20;
const MAX_TOP_SPACE = 24;

function snapBlocks(css) {
  const blocks = [];
  let at = css.indexOf(`@media ${SNAP} {`);
  while (at !== -1) {
    let depth = 0;
    let end = css.indexOf("{", at);
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
      if (depth === 0) break;
    }
    blocks.push(css.slice(at, end));
    at = css.indexOf(`@media ${SNAP} {`, end);
  }
  return blocks.join("\n");
}

function declaration(block, selector, property) {
  const start = block.indexOf(`  ${selector} {`);
  assert.notEqual(start, -1, `${selector} fehlt im Snap-Block`);
  const body = block.slice(start, block.indexOf("}", start));
  const match = body.match(new RegExp(`${property}:\\s*([^;]+);`));
  assert.ok(match, `${selector} ohne ${property}`);
  return match[1].trim();
}

function pixels(value, svh) {
  const clamp = value.match(
    /^clamp\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)svh,\s*(\d+(?:\.\d+)?)px\)$/,
  );
  if (clamp) {
    const [, low, share, high] = clamp.map(Number);
    return Math.min(high, Math.max(low, (share * svh) / PERCENT));
  }
  const fixed = value.match(/^(\d+(?:\.\d+)?)px$/);
  assert.ok(fixed, `unbekannter Wert ${value}`);
  return Number(fixed[1]);
}

function topSpace(css, svh) {
  const block = snapBlocks(css);
  const parts = [
    declaration(block, ".uses.pad", "padding-top"),
    declaration(block, ".uses .shead", "margin-bottom"),
    declaration(block, ".uses .shead", "row-gap"),
  ];
  return parts.reduce((sum, value) => sum + pixels(value, svh), 0);
}

test("Startseite mobil: Use-case-Bereich sitzt hoch genug, damit die untere Box ueber der Safari-Leiste bleibt", () => {
  for (const svh of IPHONE_SVH) {
    const space = topSpace(CSS, svh);
    assert.ok(
      space <= MAX_TOP_SPACE,
      `bei ${svh}px Sichthoehe ${space.toFixed(1)}px Abstand ueber der Karte`,
    );
    assert.ok(
      space >= MIN_TOP_SPACE,
      `bei ${svh}px Sichthoehe klebt der Kopf mit ${space.toFixed(1)}px an der Karte`,
    );
  }
});

test("Startseite mobil: der Abstands-Check schlaegt bei den alten Abstaenden an", () => {
  const old = CSS.replace(
    "padding-top: clamp(8px, 1.5svh, 32px);",
    "padding-top: clamp(20px, 4svh, 56px);",
  )
    .replace("margin-bottom: clamp(6px, 0.8svh, 28px);", "margin-bottom: clamp(12px, 2svh, 28px);")
    .replace("row-gap: 2px;", "row-gap: 6px;");
  assert.notEqual(old, CSS);
  for (const svh of IPHONE_SVH) {
    assert.ok(
      topSpace(old, svh) > MAX_TOP_SPACE + OLD_SPACE_MARGIN,
      `alte Abstaende bei ${svh}px nicht erkannt`,
    );
  }
});
