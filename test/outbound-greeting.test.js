// CP4 (P3b-R): /voice/outbound ist LLM-FREI. Statt
// agentTurn synchron im Webhook zu rufen, rendert der Pfad sofort, deterministisch
// und ohne Anthropic-Call die Pflicht-Offenlegung + ein <Gather> (Vorbild Inbound).
// Damit kollabieren die frueheren drei Faelle (normaler Turn / endCall / agentTurn
// wirft): das Outbound-Markup haengt nicht mehr am LLM und ist mock-unabhaengig.
// Dieser Test pinnt fuer BEIDE Provider (Twilio + Telnyx): Offenlegung als Say
// INNERHALB des <Gather> (G2: Erst-Turn nennt Offenlegung + Anliegen, Mikrofon sofort
// offen), kein <Hangup> (der Call bleibt offen). Es findet KEIN LLM-Call statt -> kein
// Anthropic-Mock noetig. Spawn/POST + Marker leben in test/_outbound-harness.js (G0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound, GATHER_OPEN as GATHER, HANGUP_TAG as HANGUP, DISCLOSURE_JONAS } from "./_outbound-harness.js";

for (const provider of ["twilio", "telnyx"]) {
  test(`/voice/outbound (${provider}): LLM-frei -> Offenlegung im <Gather>, kein <Hangup> (G2)`, async () => {
    const { body, status, contentType } = await runOutbound({ provider });
    assert.equal(status, 200);
    // Der Pfad pinnt Provider-Markup -> die Antwort muss auch wirklich XML sein.
    assert.ok(contentType?.includes("text/xml"), `Antwort ist kein XML: ${contentType}`);
    // Offenlegung steht im Erst-Turn und INNERHALB des Gather (gatherIdx < discIdx).
    const gatherIdx = body.indexOf(GATHER);
    const discIdx = body.indexOf(DISCLOSURE_JONAS);
    assert.ok(gatherIdx !== -1 && discIdx !== -1 && gatherIdx < discIdx, `Offenlegung muss im Gather stehen: ${body}`);
    // Kein Hangup: der Call bleibt offen, der <Gather action>-POST faehrt den Turn.
    assert.ok(!body.includes(HANGUP), `/voice/outbound darf nicht auflegen: ${body}`);
  });
}
