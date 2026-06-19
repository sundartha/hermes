// Regel 2 (Absolute Regeln): Der fest verdrahtete Offenlegungssatz muss bei
// Outbound-Calls der allererste gesprochene Satz sein - AUCH wenn agentTurn
// scheitert. Genau dieser Fehlerpfad ging beim P1-Refactor (Direktiven-Renderer)
// zunaechst verloren; der Test nagelt ihn fest. P3b (call-debug.md 3.2): der
// Fehlerpfad legt nicht mehr stumm auf, sondern rendert einen Retry-<Gather> NACH
// der Offenlegung (STT scharf, Call offen) - die Offenlegung bleibt erster Knoten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

const CALL_ID = "call_test1";
// Praefix des Offenlegungssatzes (disclosureSentence, claude.js). Name = OWNER_NAME
// aus dem Test-Env ("Jonas"), da seedCall.callerName null ist.
const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas.";
const SAY_OPEN = '<Say voice="Polly.Vicki-Neural" language="de-DE">';

test("Outbound-Fehlerpfad: Offenlegung bleibt erster Satz vor dem Retry-Gather (Regel 2, T2-Fix P3b)", async () => {
  // Offline-Test-Env: agentTurn ruft Anthropic mit Fake-Key ohne Netz auf und
  // wirft -> Handler-catch. Genau der Pfad, der die Offenlegung tragen muss.
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
    assert.ok(sayIdx !== -1, `Offenlegung fehlt im Fehlerpfad-TwiML: ${twiml}`);
    assert.ok(gatherIdx !== -1, `Retry-Gather fehlt im Fehlerpfad-TwiML: ${twiml}`);
    assert.ok(sayIdx < gatherIdx, `Offenlegung muss VOR dem Retry-Gather stehen: ${twiml}`);
    // P3b: der Fehlerpfad legt nicht mehr stumm auf - kein <Hangup/>, der Call bleibt offen.
    assert.ok(!twiml.includes("<Hangup/>"), `Fehlerpfad darf nicht mehr auflegen (Retry statt Hangup): ${twiml}`);
  } finally {
    await srv.stop();
  }
});
