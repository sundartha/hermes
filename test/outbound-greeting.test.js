// CP4 (P3b-R): /voice/outbound ist LLM-FREI. Statt
// agentTurn synchron im Webhook zu rufen, rendert der Pfad sofort, deterministisch
// und ohne Anthropic-Call die Pflicht-Offenlegung + ein <Gather> (Vorbild Inbound).
// Damit kollabieren die frueheren drei Faelle (normaler Turn / endCall / agentTurn
// wirft): das Outbound-Markup haengt nicht mehr am LLM und ist mock-unabhaengig.
// Dieser Test pinnt fuer BEIDE Provider (Twilio + Telnyx): Offenlegung VOR <Gather>,
// kein <Hangup> (der Call bleibt offen), kein Agent-Speech (das Anliegen nennt der
// Agent erst im ersten /voice/turn). Es findet KEIN LLM-Call statt -> kein
// Anthropic-Mock noetig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

const CALL_ID = "call_outbound1";
// Praefix des fest verdrahteten Offenlegungssatzes (disclosureSentence, claude.js):
// callerName ist null -> ownerName = OWNER_NAME aus dem Test-Env ("Jonas"). Der Satz
// enthaelt keine XML-Sonderzeichen, steht also in TwiML wie TeXML wortgleich im Body.
const DISCLOSURE = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas.";
// Beide Renderer oeffnen den Sprach-Turn mit "<Gather" (Twilio-TwiML + Telnyx-TeXML).
const GATHER = "<Gather";
const HANGUP = "<Hangup";

// Faehrt /voice/outbound lokal und liefert den gerenderten Provider-Body
// (TwiML/TeXML). Kein Anthropic-Mock: der Pfad ist LLM-frei. Server wird immer
// geschlossen.
async function outboundBody(provider) {
  const srv = await startServer({
    seed: seedState({
      calls: [seedCall({ id: CALL_ID, provider, status: "active", direction: "outbound" })],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(res.status, 200);
    // Der Pfad pinnt Provider-Markup -> die Antwort muss auch wirklich XML sein.
    assert.ok(res.headers.get("content-type")?.includes("text/xml"), `Antwort ist kein XML: ${res.headers.get("content-type")}`);
    return await res.text();
  } finally {
    await srv.stop();
  }
}

// Disclosure muss als erster gesprochener Satz VOR dem Folge-Knoten stehen (Regel 2).
function assertDisclosureBefore(body, marker) {
  const discIdx = body.indexOf(DISCLOSURE);
  const markerIdx = body.indexOf(marker);
  assert.ok(discIdx !== -1, `Offenlegung fehlt im Body: ${body}`);
  assert.ok(markerIdx !== -1, `Marker '${marker}' fehlt im Body: ${body}`);
  assert.ok(discIdx < markerIdx, `Offenlegung muss VOR '${marker}' stehen: ${body}`);
}

for (const provider of ["twilio", "telnyx"]) {
  test(`/voice/outbound (${provider}): LLM-frei -> Offenlegung + <Gather>, kein <Hangup> (CP4)`, async () => {
    const body = await outboundBody(provider);
    // Offenlegung als erster Knoten, dann <Gather> ohne inneren Say (leerer Prompt).
    assertDisclosureBefore(body, GATHER);
    // Kein Hangup: der Call bleibt offen, der <Gather action>-POST faehrt den Turn.
    assert.ok(!body.includes(HANGUP), `/voice/outbound darf nicht auflegen: ${body}`);
  });
}
