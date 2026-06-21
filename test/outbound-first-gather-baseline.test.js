// G0-Baseline: dokumentiert den HEUTIGEN Erst-Turn-Deadlock (Plan-Doc #1/#4) offline
// und deterministisch. /voice/outbound legt die Offenlegung, dann einen LEEREN
// <Gather/> (kein Anliegen im selben Turn). G2 dreht diesen Test ins Positiv
// (Anliegen-<Say> INNERHALB des Gather). Bis dahin ist genau DAS der Ist-Zustand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound, GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "./_outbound-harness.js";

// Erst-Turn nennt heute genau EIN gesprochenes <Say> (die Offenlegung); G2 -> 2.
const EXPECTED_SAY_COUNT = 1;

for (const provider of ["twilio", "telnyx"]) {
  test(`G0-Baseline (${provider}): Erst-Gather ist LEER (kein Anliegen-Say) = heutiger Deadlock`, async () => {
    const { body, status } = await runOutbound({ provider });
    assert.equal(status, 200);
    // Offenlegung vorhanden und VOR dem Gather (Regel 2, unveraendert).
    const discIdx = body.indexOf(DISCLOSURE_JONAS);
    const gatherIdx = body.indexOf(GATHER_OPEN);
    assert.ok(discIdx !== -1 && gatherIdx !== -1 && discIdx < gatherIdx, body);
    // DEADLOCK-PIN: genau EIN <Say> (die Offenlegung) - der Erst-Turn nennt KEIN
    // Anliegen, weder im noch nach dem Gather. Robust ueber beide Renderer (kein
    // Festnageln an self-closing-vs-paired-Gather-Syntax). G2 aendert dies auf 2.
    const sayCount = (body.match(/<Say[ >]/g) || []).length;
    assert.equal(sayCount, EXPECTED_SAY_COUNT, `Erst-Turn nennt heute KEIN Anliegen (genau 1 Say = Offenlegung): ${body}`);
    assert.ok(!body.includes(HANGUP_TAG), `kein Hangup im Erst-Turn: ${body}`);
  });
}
