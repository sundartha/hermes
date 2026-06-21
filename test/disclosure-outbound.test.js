// Regel 2 (Absolute Regeln): Der fest verdrahtete Offenlegungssatz muss bei
// Outbound-Calls der allererste gesprochene Satz sein. G2: /voice/outbound ist LLM-frei
// - die Offenlegung wird deterministisch ohne Anthropic-Call als Praefix des EINEN Say
// INNERHALB des <Gather> gerendert (Erst-Turn nennt Offenlegung + Anliegen, Mikrofon
// sofort offen, kein stummer Hangup). Der Say beginnt genau mit der Offenlegung -> sie
// bleibt der erste gesprochene Satz. Genau das nagelt dieser Test fest. Spawn/POST
// laeuft ueber test/_outbound-harness.js (G0); das provider-spezifische
// <Say voice=...>-Markup (SAY_OPEN) bleibt hier lokal (G6/G13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound } from "./_outbound-harness.js";

// Praefix des Offenlegungssatzes (disclosureSentence, claude.js). G1: Name = voller
// tenant.ownerName, config-derived geseedet (Variante a) = "OWNER_FIRST_NAME
// OWNER_LAST_NAME" ("Jonas Beispiel" im Test-Env). callerName entfaellt komplett.
const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
const SAY_OPEN = '<Say voice="Polly.Vicki-Neural" language="de-DE">';

test("/voice/outbound rendert Offenlegung als Say-Praefix im Gather (Regel 2, LLM-frei G2)", async () => {
  // LLM-freier Outbound-Pfad (Twilio): kein Anthropic-Call, die Offenlegung beginnt
  // den einen Say IM Gather. Genau der Pfad, der die Offenlegung tragen muss.
  const { body: twiml, status } = await runOutbound({ provider: "twilio" });
  assert.equal(status, 200);

  // Der Say oeffnet exakt mit der Offenlegung -> sie bleibt der erste gesprochene Satz.
  const sayIdx = twiml.indexOf(SAY_OPEN + DISCLOSURE_PREFIX);
  const gatherIdx = twiml.indexOf("<Gather");
  assert.ok(sayIdx !== -1, `Offenlegung als Say-Praefix fehlt im Outbound-TwiML: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TwiML: ${twiml}`);
  // G2: der Say steht INNERHALB des Gather -> Gather oeffnet vor dem Say.
  assert.ok(gatherIdx < sayIdx, `Offenlegungs-Say muss IM Gather stehen: ${twiml}`);
  // Kein stummer Hangup - kein <Hangup/>, der Call bleibt offen.
  assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
});
