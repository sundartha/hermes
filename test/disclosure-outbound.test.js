import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound } from "./_outbound-harness.js";

const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
const SAY_OPEN = '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">';

test("/voice/outbound rendert Offenlegung als Say-Praefix im Gather (Regel 2, LLM-frei G2)", async () => {
  const { body: twiml, status } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, 200);

  const sayIdx = twiml.indexOf(SAY_OPEN + DISCLOSURE_PREFIX);
  const gatherIdx = twiml.indexOf("<Gather");
  assert.ok(sayIdx !== -1, `Offenlegung als Say-Praefix fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx < sayIdx, `Offenlegungs-Say muss IM Gather stehen: ${twiml}`);
  assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
});

const EN_DISCLOSURE_PREFIX =
  "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.";
const EN_SAY_OPEN = '<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">';

test("LAW-03 (gruen, Wiring-Regressionspin): /voice/outbound rendert die EN-Offenlegung als Say-Praefix im Gather", async () => {
  const { body: twiml, status } = await runOutbound({
    provider: "telnyx",
    call: { language: "en" },
  });
  assert.equal(status, 200);

  const sayIdx = twiml.indexOf(EN_SAY_OPEN + EN_DISCLOSURE_PREFIX);
  const gatherIdx = twiml.indexOf("<Gather");
  assert.ok(sayIdx !== -1, `EN-Offenlegung als Say-Praefix fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx < sayIdx, `EN-Offenlegungs-Say muss IM Gather stehen: ${twiml}`);
  assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
});
