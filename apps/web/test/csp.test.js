// Der GEBAUTE Output ist die Wahrheit fuer "laeuft unter script-src 'self'":
// die Quellpruefung (test/sec-p5-web-haertung.test.js im Wurzelprojekt) pinnt den
// Mechanismus, dieser Test das Ergebnis - inkl. app/index.html, das live bisher NIE
// unter der strikten CSP lief (der Static-Service liefert /app gar nicht aus).
//
// Build-Operate-Check (P13) wie pages.test.js: ein einmaliger astro-build in einen
// eigenen Test-outDir (before), danach reine Asserts.
//
// EHRLICH: diese Bahn laeuft NICHT in npm test des Wurzelprojekts und NICHT in CI -
// sie ist der Abnahme-Beleg auf Kommando (npm --prefix apps/web test). Der
// Dauerwaechter ist die Quellpruefung in der Wurzel-Testbank.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, relative } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-csp-test");

// Ein <script> ohne src ist nur dann ein Befund, wenn der Browser es AUSFUEHRT. Diese
// type-Werte fuehrt er nie aus - der Einwilligungs-Platzhalter (AnalyticsSlot.astro)
// reist als type="text/plain" mit und wird erst nach Zustimmung ersetzt.
const NICHT_AUSFUEHRBARE_TYPEN = Object.freeze([
  "text/plain",
  "application/json",
  "application/ld+json",
  "importmap",
  "speculationrules",
]);
// Benannte Liste statt /\son[a-z]+=/: das generische Muster traefe harmlose Attribute
// und machte die Pruefung unglaubwuerdig.
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
// Ein Fund wird nur als Ausschnitt gemeldet - die Fehlermeldung soll das Skript zeigen,
// nicht ein ganzes Bundle in den Testlauf kippen.
const FUND_AUSZUG_ZEICHEN = 80;

// HTML-Kommentare zuerst entfernen. Am gebauten /app-Dokument steht woertlich
// "<!-- Scroll-Spy (siehe <script> unten) ... -->": ohne diesen Schritt meldete die
// Pruefung eine Prosa-Erwaehnung als Inline-Skript - ein Falsch-Positiv, und eine
// Pruefung mit Falsch-Positiven wird abgeschaltet, nicht befolgt.
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function attributWert(attribute, name) {
  const treffer = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attribute);
  return treffer ? treffer[1].trim().toLowerCase() : null;
}

// Reines Praedikat (kein I/O): liefert die Rumpf-Texte der Skript-Elemente, die der
// Browser unter script-src 'self' verweigern wuerde.
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

// Reines Praedikat: Inline-Ereignisattribute und javascript:-URLs.
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
  // Gegenprobe gegen Falsch-Positive - beides ist erlaubt und muss stumm bleiben:
  assert.equal(ausfuehrbareInlineSkripte(`<script src="/a.js"></script>`).length, 0);
  assert.equal(ausfuehrbareInlineSkripte(`<script type="text/plain">x</script>`).length, 0);
  assert.equal(inlineHandlerFunde(`<a only="1" href="/x">`).length, 0);
  assert.equal(ausfuehrbareInlineSkripte(`<!-- siehe <script> unten -->`).length, 0);
  assert.equal(inlineHandlerFunde(`<!-- frueher stand hier onclick="x()" -->`).length, 0);
});
