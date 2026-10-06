import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HUD_CARD_CSS } from "../src/ui/hud-card-css.js";

const CALL_HTML = readFileSync(
  fileURLToPath(new URL("../src/ui/widgets/call.html", import.meta.url)),
  "utf8",
);

const SHARED_CUSTOM_PROPERTIES = [
  "color-navy-800", "color-navy-900", "color-navy-card", "color-white",
  "radius-card", "radius-pill", "font-sans", "ease",
  "color-accent-light", "color-accent-light-strong",
  "color-accent-light-rgb", "color-accent-light-glow",
];

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
