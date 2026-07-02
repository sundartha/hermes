// H2: Testet die Wing-Canvas-Engine-Injektion isoliert ueber ein
// synthetisches Fixture-HTML (die 5 echten Widgets tragen den Platzhalter in
// H2 noch NICHT - das kommt erst in H3/H4, WIDGET_DEFS bleibt hier
// unveraendert). Build-Operate-Check (P13) statt Reimplementierung der
// Replace-Logik im Test.
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
