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
// tenant.ownerName. P2b: vom Harness in den Store geseedet (ensureOwnerNumber) =
// "Jonas Beispiel". callerName entfaellt komplett.
const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
// C-P4: die Stimme ist die des verbliebenen Renderers (Azure/TeXML). Vorher stand hier
// Twilios Polly-Markup - der GEGENSTAND (Offenlegung ist der erste gesprochene Satz)
// ist davon unberuehrt, nur der Traeger hat gewechselt.
const SAY_OPEN = '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">';

test("/voice/outbound rendert Offenlegung als Say-Praefix im Gather (Regel 2, LLM-frei G2)", async () => {
  // LLM-freier Outbound-Pfad: kein Anthropic-Call, die Offenlegung beginnt
  // den einen Say IM Gather. Genau der Pfad, der die Offenlegung tragen muss.
  const { body: twiml, status } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, 200);

  // Der Say oeffnet exakt mit der Offenlegung -> sie bleibt der erste gesprochene Satz.
  const sayIdx = twiml.indexOf(SAY_OPEN + DISCLOSURE_PREFIX);
  const gatherIdx = twiml.indexOf("<Gather");
  assert.ok(sayIdx !== -1, `Offenlegung als Say-Praefix fehlt im Outbound-TeXML: ${twiml}`);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Outbound-TeXML: ${twiml}`);
  // G2: der Say steht INNERHALB des Gather -> Gather oeffnet vor dem Say.
  assert.ok(gatherIdx < sayIdx, `Offenlegungs-Say muss IM Gather stehen: ${twiml}`);
  // Kein stummer Hangup - kein <Hangup/>, der Call bleibt offen.
  assert.ok(!twiml.includes("<Hangup/>"), `/voice/outbound darf nicht auflegen: ${twiml}`);
});

// LAW-03 (tasks/i18n-tests/09-recht-und-compliance.md): derselbe Wiring-Pfad fuer einen
// EN-Call (call.language="en") - GRUEN erwartet (Regressionspin): das EN-Render-Voice-
// Attribut UND der kuratierte EN-Disclosure-Wortlaut (LOCALES.en.disclosure) muessen
// genauso als Say-Praefix im Gather ankommen wie der DE-Fall oben.
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
