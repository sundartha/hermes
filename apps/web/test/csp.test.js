import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, relative } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-csp-test");

const NICHT_AUSFUEHRBARE_TYPEN = Object.freeze([
  "text/plain",
  "application/json",
  "application/ld+json",
  "importmap",
  "speculationrules",
]);
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
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const FUND_AUSZUG_ZEICHEN = 80;

const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function attributWert(attribute, name) {
  const treffer = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attribute);
  return treffer ? treffer[1].trim().toLowerCase() : null;
}

function ausfuehrbareInlineSkripte(html) {
  const funde = [];
  for (const [, attribute, rumpf] of ohneHtmlKommentare(html).matchAll(SCRIPT_ELEMENT)) {
    if (/\bsrc\s*=/i.test(attribute)) continue;
    if (!rumpf.trim()) continue;
    const typ = attributWert(attribute, "type");
    if (typ && NICHT_AUSFUEHRBARE_TYPEN.includes(typ)) continue;
    funde.push(rumpf.trim().slice(0, FUND_AUSZUG_ZEICHEN));
  }
  return funde;
}

function inlineHandlerFunde(html) {
  const funde = [];
  const text = ohneHtmlKommentare(html);
  for (const attribut of INLINE_HANDLER_ATTRIBUTES) {
    if (new RegExp(`\\s${attribut}\\s*=`, "i").test(text)) funde.push(attribut);
  }
  if (/(href|src|action)\s*=\s*["']?\s*javascript:/i.test(text)) funde.push("javascript:");
  return funde;
}

function htmlDateien(verzeichnis) {
  const gefunden = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const voll = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) gefunden.push(...htmlDateien(voll));
    else if (extname(eintrag.name) === ".html") gefunden.push(voll);
  }
  return gefunden;
}

before(() => {
  rmSync(DIST_DIR, { recursive: true, force: true });
  execFileSync("npx", ["astro", "build", "--outDir", DIST_DIR], {
    cwd: WEB_ROOT,
    stdio: "pipe",
  });
});

test("kein ausfuehrbares Inline-<script> im Build", () => {
  const seiten = htmlDateien(DIST_DIR);
  assert.ok(seiten.length > 0, "kein gebautes HTML gefunden - die Pruefung sucht nichts");
  for (const seite of seiten) {
    const funde = ausfuehrbareInlineSkripte(readFileSync(seite, "utf8"));
    assert.deepEqual(funde, [], `${relative(DIST_DIR, seite)} traegt ein Inline-Skript`);
  }
});

test("kein Inline-Ereignisattribut, keine javascript:-URL im Build", () => {
  for (const seite of htmlDateien(DIST_DIR)) {
    const funde = inlineHandlerFunde(readFileSync(seite, "utf8"));
    assert.deepEqual(funde, [], `${relative(DIST_DIR, seite)} traegt einen Inline-Handler`);
  }
});

test("Positiv-Kontrolle: die Pruefung schlaegt an einem synthetischen Fund an", () => {
  assert.equal(ausfuehrbareInlineSkripte(`<script>alert(1)</script>`).length, 1);
  assert.equal(inlineHandlerFunde(`<button onclick="x()">`).length, 1);
  assert.equal(inlineHandlerFunde(`<a href="javascript:x()">`).length, 1);
  assert.equal(ausfuehrbareInlineSkripte(`<script src="/a.js"></script>`).length, 0);
  assert.equal(ausfuehrbareInlineSkripte(`<script type="text/plain">x</script>`).length, 0);
  assert.equal(inlineHandlerFunde(`<a only="1" href="/x">`).length, 0);
  assert.equal(ausfuehrbareInlineSkripte(`<!-- siehe <script> unten -->`).length, 0);
  assert.equal(inlineHandlerFunde(`<!-- frueher stand hier onclick="x()" -->`).length, 0);
});
