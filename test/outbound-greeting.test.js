import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runOutbound,
  HANGUP_TAG as HANGUP,
  assertDisclosureInGather,
} from "./_outbound-harness.js";

for (const provider of ["telnyx"]) {
  test(`/voice/outbound (${provider}): LLM-frei -> Offenlegung im <Gather>, kein <Hangup> (G2)`, async () => {
    const { body, status, contentType } = await runOutbound({ provider });
    assert.equal(status, 200);
    assert.ok(contentType?.includes("text/xml"), `Antwort ist kein XML: ${contentType}`);
    assertDisclosureInGather(body);
    assert.ok(!body.includes(HANGUP), `/voice/outbound darf nicht auflegen: ${body}`);
  });
}
