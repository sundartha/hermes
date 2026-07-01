// T2 (tasks/mcp-widget-branding-chain.md): statische idle-Wing-Marke in den 4
// Read-only-Widgets (kein Anruf-Lebenszyklus, deshalb kein Skript-Diff dort - nur
// Markup + der idle-Keyframe-Block). Byte-Identitaet zur Quelle (wing-image.js)
// verhindert stillen Drift zwischen den 5 self-contained Kopien.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  widgetHtml,
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
} from "../src/ui/widget-catalog.js";
import { WING_PNG } from "../design-system/components/brand/wing-image.js";

const STATIC_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS, WIDGET_CALENDAR];
const STATE_KEYFRAMES_NOT_EXPECTED = [
  "hermesWingConnect", "hermesWingFlap", "hermesWingSuccess", "hermesWingError",
];

for (const id of STATIC_WIDGET_IDS) {
  test(`T-wing-static-${id}: idle-Wing vorhanden, byte-identisches PNG, keine ungenutzten State-Keyframes, .dot abgeloest`, () => {
    const html = widgetHtml(id);
    assert.match(html, /@keyframes\s+hermesWingDrift\s*\{/, "Drift-Keyframe vorhanden");
    assert.match(html, /@keyframes\s+hermesWingBob\s*\{/, "Bob-Keyframe vorhanden");
    assert.match(html, /prefers-reduced-motion/, "reduced-motion-Regel vorhanden");
    assert.match(html, /class="wing wing--idle"/, "idle-Wing-Marke im Markup");
    assert.ok(html.includes(WING_PNG), "WING_PNG byte-identisch aus wing-image.js eingebettet");
    assert.ok(!html.includes("innerHTML"), "kein innerHTML (XSS-Gate, S1)");
    assert.doesNotMatch(html, /class="dot"/, "anonymer .dot-Indikator durch die Wing-Marke abgeloest");
    for (const unexpected of STATE_KEYFRAMES_NOT_EXPECTED) {
      assert.doesNotMatch(html, new RegExp("@keyframes\\s+" + unexpected), `${unexpected} ist hier toter Code (nur idle) - AC5`);
    }
  });
}
