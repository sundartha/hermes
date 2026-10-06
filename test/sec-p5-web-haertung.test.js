import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HSTS_HEADER_VALUE } from "../src/middleware.js";
import { ROOT } from "./helpers.js";

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const INLINE_HANDLER_ATTRIBUTES = Object.freeze([
  "onclick",
  "onchange",
  "onsubmit",
  "oninput",
  "onload",
  "onerror",
  "onfocus",
  "onblur",
  "onkeydown",
  "onkeyup",
  "onmouseenter",
  "onmouseleave",
  "onscroll",
  "ontoggle",
]);
const QUELL_ENDUNGEN = Object.freeze([".astro", ".html"]);
const WEB_SRC_DIR = path.join(ROOT, "apps/web/src");
const ASTRO_CONFIG = path.join(ROOT, "apps/web/astro.config.mjs");
const RENDER_YAML = path.join(ROOT, "render.yaml");

const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function cspVerstoesse(quelltext) {
  const funde = [];
  const text = ohneHtmlKommentare(quelltext);
  for (const [tag] of text.matchAll(SCRIPT_TAG)) {
    if (/\bis:inline\b/i.test(tag)) funde.push(tag);
  }
  for (const attribut of INLINE_HANDLER_ATTRIBUTES) {
    const muster = new RegExp(`\\s${attribut}\\s*=`, "i");
    if (muster.test(text)) funde.push(attribut);
  }
  if (/(href|src|action)\s*=\s*["']?\s*javascript:/i.test(text)) {
    funde.push("javascript:");
  }
  return funde;
}

function quelldateien(verzeichnis) {
  const gefunden = [];
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const voll = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) gefunden.push(...quelldateien(voll));
    else if (QUELL_ENDUNGEN.includes(path.extname(eintrag.name))) gefunden.push(voll);
  }
  return gefunden;
}

function staticServiceHeaderWert(blueprint, headerName) {
  const muster = new RegExp(`name:\\s*${headerName}\\s*\\n\\s*value:\\s*(.+)`, "i");
  const treffer = muster.exec(blueprint);
  return treffer ? treffer[1].trim().replace(/^["']|["']$/g, "") : null;
}

test("SEC-P5: HSTS-Wert ist in Gateway und render.yaml derselbe", () => {
  const blueprint = fs.readFileSync(RENDER_YAML, "utf8");
  assert.equal(
    staticServiceHeaderWert(blueprint, "Strict-Transport-Security"),
    HSTS_HEADER_VALUE,
    "render.yaml und src/middleware.js muessen denselben HSTS-Wert tragen",
  );
});

test("SEC-P5: der Static-Service behaelt script-src 'self' ohne 'unsafe-inline'", () => {
  const blueprint = fs.readFileSync(RENDER_YAML, "utf8");
  const csp = staticServiceHeaderWert(blueprint, "Content-Security-Policy");
  assert.ok(csp, "render.yaml fuehrt keine Content-Security-Policy");
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test("SEC-P5: keine apps/web-Quelle erzeugt Inline-Skript oder Inline-Handler", () => {
  const dateien = quelldateien(WEB_SRC_DIR);
  assert.ok(dateien.length > 0, "keine Quelldateien gefunden - die Pruefung sucht nichts");
  for (const datei of dateien) {
    const funde = cspVerstoesse(fs.readFileSync(datei, "utf8"));
    assert.deepEqual(funde, [], `${path.relative(ROOT, datei)} ist nicht CSP-vertraeglich`);
  }
});

test("SEC-P5: astro.config.mjs pinnt assetsInlineLimit 0 und inlineStylesheets never", () => {
  const config = fs.readFileSync(ASTRO_CONFIG, "utf8");
  assert.match(config, /assetsInlineLimit:\s*0/);
  assert.match(config, /inlineStylesheets:\s*"never"/);
});

test("SEC-P5 Positiv-Kontrolle: die Pruefung schlaegt an", () => {
  assert.equal(cspVerstoesse(`<script is:inline>alert(1)</script>`).length, 1);
  assert.equal(cspVerstoesse(`<button onclick="x()">`).length, 1);
  assert.equal(cspVerstoesse(`<a href="javascript:x()">`).length, 1);
  assert.equal(cspVerstoesse(`<script src="/a.js"></script><a only="1">`).length, 0);
  assert.equal(cspVerstoesse(`<script type="text/plain" data-src="/s.js"></script>`).length, 0);
  assert.equal(cspVerstoesse(`<!-- siehe <script is:inline> unten, onclick="x()" -->`).length, 0);
});
