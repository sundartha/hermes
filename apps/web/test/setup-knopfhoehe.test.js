import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home.css"), "utf8");
const MOBIL_RASTER = "@media (max-width: 760px) and (min-height: 640px)";
const MIN_TREFFER = 44;
const KNOEPFE = 3;

function blockOf(media) {
  const start = CSS.indexOf(`${media} {`);
  assert.ok(start >= 0, `${media} fehlt`);
  let depth = 0;
  for (let index = CSS.indexOf("{", start); index < CSS.length; index += 1) {
    if (CSS[index] === "{") depth += 1;
    if (CSS[index] === "}") depth -= 1;
    if (depth === 0) return CSS.slice(start, index);
  }
  return CSS.slice(start);
}

function declOf(block, selector, property) {
  const start = block.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} fehlt`);
  const body = block.slice(start, block.indexOf("}", start));
  const match = body.match(new RegExp(`${property}:\\s*([^;]+);`));
  assert.ok(match, `${selector}: ${property} fehlt`);
  return match[1].trim();
}

const px = (value) => Number(value.match(/(-?\d+(?:\.\d+)?)px/)[1]);

test("Setup mobil: alle drei Knoepfe der ChatGPT-Karte bleiben in flachen Fenstern mindestens 44 px hoch", () => {
  const block = blockOf(MOBIL_RASTER);
  const hoehe = declOf(block, "html #setup .opt:has(.obtns > :nth-child(3))", "--oboxh");
  const kleinsteBox = px(hoehe.replace(/^clamp\(/, ""));
  const abstand = px(declOf(block, "html #setup .obox.obtns:has(> :nth-child(3))", "gap"));
  const zeilen = declOf(
    block,
    "html #setup .obox.obtns:has(> :nth-child(3))",
    "grid-template-rows",
  );
  assert.equal(zeilen, `repeat(${KNOEPFE}, minmax(0, 1fr))`);
  const knopf = (kleinsteBox - (KNOEPFE - 1) * abstand) / KNOEPFE;
  assert.ok(knopf >= MIN_TREFFER, `kleinster Knopf ${knopf.toFixed(1)} px`);
});
