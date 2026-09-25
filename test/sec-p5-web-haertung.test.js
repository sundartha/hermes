// SEC-P5 - Web-Haertung. Was hier steht, deckt KEIN Bestandstest ab:
//   (A) HSTS steht in BEIDEN Auslieferungswegen mit demselben Wert (Gateway +
//       Static-Service). Der Header selbst wird in test/headers.test.js gemessen.
//   (B) Der Astro-Build kann unter script-src 'self' ueberhaupt laufen.
//   (C) Der Static-Service verliert 'unsafe-inline' in script-src nicht nachtraeglich.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HSTS_HEADER_VALUE } from "../src/middleware.js";
import { ROOT } from "./helpers.js";

// Astro liefert ein <script> aus einer .astro-Datei per Default als externes,
// gebuendeltes same-origin-Modul aus. Inline landet es nur ueber zwei Wege:
//   (a) das Attribut is:inline am <script>-Tag,
//   (b) ein Vite-Inline-Limit > 0 (kleine Skripte werden eingebettet).
// Ein <script> OHNE src ist deshalb KEIN Befund: der Einwilligungs-Platzhalter in
// components/site/AnalyticsSlot.astro ist ein nicht ausfuehrbares
// <script type="text/plain">, das consent.js erst nach Zustimmung durch ein echtes
// Element mit src ersetzt. Wer auf "kein src" pruefte, meldete ihn falsch.
const SCRIPT_TAG = /<script\b[^>]*>/gi;
// Bewusst eine benannte Liste statt /\son[a-z]+=/: das Muster traefe harmlose
// Attribute wie "only=" und machte die Pruefung unglaubwuerdig - eine Pruefung mit
// Falsch-Positiven wird abgeschaltet, nicht befolgt.
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

// HTML-Kommentare zuerst entfernen. In pages/app/index.astro steht woertlich
// "<!-- Scroll-Spy (siehe <script> unten) ... -->": ohne diesen Schritt meldete die
// Pruefung eine Prosa-Erwaehnung als Inline-Skript - ein Falsch-Positiv, und eine
// Pruefung mit Falsch-Positiven wird abgeschaltet, nicht befolgt.
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

// Reines Praedikat (kein I/O): liefert die Fundstellen, die unter script-src 'self'
// verworfen wuerden. Leeres Array = die Quelle ist CSP-vertraeglich.
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

// Rekursives Einsammeln der Quelldateien.
function quelldateien(verzeichnis) {
  const gefunden = [];
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const voll = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) gefunden.push(...quelldateien(voll));
    else if (QUELL_ENDUNGEN.includes(path.extname(eintrag.name))) gefunden.push(voll);
  }
  return gefunden;
}

// Die Header-Regeln des Static-Service stehen als YAML-Bloecke im Blueprint. Statt einen
// YAML-Parser einzufuehren (neue Dependency) wird der Wert zum Header-Namen gelesen -
// die Bloecke sind im Bestand einheitlich "name:" gefolgt von "value:".
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
  // Gegenprobe gegen Falsch-Positive - beides ist erlaubt und muss stumm bleiben:
  assert.equal(cspVerstoesse(`<script src="/a.js"></script><a only="1">`).length, 0);
  assert.equal(cspVerstoesse(`<script type="text/plain" data-src="/s.js"></script>`).length, 0);
  assert.equal(cspVerstoesse(`<!-- siehe <script is:inline> unten, onclick="x()" -->`).length, 0);
});
