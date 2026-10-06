import { test } from "node:test";
import assert from "node:assert/strict";
import {
  widgetHtml,
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
} from "../src/ui/widget-catalog.js";
import { WING_PNG } from "../design-system/components/brand/wing-image.js";

const STATIC_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS];
const STATE_KEYFRAMES_NOT_EXPECTED = [
  "hermesWingConnect", "hermesWingFlap", "hermesWingSuccess", "hermesWingError",
];

for (const id of STATIC_WIDGET_IDS) {
  test(`T-wing-static-${id}: idle-Wing vorhanden (H4, dunkle Auspraegung), byte-identisches PNG, keine ungenutzten State-Keyframes, .dot abgeloest`, () => {
    const html = widgetHtml(id);
    assert.match(html, /@keyframes\s+hermesWingDrift\s*\{/, "Drift-Keyframe vorhanden");
    assert.match(html, /@keyframes\s+hermesWingBob\s*\{/, "Bob-Keyframe vorhanden");
    assert.match(html, /prefers-reduced-motion/, "reduced-motion-Regel vorhanden");
    assert.match(html, /class="wing wing--dark wing--idle"/, "dunkle idle-Wing-Marke im Markup (H4)");
    assert.match(html, /\.wing--dark\{background:none\}/, "dunkle Auspraegung: navy Rundmarke neutralisiert (0dca7ce-Regression sonst)");
    assert.ok(html.includes(WING_PNG), "WING_PNG byte-identisch aus wing-image.js eingebettet");
    assert.ok(!html.includes("innerHTML"), "kein innerHTML (XSS-Gate, S1)");
    assert.doesNotMatch(html, /class="dot"/, "anonymer .dot-Indikator durch die Wing-Marke abgeloest");
    for (const unexpected of STATE_KEYFRAMES_NOT_EXPECTED) {
      assert.doesNotMatch(html, new RegExp("@keyframes\\s+" + unexpected), `${unexpected} ist hier toter Code (nur idle) - AC5`);
    }
  });
}
