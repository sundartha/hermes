import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (name) => readFileSync(join(WEB_ROOT, "src/styles", name), "utf8");
const HOME = read("home.css");
const SOUND = read("home-sound.css");
const PROOF = read("home-proof.css");

function cssRules(css) {
  const stack = [];
  const rules = [];
  let buffer = "";
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
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
        const selectors = prelude.split(",").map((part) => part.replace(/\s+/g, " ").trim());
        rules.push({
          media: stack.filter((entry) => entry.startsWith("@media")),
          selectors,
          decls,
        });
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return rules;
}

const LIMIT = /\((min|max)-(width|height):\s*(\d+)px\)/g;

function conditionHolds(condition, size) {
  if (/prefers-|pointer|hover/.test(condition)) return false;
  for (const [, side, axis, value] of condition.matchAll(LIMIT)) {
    const actual = size[axis];
    if (side === "min" ? actual < Number(value) : actual > Number(value)) return false;
  }
  return true;
}

const mediaHolds = (query, size) =>
  query
    .replace(/^@media\s*/, "")
    .split(",")
    .some((condition) => conditionHolds(condition, size));

const RULES = cssRules(HOME);

function declsAt(selector, size) {
  return RULES.filter(
    (rule) =>
      rule.selectors.includes(selector) && rule.media.every((query) => mediaHolds(query, size)),
  ).flatMap((rule) => rule.decls);
}

const NARROW = [
  { width: 761, height: 953 },
  { width: 900, height: 953 },
  { width: 1000, height: 953 },
  { width: 1001, height: 700 },
  { width: 1024, height: 768 },
  { width: 1181, height: 720 },
  { width: 1279, height: 900 },
];
const WIDE = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const label = (size) => `${size.width}x${size.height}`;

test("Startseite schmaler Desktop und Half-Screen: Film und Text stehen untereinander", () => {
  for (const size of NARROW) {
    const scene = declsAt("#uses .ucs > .scene", size);
    assert.ok(scene.includes("flex-direction: column"), `${label(size)}: Szene nicht gestapelt`);
    assert.ok(
      scene.includes("min-height: 100svh"),
      `${label(size)}: Szene nicht an die Fensterhoehe gebunden`,
    );
    const text = declsAt("#uses .ucs > .scene .s-body", size);
    assert.ok(
      text.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)"),
      `${label(size)}: Text unter dem Film nicht zweispaltig`,
    );
  }
});

test("Startseite gestapelt: Film teilt sich die Fensterhoehe mit dem Text und bleibt 16:9", () => {
  for (const size of NARROW) {
    const film = declsAt("#uses .ucs > .scene .vslot", size);
    assert.ok(film.includes("flex: 1 1 0"), `${label(size)}: Film nimmt nicht nur den Restplatz`);
    assert.ok(film.includes("aspect-ratio: 16 / 9"), `${label(size)}: Film verliert 16:9`);
    assert.ok(
      film.includes("max-height: calc(100cqw * 9 / 16)"),
      `${label(size)}: Film breiter als die Spalte`,
    );
    assert.ok(
      film.some((decl) => decl.startsWith("min-height: min(calc(100cqw * 9 / 16)")),
      `${label(size)}: Film kann auf null schrumpfen`,
    );
  }
});

test("Startseite breit: Textspalte steht neben dem Film und endet an der Leiste", () => {
  for (const size of WIDE) {
    assert.deepEqual(
      declsAt("#uses .ucs > .scene", size),
      [],
      `${label(size)}: gestapelte Regel greift am breiten Desktop`,
    );
    const text = declsAt(".ucs > .scene .s-body", size);
    assert.ok(
      text.includes("justify-content: space-between"),
      `${label(size)}: Text nicht ueber die Filmhoehe verteilt`,
    );
    assert.ok(
      text.includes("margin-bottom: var(--vbar)"),
      `${label(size)}: Unterkante nicht an der Film-Leiste`,
    );
  }
});

test("Startseite: Fusshoehe --fh wird im Abschnitt nicht ueberschrieben, Leiste nur einmal definiert", () => {
  for (const css of [HOME, SOUND, PROOF]) {
    assert.doesNotMatch(
      css,
      /--fh\s*:/,
      "--fh wird in CSS gesetzt und verdeckt die gemessene Fusshoehe",
    );
    assert.doesNotMatch(css, /--uses-bar/, "zweite Leistenhoehe neben --vbar");
  }
  assert.equal((SOUND.match(/--vbar\s*:/g) ?? []).length, 1, "--vbar mehrfach gesetzt");
});

test("Startseite: Stylesheets des Abschnitts ohne Kommentare", () => {
  for (const [name, css] of [
    ["home.css", HOME],
    ["home-sound.css", SOUND],
    ["home-proof.css", PROOF],
  ]) {
    assert.doesNotMatch(css, /\/\*/, `${name} enthaelt Kommentare`);
  }
});
