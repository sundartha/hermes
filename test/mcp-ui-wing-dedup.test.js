import { test } from "node:test";
import assert from "node:assert/strict";
import {
  widgetHtml,
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
} from "../src/ui/widget-catalog.js";
import {
  WING_CSS_STATIC,
  WING_CSS_LIVE,
  WING_MARKUP_STATIC,
  WING_MARKUP_LIVE,
  WING_CSS_DARK_STATIC,
  WING_CSS_DARK_LIVE,
  WING_MARKUP_DARK_STATIC,
  WING_MARKUP_DARK_LIVE,
} from "../src/ui/wing-markup.js";
import { WING_PNG } from "../design-system/components/brand/wing-image.js";

const STATIC_WIDGETS = [
  ["agent-status.html", WIDGET_AGENT_STATUS],
  ["my-number.html", WIDGET_MY_NUMBER],
  ["calls.html", WIDGET_CALLS],
];

const EINMAL = 1;
const WING_DRIFT_KEYFRAMES = /@keyframes\s+hermesWingDrift/g;

function vorkommen(text, gesucht) {
  return text.split(gesucht).length - 1;
}

function pruefeWingGenauEinmal(id) {
  const html = widgetHtml(id);
  assert.equal(vorkommen(html, WING_PNG), EINMAL, "WING_PNG genau einmal (nur injiziert, keine Kopie in der Quelle)");
  assert.equal(html.match(WING_DRIFT_KEYFRAMES).length, EINMAL, "Wing-Keyframes genau einmal");
}

test("T-wing-dedup-once-agent-status: ausgeliefertes Widget traegt WING_PNG und die Wing-Keyframes genau einmal", () => {
  pruefeWingGenauEinmal(WIDGET_AGENT_STATUS);
});

test("T-wing-dedup-once-my-number: ausgeliefertes Widget traegt WING_PNG und die Wing-Keyframes genau einmal", () => {
  pruefeWingGenauEinmal(WIDGET_MY_NUMBER);
});

test("T-wing-dedup-once-calls: ausgeliefertes Widget traegt WING_PNG und die Wing-Keyframes genau einmal", () => {
  pruefeWingGenauEinmal(WIDGET_CALLS);
});

test("T-wing-dedup-once-call: ausgeliefertes Widget traegt WING_PNG und die Wing-Keyframes genau einmal", () => {
  pruefeWingGenauEinmal(WIDGET_CALL);
});

for (const [, id] of STATIC_WIDGETS) {
  test(`T-wing-dedup-output-static-${id}: injiziertes CSS/Markup ist exakt WING_CSS_DARK_STATIC/WING_MARKUP_DARK_STATIC (H4: Olympus-HUD ist volldunkel)`, () => {
    const html = widgetHtml(id);
    assert.ok(html.includes(WING_CSS_DARK_STATIC), "WING_CSS_DARK_STATIC vollstaendig eingefuegt");
    assert.ok(html.includes(WING_MARKUP_DARK_STATIC), "WING_MARKUP_DARK_STATIC vollstaendig eingefuegt");
  });
}

test("T-wing-dedup-output-call: injiziertes CSS/Markup ist exakt WING_CSS_DARK_LIVE/WING_MARKUP_DARK_LIVE (H3: Olympus-HUD ist volldunkel)", () => {
  const html = widgetHtml(WIDGET_CALL);
  assert.ok(html.includes(WING_CSS_DARK_LIVE), "WING_CSS_DARK_LIVE vollstaendig eingefuegt");
  assert.ok(html.includes(WING_MARKUP_DARK_LIVE), "WING_MARKUP_DARK_LIVE vollstaendig eingefuegt");
});

test("T-wing-dedup-variants: STATIC ist eine echte Teilmenge von LIVE (eine Quelle, keine zweite Kopie der Basis-Regeln)", () => {
  assert.ok(WING_CSS_LIVE.includes(".wing--idle .wing-inner{animation:hermesWingBob"), "Basis-Regeln in LIVE enthalten");
  assert.notEqual(WING_CSS_STATIC, WING_CSS_LIVE, "STATIC bleibt schlanker als LIVE (keine ungenutzten State-Keyframes)");
});

test("T-wing-dedup-dark-variants: dunkle Auspraegung neutralisiert die navy Rundmarke, sonst dieselben Keyframes wie hell", () => {
  assert.notEqual(WING_CSS_DARK_STATIC, WING_CSS_STATIC, "dark ist eine eigene CSS-Auspraegung");
  assert.notEqual(WING_CSS_DARK_LIVE, WING_CSS_LIVE, "dark-LIVE ist eine eigene CSS-Auspraegung");
  assert.match(WING_CSS_DARK_STATIC, /\.wing--dark\{background:none\}/, "dark-Override neutralisiert die navy Rundmarke (0dca7ce-Regression)");
  assert.match(WING_CSS_DARK_LIVE, /\.wing--dark\{background:none\}/, "dark-Override neutralisiert die navy Rundmarke im dunklen LIVE-CSS");
  assert.match(WING_CSS_DARK_STATIC, /@keyframes\s+hermesWingDrift/, "dieselben idle-Keyframes wie hell");
  assert.match(WING_CSS_DARK_LIVE, /@keyframes\s+hermesWingFlap/, "dieselben State-Keyframes wie hell");
  assert.ok(WING_MARKUP_DARK_STATIC.includes(WING_PNG), "gleiches WING_PNG, nur andere Klasse");
  assert.notEqual(WING_MARKUP_DARK_STATIC, WING_MARKUP_STATIC, "dark-Markup traegt eigenen Klassen-Hook");
  assert.notEqual(WING_MARKUP_DARK_LIVE, WING_MARKUP_LIVE, "dark-LIVE-Markup traegt eigenen Klassen-Hook");
});

test("T-wing-dedup-dark-variants-subset: dark-STATIC bleibt Teilmenge von dark-LIVE (wie bei hell)", () => {
  assert.ok(WING_CSS_DARK_LIVE.includes(".wing--idle .wing-inner{animation:hermesWingBob"), "Basis-Regeln enthalten");
  assert.notEqual(WING_CSS_DARK_STATIC, WING_CSS_DARK_LIVE, "dark-STATIC bleibt schlanker als dark-LIVE");
});
