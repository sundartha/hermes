// IP3-RIEGEL, end-to-end (Server-Spawn, json-Store): TELNYX_ELEVENLABS_*-Envs erreichen
// den Telnyx-Inbound-Pfad nicht mehr - der TeXML-<Say>-Relay-Zweig ist entfernt
// (A/B-belegt defekt, Begruendung im Modulkopf von adapters/telnyx/render.js). Vor IP3
// war GENAU dieser End-to-End-Pfad die Selbstarmierung: zwei gesetzte Envs, ohne Flag,
// ohne Logzeile, schalteten den kompletten Inbound-Gruss auf den Relay um. Diese Datei
// bewies das vorher am gerenderten TeXML - sie beweist jetzt das Gegenteil: dieselben
// zwei Envs, gesetzt am echten Serverprozess, aendern das TeXML NICHT. Provider-Wahl
// laeuft ueber die Telnyx-Signatur-Header (Signaturpruefung im Test uebersprungen, die
// Header dienen nur dem Provider-Dispatch wie in provider-threading.test.js).
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
        // P10: language explizit "de" - Subjekt dieses Tests ist die Inertheit der
        // ElevenLabs-Envs, nicht die Sprachaufloesung. Ohne den Pin faellt die Nummer
        // (kein eigenes language) auf den Weltdefault (en) durch.
        language: "de",
        providerNumberId: null,
      },
    ],
  });
}

async function inbound(srv, { callSid }) {
  const res = await fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: TELNYX_HEADERS,
    body: new URLSearchParams({ CallSid: callSid, From: "+4915112345678", To: B_NUMBER }),
  });
  assert.equal(res.status, 200);
  return res.text();
}

test("Selbstarmierung weg end-to-end: TELNYX_ELEVENLABS_*-Envs gesetzt, Telnyx-Inbound rendert TROTZDEM Azure", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber(), env: EL_ENV });
  try {
    const telnyxXml = await inbound(srv, { callSid: "CAel1" });
    assert.match(telnyxXml, /voice="Azure\.de-DE-KatjaNeural"/, "Azure-Default unveraendert trotz gesetzter Envs");
    assert.match(telnyxXml, /transcriptionEngine="Deepgram"/, "STT unveraendert Deepgram");
    assert.doesNotMatch(telnyxXml, /ElevenLabs/, "kein ElevenLabs-Attribut, kein Relay");
    assert.doesNotMatch(telnyxXml, /api_key_ref/, "kein api_key_ref am <Say>");
  } finally {
    await srv.stop();
  }
});

test("Ohne ElevenLabs-Env: Telnyx-Inbound bleibt byte-identisch auf dem Azure-Bestand", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber() });
  try {
    const xml = await inbound(srv, { callSid: "CAel3" });
    assert.match(xml, /voice="Azure\.de-DE-KatjaNeural"/, "Azure-Default unveraendert");
    assert.doesNotMatch(xml, /ElevenLabs/, "Gate aus -> kein ElevenLabs-Attribut");
  } finally {
    await srv.stop();
  }
});
