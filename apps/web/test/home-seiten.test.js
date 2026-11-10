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
  assert.ok(declared(RULES, "main > [data-snap]", "min-height: 100svh").some(phoneWithHeight), "Seiten sind nicht einen Bildschirm hoch");
});

test("Startseite mobil quer oder sehr niedrig: kein festes Einrasten, Inhalt bleibt frei scrollbar", () => {
  const strict = declared(RULES, "html", "scroll-snap-type: y mandatory");
  const phoneWithoutHeight = strict.filter((rule) => rule.media.some((query) => query.includes(PHONE)) && !phoneWithHeight(rule));
  assert.deepEqual(phoneWithoutHeight, []);
  assert.ok(strict.every((rule) => rule.media.length > 0), "festes Einrasten ohne Bildschirmbedingung");
});

test("Startseite mobil: Preise sind zwei Seiten, die zweite ist ein eigener Einrastpunkt", () => {
  const pricing = PAGE.slice(PAGE.indexOf('<section id="pricing"'), PAGE.indexOf('<section id="setup"'));
  assert.match(pricing, /<span class="snap-page" data-snap aria-hidden="true"><\/span>/);
  assert.ok(declared(RULES, ".snap-page", "top: 100svh").some(phoneWithHeight), "zweite Preisseite beginnt nicht genau einen Bildschirm tiefer");
  assert.ok(declared(RULES, ".snap-page", "display: none").some((rule) => rule.media.length === 0), "Einrastpunkt ausserhalb des Handys sichtbar");
});

test("Startseite mobil: Idee-Seite zeigt das Bild zuerst und laesst ihm den freien Platz", () => {
  const image = RULES.filter((rule) => rule.selector === ".idea-img" && phoneWithHeight(rule));
  assert.ok(image.some((rule) => rule.decls.includes("order: 0") && rule.decls.includes("flex: 1 1 0")), "Bild der Idee-Seite nicht oben mit freiem Platz");
  assert.ok(image.some((rule) => rule.decls.includes("min-height: 30svh")), "Bild der Idee-Seite kann verschwinden");
});

test("Startseite mobil: zu hohe Seiten behalten einen Halt an ihrem Ende, passende Seiten keinen zusaetzlichen", () => {
  const end = RULES.filter((rule) => rule.selector === ".snap-end" && phoneWithHeight(rule));
  assert.ok(end.some((rule) => rule.decls.includes("scroll-snap-stop: always")), "Ende einer zu hohen Seite wird uebersprungen");
  assert.ok(end.some((rule) => rule.decls.includes("min-height: 100dvh")), "Halt am Ende liegt bei passender Seite nicht auf ihrem Anfang");
  assert.ok(!end.some((rule) => rule.decls.includes("display: none")), "Halt am Seitenende fehlt auf dem Handy");
});

test("Startseite mobil: die zweiseitigen Preise sind kein uebergrosser Einrastbereich, sondern zwei bildschirmhohe", () => {
  assert.ok(declared(RULES, "#pricing", "scroll-snap-align: none").some(phoneWithHeight), "Preise als ein Bereich: Safari scrollt darin frei und ueberspringt die Tabelle");
  const halves = RULES.filter((rule) => rule.selector.includes("#pricing::before") && rule.selector.includes(".snap-page") && phoneWithHeight(rule));
  assert.ok(halves.some((rule) => rule.decls.includes("height: 100svh") && rule.decls.includes("scroll-snap-align: start") && rule.decls.includes("scroll-snap-stop: always")), "Preisseiten sind nicht je einen Bildschirm hoch");
});
