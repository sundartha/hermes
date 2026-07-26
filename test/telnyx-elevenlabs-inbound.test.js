// ElevenLabs-TTS end-to-end am /voice/incoming-Pfad (Server-Spawn, json-Store):
// mit gesetzten TELNYX_ELEVENLABS_*-Envs rendert der Telnyx-Inbound das Greeting
// mit ElevenLabs-Voice + api_key_ref, die STT-Attribute (Deepgram) bleiben
// unveraendert; Twilio-Inbound bleibt ElevenLabs-frei (nur der Telnyx-Renderer
// kennt den Zweig); ohne Env bleibt der Azure-Bestand. Provider-Wahl laeuft ueber
// die Telnyx-Signatur-Header (Signaturpruefung im Test uebersprungen, die Header
// dienen nur dem Provider-Dispatch wie in provider-threading.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";

const TENANT_B = "B";
const B_NUMBER = "+4915255555555";
const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };
const EL_ENV = {
  TELNYX_ELEVENLABS_API_KEY_REF: "elevenlabs_prod",
  TELNYX_ELEVENLABS_VOICE_ID: "abc123",
};

function seedWithTelnyxNumber() {
  return seedState({
    tenants: [{ id: TENANT_B, status: "active", ownerName: "Maria" }],
    numbers: [
      {
        id: "num_b",
        e164: B_NUMBER,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        // P10: language explizit "de" - Subjekt dieses Tests ist die ElevenLabs-Stimmen-
        // Auswahl, nicht die Sprachaufloesung. Ohne den Pin faellt die Nummer (kein
        // eigenes language) auf den Weltdefault (en) durch und der Gather rendert
        // en-GB/Azure statt der deutschen Assertions unten.
        language: "de",
        providerNumberId: null,
      },
    ],
  });
}

async function inbound(srv, { telnyx, callSid }) {
  const res = await fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: telnyx ? TELNYX_HEADERS : {},
    body: new URLSearchParams({ CallSid: callSid, From: "+4915112345678", To: B_NUMBER }),
  });
  assert.equal(res.status, 200);
  return res.text();
}

test("ElevenLabs-Env gesetzt: Telnyx-Inbound spricht ElevenLabs (STT bleibt Deepgram), Twilio bleibt frei davon", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber(), env: EL_ENV });
  try {
    const telnyxXml = await inbound(srv, { telnyx: true, callSid: "CAel1" });
    assert.match(
      telnyxXml,
      /<Say voice="ElevenLabs\.Default\.abc123" api_key_ref="elevenlabs_prod">/,
      "Greeting-Say (im Gather) traegt die ElevenLabs-Plattform-Stimme",
    );
    assert.match(telnyxXml, /transcriptionEngine="Deepgram"/, "STT unveraendert Deepgram");
    assert.doesNotMatch(telnyxXml, /Azure\./, "keine gemischten Stimmen");

    const twilioXml = await inbound(srv, { telnyx: false, callSid: "CAel2" });
    assert.doesNotMatch(twilioXml, /ElevenLabs/, "Twilio-Renderer kennt den Zweig nicht");
  } finally {
    await srv.stop();
  }
});

test("Ohne ElevenLabs-Env: Telnyx-Inbound bleibt byte-identisch auf dem Azure-Bestand", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber() });
  try {
    const xml = await inbound(srv, { telnyx: true, callSid: "CAel3" });
    assert.match(xml, /voice="Azure\.de-DE-KatjaNeural"/, "Azure-Default unveraendert");
    assert.doesNotMatch(xml, /ElevenLabs/, "Gate aus -> kein ElevenLabs-Attribut");
  } finally {
    await srv.stop();
  }
});
