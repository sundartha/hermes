import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const NO_PREFERENCE = "prefers-reduced-motion: no-preference";

// CSS-Animationen (animation/animation-name, nicht "none"), die nicht in einem
// @media-Block mit prefers-reduced-motion: no-preference stehen.
function animationsWithoutMotionGate(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const preludes = [];
  const found = [];
  let buffer = "";
  for (const char of source) {
    if (char === "{") {
      preludes.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      preludes.pop();
      buffer = "";
    } else if (char === ";") {
      const declaration = buffer.trim();
      const animates = /^animation(-name)?\s*:/.test(declaration) && !/:\s*none\b/.test(declaration);
      const gated = preludes.some((prelude) => prelude.startsWith("@media") && prelude.includes(NO_PREFERENCE));
      if (animates && !gated) found.push(declaration);
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return found;
}

test("Startseite: CSS-Animationen laufen nur ohne Wunsch nach reduzierter Bewegung", () => {
  const sample = `.a { animation: spin 1s; }
    @media (${NO_PREFERENCE}) { .b { animation: spin 1s; } }
    @media (max-width: 760px) { .c { animation-name: pan; } }
    .d { animation: none; }`;
  assert.deepEqual(animationsWithoutMotionGate(sample), ["animation: spin 1s", "animation-name: pan"]);
  const css = readFileSync(join(WEB_ROOT, "src/styles/home.css"), "utf8");
  assert.match(css, /@keyframes/, "home.css: keine Animation gefunden (Test veraltet?)");
  const ungated = animationsWithoutMotionGate(css);
  assert.deepEqual(ungated, [], `home.css: Animation ohne Bewegungs-Schalter: ${ungated.join(" | ")}`);
});
