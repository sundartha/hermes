import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home.css"), "utf8");

function cssRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [];
  const rules = [];
  let buffer = "";
  for (const char of source) {
    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) {
        const decls = buffer
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean);
        rules.push({ media: stack.filter((entry) => entry.startsWith("@media")), selector: prelude, decls });
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return rules;
}

const RULES = cssRules(CSS);

test("Startseite Desktop: Szenario-Video fuellt die Seitenhoehe", () => {
  const desktop = (rule) => rule.media.some((query) => query.includes("min-width: 1001px"));
  const video = RULES.filter((rule) => rule.selector === ".ucs > .scene .vslot" && desktop(rule));
  assert.ok(video.some((rule) => rule.decls.includes("max-height: calc(100svh - 2 * var(--scene-pad))")), "Video nicht an die Seitenhoehe gebunden");
  assert.ok(video.some((rule) => rule.decls.includes("grid-column: 1 / 9")), "Video nicht breiter als die Haelfte");
});
