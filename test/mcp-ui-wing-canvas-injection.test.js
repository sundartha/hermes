import { test } from "node:test";
import assert from "node:assert/strict";
import { withWingEngine } from "../src/ui/widget-catalog.js";

const PLACEHOLDER = "<!--__WING_ENGINE__-->";

test("T-wing-canvas-inject-present: Platzhalter wird genau einmal durch die Engine ersetzt", () => {
  const fixture = `<html><body>${PLACEHOLDER}</body></html>`;
  const out = withWingEngine(fixture);
  assert.ok(!out.includes(PLACEHOLDER), "Platzhalter verschwunden");
  assert.match(out, /<script>[\s\S]*HermesWingCanvas[\s\S]*<\/script>/, "Engine-Script eingefuegt");
  assert.equal((out.match(/<script>/g) || []).length, 1, "genau ein <script>-Block");
});

test("T-wing-canvas-inject-absent: ohne Platzhalter bleibt das HTML byte-unveraendert", () => {
  const fixture = "<html><body>kein Platzhalter hier</body></html>";
  assert.equal(withWingEngine(fixture), fixture);
});

test("T-wing-canvas-inject-no-network: injizierter Block ist self-contained", () => {
  const out = withWingEngine(`<html><body>${PLACEHOLDER}</body></html>`);
  assert.doesNotMatch(out, /https?:\/\//, "kein http(s)://");
  assert.doesNotMatch(out, /@import/, "kein @import");
});

test("T-wing-canvas-inject-no-leak: kein __WING_ENGINE__-Rest im Serve-Output aller Widgets", async () => {
  const { widgetHtml } = await import("../src/ui/widget-catalog.js");
  for (const id of ["call", "agent-status", "my-number", "calls"]) {
    assert.ok(!widgetHtml(id).includes("__WING_ENGINE__"), `${id}: kein Platzhalter-Leak`);
  }
});
