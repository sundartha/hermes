// P1: Dashboard-Brand-Cutover als deterministischer Inhalts-Check (kein Pixel-Test).
// Die reine Optik bleibt manueller Smoke (Dashboard-Optik = dokumentierte Smoke-
// Ausnahme); die INHALTS-Invarianten (kein Vodafone-Rot/-Token, entfernte Feature-
// Cards weg, Sundartha-Brand-Marker da) sind hier offline + reproduzierbar gepinnt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

test("P1 tenant.html: Sundartha-Brand statt Vodafone, vereinfachte Cards", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/tenant.html`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // Brand-Cutover: Space Grotesk + HERMES-Wortmarke da; Vodafone-Rot/-Token + Inter weg.
    assert.match(html, /family=Space\+Grotesk/);
    assert.match(html, /HERMES/);
    assert.match(html, /by Sundartha/);
    assert.doesNotMatch(html, /#e60000/);
    assert.doesNotMatch(html, /--vf-/);
    assert.doesNotMatch(html, /family=Inter/);

    // Vereinfachung: entfernte Feature-Cards nicht mehr im Markup.
    assert.doesNotMatch(html, /Action Items/);
    assert.doesNotMatch(html, /Kalender/);
    assert.doesNotMatch(html, /Begruessung/);

    // Behalten (nicht gebrochen): Agent-Rufnummer + Anrufe + Zugang + Billing-Block.
    assert.match(html, /Agent-Rufnummer/);
    assert.match(html, /Anrufe/);
    assert.match(html, /id="calls"/);
    assert.match(html, /id="billingCard"/);
  } finally {
    await srv.stop();
  }
});
