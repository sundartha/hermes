import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(join(WEB_ROOT, "src/styles/home.css"), "utf8");
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");

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
        rules.push({
          media: stack.filter((entry) => entry.startsWith("@media")),
          selector: prelude,
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

const mobile = (rule) => rule.media.some((query) => query.includes("max-width: 760px"));
const desktop = (rule) => rule.media.length === 0;
const selectors = (rule) => rule.selector.split(",").map((part) => part.trim());

function declsFor(rules, selector, scope) {
  return rules
    .filter((rule) => scope(rule) && selectors(rule).includes(selector))
    .flatMap((rule) => rule.decls);
}

function usesHead(page) {
  const start = page.indexOf('id="uses"');
  const head = page.indexOf(" shead ", start);
  const end = page.indexOf('class="ucs', head);
  return page.slice(head, end);
}

const HEAD_DOTS =
  /<div\s+class="ucdots"\s+aria-hidden="true"\s*>(\s*<i(\s+class="on")?\s*>\s*<\/i>){4}\s*<\/div>/;
const HEAD_HINT =
  /<span\s+class="sr ucdots-hint"\s+data-i18n="swipe"\s*>\s*Swipe for more\s*<\/span>/;

function cardsPart(page) {
  const cards = page.slice(page.indexOf('class="ucs'));
  return cards.split('id="setup"')[0];
}

function markupProblems(page) {
  const head = usesHead(page);
  const checks = [
    ["Striche nicht im Kopf", HEAD_DOTS.test(head)],
    ["sichtbarer Wisch-Text", !head.includes("ucdots-lbl")],
    ["Screenreader-Hinweis fehlt", HEAD_HINT.test(head)],
    ["Striche noch unter der Karte", !cardsPart(page).includes('class="ucdots"')],
  ];
  return checks.filter(([, ok]) => !ok).map(([name]) => name);
}

function cssProblems(css) {
  const rules = cssRules(css);
  const dots = declsFor(rules, ".ucdots", mobile);
  const checks = [
    ["Striche nicht in Label-Zeile", dots.includes("grid-row: 1")],
    ["Striche nicht rechts", dots.includes("justify-self: end")],
    ["Striche nicht an Kartenkante", dots.includes("margin-right: 14%")],
    [
      "Label nicht in Zeile 1",
      declsFor(rules, ".uses .shead .label", mobile).includes("grid-row: 1"),
    ],
    ["Striche auf Desktop sichtbar", declsFor(rules, ".ucdots", desktop).includes("display: none")],
    [
      "Hinweis auf Desktop vorgelesen",
      declsFor(rules, ".ucdots-hint", desktop).includes("display: none"),
    ],
    ["Hinweis mobil stumm", declsFor(rules, ".ucdots-hint", mobile).includes("display: block")],
  ];
  return checks.filter(([, ok]) => !ok).map(([name]) => name);
}

function dotsProblems(css, page) {
  return [...markupProblems(page), ...cssProblems(css)];
}

test("Startseite mobil: Wisch-Striche sitzen rechts neben dem Label, ohne sichtbaren Text", () => {
  assert.deepEqual(dotsProblems(CSS, PAGE), []);
});

test("Startseite mobil: der Striche-Check schlaegt bei der alten Anordnung an", () => {
  const oldPage = PAGE.replace(
    /<div class="ucdots" aria-hidden="true">.*?<\/div>\s*<span class="sr ucdots-hint"[^>]*>[^<]*<\/span>/s,
    "",
  ).replace(
    /(<div class="ucs)/,
    '<div class="ucdots" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i><span class="ucdots-lbl" data-i18n="swipe">Swipe for more</span></div>$1',
  );
  const oldCss = CSS.replace("margin-right: 14%;", "");
  assert.ok(dotsProblems(CSS, oldPage).includes("Striche nicht im Kopf"));
  assert.ok(dotsProblems(oldCss, PAGE).includes("Striche nicht an Kartenkante"));
});
