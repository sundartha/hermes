// T2-Fix (Review-Blocker G5/S2): die Wing-Marke (CSS-Keyframes + WING_PNG-Data-URI)
// darf NICHT mehr woertlich in den 5 Widget-Quelldateien liegen - sie lebt EINMAL in
// wing-markup.js (aus design-system/components/brand/wing-image.js gebaut) und wird
// von widget-catalog.js per Platzhalter-Replace beim Laden eingefuegt (withWingAssets,
// dasselbe Muster wie BIND_SCRIPT/withBindScript). Diese Tests pruefen BEIDE Seiten:
// die rohen .html-Quellen tragen nur noch die Platzhalter (kein Copy-Paste-Rueckfall),
// und das ausgelieferte widgetHtml() traegt trotzdem die vollen Assets (self-contained
// wie zuvor, siehe mcp-ui-wing-static.test.js / mcp-ui-w1-call-widget.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  widgetHtml,
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
  WIDGET_CALL,
} from "../src/ui/widget-catalog.js";
import {
  WING_CSS_STATIC,
  WING_CSS_LIVE,
  WING_MARKUP_STATIC,
  WING_MARKUP_LIVE,
} from "../src/ui/wing-markup.js";
import { WING_PNG } from "../design-system/components/brand/wing-image.js";

const STATIC_WIDGETS = [
  ["agent-status.html", WIDGET_AGENT_STATUS],
  ["my-number.html", WIDGET_MY_NUMBER],
  ["calls.html", WIDGET_CALLS],
  ["calendar.html", WIDGET_CALENDAR],
];
const ALL_WIDGETS = [...STATIC_WIDGETS, ["call.html", WIDGET_CALL]];

const widgetDir = fileURLToPath(new URL("../src/ui/widgets/", import.meta.url));
const rawSource = (file) => readFileSync(widgetDir + file, "utf8");

for (const [file] of ALL_WIDGETS) {
  test(`T-wing-dedup-source-${file}: rohe Quelle traegt nur Platzhalter, kein WING_PNG/Keyframe-Copy-Paste mehr`, () => {
    const raw = rawSource(file);
    assert.ok(raw.includes("/*__WING_CSS__*/"), "CSS-Platzhalter vorhanden");
    assert.ok(raw.includes("<!--__WING_MARKUP__-->"), "Markup-Platzhalter vorhanden");
    assert.ok(!raw.includes(WING_PNG), "WING_PNG NICHT mehr woertlich in der Quelle (nur noch injiziert)");
    assert.doesNotMatch(raw, /@keyframes\s+hermesWingDrift/, "Wing-Keyframes NICHT mehr woertlich in der Quelle");
  });
}

for (const [, id] of STATIC_WIDGETS) {
  test(`T-wing-dedup-output-static-${id}: injiziertes CSS/Markup ist exakt WING_CSS_STATIC/WING_MARKUP_STATIC`, () => {
    const html = widgetHtml(id);
    assert.ok(html.includes(WING_CSS_STATIC), "WING_CSS_STATIC vollstaendig eingefuegt");
    assert.ok(html.includes(WING_MARKUP_STATIC), "WING_MARKUP_STATIC vollstaendig eingefuegt");
  });
}

test("T-wing-dedup-output-call: injiziertes CSS/Markup ist exakt WING_CSS_LIVE/WING_MARKUP_LIVE", () => {
  const html = widgetHtml(WIDGET_CALL);
  assert.ok(html.includes(WING_CSS_LIVE), "WING_CSS_LIVE vollstaendig eingefuegt");
  assert.ok(html.includes(WING_MARKUP_LIVE), "WING_MARKUP_LIVE vollstaendig eingefuegt");
});

test("T-wing-dedup-variants: STATIC ist eine echte Teilmenge von LIVE (eine Quelle, keine zweite Kopie der Basis-Regeln)", () => {
  assert.ok(WING_CSS_LIVE.includes(".wing--idle .wing-inner{animation:hermesWingBob"), "Basis-Regeln in LIVE enthalten");
  assert.notEqual(WING_CSS_STATIC, WING_CSS_LIVE, "STATIC bleibt schlanker als LIVE (keine ungenutzten State-Keyframes)");
});
