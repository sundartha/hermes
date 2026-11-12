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

const inDesktop = (rule) => rule.media.some((query) => query.includes("min-width: 1001px"));
const inMobile = (rule) => rule.media.some((query) => query.includes("max-width: 760px"));
const selectorsOf = (rule) => rule.selector.split(",").map((part) => part.trim());
const declsOf = (selector, inMedia) => RULES.filter((rule) => selectorsOf(rule).includes(selector) && inMedia(rule)).flatMap((rule) => rule.decls);

test("Startseite Desktop: Szenen-Film laeuft unbeschnitten in 16:9", () => {
  const decls = declsOf(".ucs > .scene .vslot", inDesktop);
  const ratios = decls.filter((decl) => decl.startsWith("aspect-ratio"));
  assert.deepEqual(ratios, ["aspect-ratio: 16 / 9"], "Film wird am Desktop beschnitten");
  assert.ok(
    decls.some((decl) => decl.startsWith("width: min(100%") && decl.includes("* 16 / 9")),
    "Breite folgt in flachen Fenstern nicht der Hoehe",
  );
});

test("Startseite mobil: Szenen-Film behaelt 3:2 der Kartenbreite", () => {
  const slot = RULES.filter((rule) => inMobile(rule) && selectorsOf(rule).some((part) => part.endsWith(".vslot"))).flatMap((rule) => rule.decls);
  assert.deepEqual(
    slot.filter((decl) => decl.startsWith("aspect-ratio")),
    ["aspect-ratio: 3 / 2"],
    "Film hat mobil kein festes Seitenverhaeltnis",
  );
  assert.deepEqual(
    slot.filter((decl) => decl.startsWith("min-height") || decl.startsWith("height: 100%")),
    [],
    "Film darf mobil nicht auf einen Streifen schrumpfen",
  );
  const rows = declsOf(".ucs", inMobile).filter((decl) => decl.startsWith("grid-template-rows"));
  assert.deepEqual(rows, ["grid-template-rows: repeat(5, auto) minmax(auto, 1fr)"], "Restplatz geht nicht ans Kartenende");
});

test("Startseite: Szenen-Film wird beim Einblenden nicht vergroessert", () => {
  const zoomed = RULES.filter((rule) => selectorsOf(rule).includes(".js-rv .vslot.rvm video")).flatMap((rule) => rule.decls);
  assert.ok(zoomed.includes("scale: 1"), "Szenen-Film startet vergroessert");
});
