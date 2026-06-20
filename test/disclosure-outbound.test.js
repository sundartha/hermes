// Regel 2 (Absolute Regeln): Der fest verdrahtete Offenlegungssatz muss bei
// Outbound-Calls der allererste gesprochene Satz sein. CP4 (P3b-R,
// call-debug-p3b-r.md 3.1): /voice/outbound ist LLM-frei - die Offenlegung wird
// deterministisch ohne Anthropic-Call als erster Knoten gerendert, gefolgt von
// einem <Gather> (kein stummer Hangup, der Call bleibt offen). Genau das nagelt
// dieser Test fest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

const CALL_ID = "call_test1";
// Praefix des Offenlegungssatzes (disclosureSentence, claude.js). Name = OWNER_NAME
// aus dem Test-Env ("Jonas"), da seedCall.callerName null ist.
const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas.";
const SAY_OPEN = '<Say voice="Polly.Vicki-Neural" language="de-DE">';

test("/voice/outbound rendert Offenlegung deterministisch vor dem Gather (Regel 2, LLM-frei CP4)", async () => {
  // LLM-freier Outbound-Pfad: kein Anthropic-Call, die Offenlegung wird sofort als
  // erster Knoten gerendert. Genau der Pfad, der die Offenlegung tragen muss.
  const srv = await startServer({
    seed: seedState({ calls: [seedCall({ id: CALL_ID, status: "active", direction: "outbound" })] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(res.status, 200);

    const twiml = await res.text();
    const sayIdx = twiml.indexOf(SAY_OPEN + DISCLOSURE_PREFIX);
    const gatherIdx = twiml.indexOf("<Gather");
    assert.ok(sayIdx !== -1, `Offenlegung fehlt im Outbound-TwiML: ${twiml}`);
    assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TwiML: ${twiml}`);
    assert.ok(sayIdx < gatherIdx, `Offenlegung muss VOR dem Gather stehen: ${twiml}`);
    // CP4: kein stummer Hangup - kein <Hangup/>, der Call bleibt offen.
    assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
  } finally {
    await srv.stop();
  }
});
