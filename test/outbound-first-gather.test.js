// G2: /voice/outbound nennt Offenlegung UND Anliegen im SELBEN Erst-Turn, als EIN
// <Say> INNERHALB des <Gather> (Mikrofon sofort offen, loest den frueheren leeren-
// Erst-Gather-Deadlock, Plan-Doc #1/#4). Dieser Test war vor G2 die G0-Baseline, die
// den Deadlock (leerer Gather) festnagelte; G2 dreht ihn ins Positiv: genau EIN Say,
// dieser steht IM Gather und traegt Offenlegung (als Praefix) + Anliegen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound, GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "./_outbound-harness.js";

// seedCall-Default-Anliegen (test/helpers.js) - es muss im Erst-Turn auftauchen.
const SEED_GOAL = "Testziel";
// Der eine gesprochene Knoten ist die Offenlegung + Bruecke + Anliegen in EINEM Say.
const EXPECTED_SAY_COUNT = 1;

// C-P4: die Schleife lief ueber BEIDE Budget-Engine-Renderer ("robust ueber beide
// Renderer"). Twilio ist entfallen; die Schleifenform bleibt bewusst stehen - sie ist
// die Stelle, an der ein zweiter Carrier ohne Umbau der Testkoerper wieder eintritt.
for (const provider of ["telnyx"]) {
  test(`G2 (${provider}): Erst-Turn nennt Offenlegung + Anliegen IM <Gather> (kein Deadlock)`, async () => {
    const { body, status } = await runOutbound({ provider });
    assert.equal(status, 200);
    // Genau EIN Say (Offenlegung + Bruecke + Anliegen verschmolzen), robust ueber
    // beide Renderer (kein Festnageln an self-closing-vs-paired-Gather-Syntax).
    const sayCount = (body.match(/<Say[ >]/g) || []).length;
    assert.equal(sayCount, EXPECTED_SAY_COUNT, `genau ein Say erwartet: ${body}`);
    // Der Say steht INNERHALB des Gather: <Gather ...><Say ...>... -> gatherIdx < sayIdx.
    const gatherIdx = body.indexOf(GATHER_OPEN);
    const sayIdx = body.search(/<Say[ >]/);
    assert.ok(
      gatherIdx !== -1 && sayIdx !== -1 && gatherIdx < sayIdx,
      `Say muss IM Gather stehen: ${body}`,
    );
    // Offenlegung als Praefix VOR dem Anliegen (Regel 2: erster Satz bleibt Offenlegung).
    const discIdx = body.indexOf(DISCLOSURE_JONAS);
    const goalIdx = body.indexOf(SEED_GOAL);
    assert.ok(
      discIdx !== -1 && goalIdx !== -1,
      `Offenlegung + Anliegen muessen beide im Erst-Turn stehen: ${body}`,
    );
    assert.ok(discIdx < goalIdx, `Offenlegung muss VOR dem Anliegen stehen: ${body}`);
    // Kein Hangup: der Call bleibt offen.
    assert.ok(!body.includes(HANGUP_TAG), `kein Hangup im Erst-Turn: ${body}`);
  });
}
