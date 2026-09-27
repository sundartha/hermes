// H4: testet die zwei neuen Platzhalter-Injektionen (withHudCardCss,
// withWingCanvasMount) isoliert ueber synthetische Fixture-HTML - Build-Operate-
// Check (P13) statt Reimplementierung der Replace-Logik im Test. Gleiches Muster
// wie test/mcp-ui-wing-canvas-injection.test.js (H2, withWingEngine).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withHudCardCss,
  withWingCanvasMount,
  widgetHtml,
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
} from "../src/ui/widget-catalog.js";

const CSS_PLACEHOLDER = "/*__HUD_CARD_CSS__*/";
const MOUNT_PLACEHOLDER = "<!--__WING_CANVAS_MOUNT__-->";
const READ_ONLY_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS];

test("T-hud-css-inject-present: Platzhalter wird genau einmal durch HUD_CARD_CSS ersetzt", () => {
  const fixture = `<style>${CSS_PLACEHOLDER}</style>`;
  const out = withHudCardCss(fixture);
  assert.ok(!out.includes(CSS_PLACEHOLDER), "Platzhalter verschwunden");
  assert.match(out, /<style>[\s\S]*\.card\{[\s\S]*<\/style>/, "HUD_CARD_CSS eingefuegt (.card-Regel vorhanden)");
});

test("T-hud-css-inject-absent: ohne Platzhalter bleibt das HTML byte-unveraendert", () => {
  const fixture = "<style>kein Platzhalter hier</style>";
  assert.equal(withHudCardCss(fixture), fixture);
});

test("T-hud-css-inject-no-network: injizierter Block ist self-contained", () => {
  const out = withHudCardCss(`<style>${CSS_PLACEHOLDER}</style>`);
  assert.doesNotMatch(out, /https?:\/\//, "kein http(s)://");
  assert.doesNotMatch(out, /@import/, "kein @import");
});

test("T-wing-canvas-mount-inject-present: Platzhalter wird genau einmal durch das Mount-Skript ersetzt", () => {
  const fixture = `<body>${MOUNT_PLACEHOLDER}</body>`;
  const out = withWingCanvasMount(fixture);
  assert.ok(!out.includes(MOUNT_PLACEHOLDER), "Platzhalter verschwunden");
  assert.match(out, /<script>[\s\S]*HermesWingCanvas[\s\S]*<\/script>/, "Mount-Script eingefuegt");
  assert.equal((out.match(/<script>/g) || []).length, 1, "genau ein <script>-Block");
});

test("T-wing-canvas-mount-inject-absent: ohne Platzhalter bleibt das HTML byte-unveraendert", () => {
  const fixture = "<body>kein Platzhalter hier</body>";
  assert.equal(withWingCanvasMount(fixture), fixture);
});

test("T-wing-canvas-mount-inject-no-network: injizierter Block ist self-contained", () => {
  const out = withWingCanvasMount(`<body>${MOUNT_PLACEHOLDER}</body>`);
  assert.doesNotMatch(out, /https?:\/\//, "kein http(s)://");
  assert.doesNotMatch(out, /@import/, "kein @import");
});

test("T-hud-card-no-leak: kein __HUD_CARD_CSS__/__WING_CANVAS_MOUNT__-Rest im Serve-Output der 4 Read-only-Widgets", () => {
  for (const id of READ_ONLY_WIDGET_IDS) {
    const html = widgetHtml(id);
    assert.ok(!html.includes("__HUD_CARD_CSS__"), `${id}: kein HUD_CARD_CSS-Platzhalter-Leak`);
    assert.ok(!html.includes("__WING_CANVAS_MOUNT__"), `${id}: kein WING_CANVAS_MOUNT-Platzhalter-Leak`);
  }
});

test("T-hud-card-defensive-ac6: kein <button/href=/callTool/innerHTML in widgetHtml() der 4 Read-only-Widgets", () => {
  for (const id of READ_ONLY_WIDGET_IDS) {
    const html = widgetHtml(id);
    assert.doesNotMatch(html, /<button/, `${id}: kein <button> (read-only)`);
    assert.doesNotMatch(html, /href\s*=/, `${id}: kein href-Linkback`);
    assert.ok(!html.includes("callTool"), `${id}: kein callTool (read-only, kein Callback)`);
    assert.ok(!html.includes("innerHTML"), `${id}: kein innerHTML (XSS-Gate, S1)`);
  }
});
