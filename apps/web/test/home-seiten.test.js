import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home.css"), "utf8");
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");
const PHONE = "max-width: 760px";

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

function declared(rules, selector, declaration) {
  return rules.filter((rule) => rule.selector === selector && rule.decls.includes(declaration));
}

const RULES = cssRules(CSS);
const phoneWithHeight = (rule) => rule.media.some((query) => query.includes(PHONE) && query.includes("min-height"));

test("Startseite mobil: jede Seite rastet fest und einzeln ein", () => {
  const sample = cssRules("@media (max-width: 760px) and (min-height: 560px) { html { scroll-snap-type: y mandatory; } }");
  assert.equal(declared(sample, "html", "scroll-snap-type: y mandatory").filter(phoneWithHeight).length, 1);
  assert.ok(declared(RULES, "html", "scroll-snap-type: y mandatory").some(phoneWithHeight), "html: kein festes Einrasten auf dem Handy");
  assert.ok(declared(RULES, "[data-snap]", "scroll-snap-stop: always").some(phoneWithHeight), "Seiten werden beim Wischen uebersprungen");
  assert.ok(RULES.some((rule) => phoneWithHeight(rule) && rule.selector.includes("main > [data-snap]") && rule.decls.includes("min-height: var(--page)")), "Seiten sind nicht einen Bildschirm hoch");
  assert.ok(declared(RULES, ":root", "--page: 100lvh").some(phoneWithHeight), "Seiten enden vor der eingeklappten Browserleiste: die naechste Seite schaut herein");
});

test("Startseite mobil quer oder sehr niedrig: kein festes Einrasten, Inhalt bleibt frei scrollbar", () => {
  const strict = declared(RULES, "html", "scroll-snap-type: y mandatory");
  const phoneWithoutHeight = strict.filter((rule) => rule.media.some((query) => query.includes(PHONE)) && !phoneWithHeight(rule));
  assert.deepEqual(phoneWithoutHeight, []);
  assert.ok(strict.every((rule) => rule.media.length > 0), "festes Einrasten ohne Bildschirmbedingung");
});

test("Startseite mobil: Ueberschrift und Preise stehen auf einer Seite ueber dem Foto", () => {
  const pricing = PAGE.slice(PAGE.indexOf('<section id="pricing"'), PAGE.indexOf('<section id="setup"'));
  assert.doesNotMatch(pricing, /snap-page/, "Preise sind wieder in zwei Seiten geteilt");
  assert.ok(!RULES.some((rule) => phoneWithHeight(rule) && rule.selector === ".pwrap" && rule.decls.some((decl) => decl.startsWith("grid-template-rows"))), "Preise haben wieder ein zweiseitiges Raster");
  assert.ok(!RULES.some((rule) => phoneWithHeight(rule) && rule.selector === ".pricing img.bg" && rule.decls.some((decl) => decl.startsWith("height"))), "Foto bedeckt nicht die ganze Preisseite");
});

test("Startseite mobil: Idee-Seite zeigt das Bild zuerst und laesst ihm den freien Platz", () => {
  const image = RULES.filter((rule) => rule.selector === ".idea-img" && phoneWithHeight(rule));
  assert.ok(image.some((rule) => rule.decls.includes("order: 0") && rule.decls.includes("flex: 1 1 0")), "Bild der Idee-Seite nicht oben mit freiem Platz");
  assert.ok(image.some((rule) => rule.decls.includes("min-height: 30svh")), "Bild der Idee-Seite kann verschwinden");
});

test("Startseite mobil: zu hohe Seiten behalten einen Halt an ihrem Ende, passende Seiten keinen zusaetzlichen", () => {
  const end = RULES.filter((rule) => rule.selector === ".snap-end" && phoneWithHeight(rule));
  assert.ok(end.some((rule) => rule.decls.includes("scroll-snap-stop: always")), "Ende einer zu hohen Seite wird uebersprungen");
  const onPageStart = (rule) => rule.decls.includes("top: max(0px, calc(100% - var(--page)))") && rule.decls.includes("scroll-snap-align: start");
  assert.ok(end.some(onPageStart), "Halt am Ende liegt bei passender Seite nicht auf ihrem Anfang");
  assert.ok(!end.some((rule) => rule.decls.some((decl) => decl.includes("dvh"))), "Halt am Ende haengt an der Browserleiste: Safari rastet 40 px hinter dem Seitenanfang ein");
  assert.ok(!end.some((rule) => rule.decls.includes("display: none")), "Halt am Seitenende fehlt auf dem Handy");
});

test("Startseite mobil: die Schritte aller Karten teilen sich dieselben Zeilen", () => {
  assert.ok(declared(RULES, ".ucs > .scene", "grid-template-rows: subgrid").some(phoneWithHeight), "Karten haben eigene Zeilen: Schritte stehen auf verschiedener Hoehe");
  assert.ok(declared(RULES, ".ucs .flow", "grid-template-rows: subgrid").some(phoneWithHeight), "Schritte haben eigene Zeilen");
});

test("Startseite: die Balken des Browsers nehmen die Farbe der sichtbaren Seite an", () => {
  assert.match(PAGE, /class="edge edge-top"/);
  assert.match(PAGE, /class="edge edge-bottom"/);
  assert.match(PAGE, /<meta name="theme-color"/);
  for (const page of ["idea", "uses", "pricing", "close"]) {
    assert.ok(RULES.some((rule) => rule.selector.includes(`html[data-page="${page}"]`) && rule.decls.some((decl) => decl.startsWith("--edge-top"))), `keine Balkenfarbe fuer ${page}`);
  }
});

test("Startseite: seitliche Abstaende weichen der Kamera-Aussparung im Querformat aus", () => {
  assert.match(CSS, /--gut: max\([^;]*env\(safe-area-inset-left\), env\(safe-area-inset-right\)\)/);
});
