import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";

const PAGES = [
  ["support", "/support"],
  ["registrieren", "/registrieren"],
  ["kuendigen", "/kuendigen"],
  ["privacy", "/legal/privacy"],
  ["imprint", "/legal/imprint"],
  ["terms", "/legal/terms"],
  ["datenschutz", "/datenschutz"],
  ["impressum", "/impressum"],
  ["agb", "/agb"],
];

const LANG_PAIRS = [
  ["/legal/privacy", "de", "/datenschutz"],
  ["/datenschutz", "en", "/legal/privacy"],
  ["/legal/imprint", "de", "/impressum"],
  ["/impressum", "en", "/legal/imprint"],
  ["/legal/terms", "de", "/agb"],
  ["/agb", "en", "/legal/terms"],
];

let workDir;
let distDir;
let css;

before(() => {
  ({ workDir, distDir } = buildSite(".unterseiten-rahmen-", "dist"));
  const assetsDir = join(distDir, "_astro");
  css = readdirSync(assetsDir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(assetsDir, name), "utf8"))
    .find((text) => text.includes(".sub-head"));
});

after(() => {
  removeBuild(workDir);
});

function seite(path) {
  const html = readFileSync(join(distDir, path, "index.html"), "utf8");
  const window = new Window();
  window.document.documentElement.innerHTML = html;
  return window.document;
}

for (const [name, path] of PAGES) {
  test(`${name}: Marken-Link nennt den sichtbaren Text zuerst`, () => {
    const brand = seite(path).querySelector(".nbrand");
    const label = brand.getAttribute("aria-label");
    assert.ok(label.startsWith("Hermes by Sundartha"), label);
  });
}

for (const [path, lang, ziel] of LANG_PAIRS) {
  test(`${path}: Link zur Gegensprache fuehrt nach ${ziel}`, () => {
    const link = seite(path).querySelector(`a[hreflang="${lang}"]`);
    assert.ok(link, "Sprachlink fehlt");
    assert.equal(link.getAttribute("href"), ziel);
    assert.equal(link.getAttribute("lang"), lang);
  });
}

test("Seiten ohne Gegenversion haben keinen Sprachlink", () => {
  for (const path of ["/support", "/registrieren", "/kuendigen"]) {
    assert.equal(seite(path).querySelector("a[hreflang]"), null, path);
  }
});

test("Desktop-Navigation erscheint ab 768 px, Burger darunter", () => {
  assert.match(css, /@media\s*\((?:max-width:\s*|width\s*<=\s*)767px\)\s*\{\s*\.navlinks/);
  assert.doesNotMatch(css, /@media\s*\((?:max-width:\s*|width\s*<=\s*)1000px\)\s*\{\s*\.navlinks,\.navlogin/);
});

test("Mobil-Footer: Trenner nutzt Stone-Token, nicht on-night-4", () => {
  const regel = css.match(/\.f-support::?before\s*\{[^}]*content:\s*"·"[^}]*\}/);
  assert.ok(regel, "Trenner-Regel fehlt");
  assert.doesNotMatch(regel[0], /on-night-4/);
  assert.match(regel[0], /color:\s*var\(--muted\)/);
});

test("Inhaltslinks und Footer-Links haben mindestens 24 px Zielhoehe", () => {
  assert.match(css, /\.sub-main a:not\(\[class\]\)\s*\{[^}]*min-height:\s*24px/);
});
