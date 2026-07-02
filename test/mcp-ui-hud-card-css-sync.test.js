// H4 Review-Fix (S2-1): Drift-Guard fuer den gemeinsamen Olympus-HUD-
// Kartenrahmen zwischen call.html (H3, bleibt in dieser Kette unangetastet,
// ABS_RULES) und hud-card-css.js (H4, injiziert in die 4 Read-only-Widgets).
// hud-card-css.js ist NICHT aus call.html importiert (siehe dortiger Kopf-
// kommentar "Werte sind ABSICHTLICH identisch zu call.html gewaehlt"), daher
// gibt es KEINEN automatischen Sync-Mechanismus zwischen beiden Dateien -
// dieser Test ist das Drift-Gate (Muster wie mcp-ui-wing-canvas-sync.test.js
// T-wing-canvas-sync fuer die Engine-Doppelkopie design-system/src-ui).
// Ohne diesen Test faellt eine kuenftige Aenderung an genau EINEM der beiden
// Orte nie auf - die Karten liefen still visuell auseinander (PLAN
// tasks/widget-hermes-redesign-chain.md H4-AC3: "die 5 Widgets teilen
// Tokens/Basis-CSS wortgleich").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HUD_CARD_CSS } from "../src/ui/hud-card-css.js";

const CALL_HTML = readFileSync(
  fileURLToPath(new URL("../src/ui/widgets/call.html", import.meta.url)),
  "utf8",
);

// Custom Properties, die laut hud-card-css.js Kopfkommentar ABSICHTLICH
// wortgleich zu call.html sind (Produkt-weite Konsistenz fuer Farben/Radien/
// Ease). --wing-size und --wing-glow-filter sind bewusst NICHT gelistet: sie
// weichen bewusst ab (86px read-only vs. 112px live-Karte, kleinerer Glow-
// Radius fuer die kleinere Karte).
const SHARED_CUSTOM_PROPERTIES = [
  "color-navy-800", "color-navy-900", "color-navy-card", "color-white",
  "radius-card", "radius-pill", "font-sans", "ease",
  "color-accent-light", "color-accent-light-strong",
  "color-accent-light-rgb", "color-accent-light-glow",
];

// Basisregeln, die laut hud-card-css.js-Kopfkommentar wortgleich aus call.html
// uebernommen sind (body-Reset + Wing-Canvas-Mount-Rahmen).
const SHARED_RULE_SELECTORS = ["body", "\\.wing-canvas-mount", "\\.wing-canvas-mount canvas"];

function customPropertyValue(css, name, source) {
  const match = css.match(new RegExp(`--${name}:([^;]+);`));
  assert.ok(match, `--${name} nicht gefunden in ${source}`);
  return match[1];
}

function ruleBody(css, selectorSource, source) {
  const match = css.match(new RegExp(`${selectorSource}\\{([^}]*)\\}`));
  assert.ok(match, `Regel "${selectorSource}" nicht gefunden in ${source}`);
  return match[1].replace(/\s+/g, "");
}

test("T-hud-card-css-sync-tokens: geteilte Custom Properties sind wortgleich in call.html und HUD_CARD_CSS", () => {
  for (const name of SHARED_CUSTOM_PROPERTIES) {
    const fromCallHtml = customPropertyValue(CALL_HTML, name, "call.html");
    const fromHudCardCss = customPropertyValue(HUD_CARD_CSS, name, "HUD_CARD_CSS");
    assert.equal(
      fromHudCardCss, fromCallHtml,
      `--${name} ist auseinandergelaufen (call.html="${fromCallHtml}" vs HUD_CARD_CSS="${fromHudCardCss}") - beide Orte synchron pflegen`,
    );
  }
});

test("T-hud-card-css-sync-rules: geteilte Basisregeln (body/.wing-canvas-mount) sind wortgleich (whitespace-normalisiert)", () => {
  for (const selector of SHARED_RULE_SELECTORS) {
    const fromCallHtml = ruleBody(CALL_HTML, selector, "call.html");
    const fromHudCardCss = ruleBody(HUD_CARD_CSS, selector, "HUD_CARD_CSS");
    assert.equal(
      fromHudCardCss, fromCallHtml,
      `Regel "${selector}" ist auseinandergelaufen - beide Orte synchron pflegen`,
    );
  }
});
