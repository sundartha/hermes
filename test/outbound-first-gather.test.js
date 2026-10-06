import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound, GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "./_outbound-harness.js";

const SEED_GOAL = "Testziel";
const EXPECTED_SAY_COUNT = 1;

for (const provider of ["telnyx"]) {
  test(`G2 (${provider}): Erst-Turn nennt Offenlegung + Anliegen IM <Gather> (kein Deadlock)`, async () => {
    const { body, status } = await runOutbound({ provider });
    assert.equal(status, 200);
    const sayCount = (body.match(/<Say[ >]/g) || []).length;
    assert.equal(sayCount, EXPECTED_SAY_COUNT, `genau ein Say erwartet: ${body}`);
    const gatherIdx = body.indexOf(GATHER_OPEN);
    const sayIdx = body.search(/<Say[ >]/);
    assert.ok(
      gatherIdx !== -1 && sayIdx !== -1 && gatherIdx < sayIdx,
      `Say muss IM Gather stehen: ${body}`,
    );
    const discIdx = body.indexOf(DISCLOSURE_JONAS);
    const goalIdx = body.indexOf(SEED_GOAL);
    assert.ok(
      discIdx !== -1 && goalIdx !== -1,
      `Offenlegung + Anliegen muessen beide im Erst-Turn stehen: ${body}`,
    );
    assert.ok(discIdx < goalIdx, `Offenlegung muss VOR dem Anliegen stehen: ${body}`);
    assert.ok(!body.includes(HANGUP_TAG), `kein Hangup im Erst-Turn: ${body}`);
  });
}
