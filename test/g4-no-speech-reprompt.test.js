// G4: Der No-Speech-Reprompt im /voice/turn ist knapp (eine Rueckfrage) und ein
// gueltiger Folge-Turn (Say + Gather, KEIN Hangup) - der Call laeuft weiter. Offline-
// Spawn; ein Provider reicht fuer das Konzept (der Reprompt ist provider-neutral, nur
// die Say-Huelle ist provider-spezifisch - hier Telnyx, analog zu g3-speech-timeout).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

test("G4: leerer Gather nach bereits-gesprochenem Caller -> knappe Rueckfrage, kein Hangup", async () => {
  const id = "call_g4";
  const srv = await startServer({
    seed: seedState({
      calls: [seedCall({
        id,
        provider: "telnyx",
        status: "active",
        direction: "outbound",
        // Caller hat schon gesprochen -> der leere Gather trifft den No-Speech-Zweig.
        transcript: [{ role: "caller", text: "..." }],
      })],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "" }), // leer -> kein heard
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /<Say[^>]*>Entschuldigung, koennen Sie das bitte wiederholen\?<\/Say>/);
    assert.match(body, /<Gather/); // Folge-Gather -> Call laeuft weiter
    assert.doesNotMatch(body, /<Hangup/); // KEIN Auflegen
  } finally {
    await srv.stop();
  }
});
