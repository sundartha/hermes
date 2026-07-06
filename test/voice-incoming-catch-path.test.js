// Fix2 (Review-Nachtrag zu Play-TTS-ElevenLabs, S1-1): der try/catch-Fallback von
// /voice/incoming (server.js) war bislang nur strukturell verifiziert - kein Test durchlief
// den catch-Zweig wirklich. Dieser Test erzwingt einen ECHTEN Fehler NACH der Call-Erzeugung:
// ctx.settings.greeting ist null (roh in store.json geseedet, an updateSettings vorbei - die
// API liesse ein null-Greeting nie durch, das typeof-Gate in state-ops.updateSettings prueft
// gegen den String-Default) -> greeting.replaceAll(...) wirft eine echte TypeError -> der
// catch greift.
//
// Die geseedete Nummer traegt zusaetzlich language="fr" (nicht der DE-Default): NUR wenn der
// catch wirklich call.language liest (statt des call-losen localeFor(undefined)-de-Fallbacks
// vor der Call-Erzeugung), landet die FRANZOESISCHE turnErrorSpeech im Ergebnis. Das beweist,
// dass die Exception NACH store.createCall() ausgeloest wurde - genau der Pfad, den die
// Reviewer als ungetestet markierten. Ohne das try/catch (Runde fix1) wuerde der async
// Handler rejecten -> keine Antwort -> dieser fetch() haenge bis zum Timeout (rot).
//
// Provider=Telnyx (Signatur-Header dienen nur dem Provider-Dispatch, SKIP_TWILIO_SIGNATURE_
// CHECK aus BASE_ENV ueberspringt die eigentliche Pruefung, wie in provider-threading.test.js).
// ELEVENLABS_PLAY_TTS_ENABLED bleibt AUS (BASE_ENV-Default) -> Azure-Bestandsstimme, kein
// ElevenLabs-Netz noetig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { LOCALES } from "../src/i18n/locales.js";

const TELNYX_NR = "+13125550100";
const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };

// Owner-Nummer mit explizitem language="fr" (Beweis-Hebel oben) + kaputtem Greeting
// (null statt String - state-ops.updateSettings liesse das nie durch, hier direkt am
// Store-Boot vorbei geseedet, wie eine reale Datenkorruption/ein Migrations-Rest).
function seedBrokenGreetingFr() {
  return seedState({
    settings: { greeting: null },
    numbers: [
      {
        id: "num_owner_fr",
        e164: TELNYX_NR,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        language: "fr",
      },
    ],
  });
}

test("/voice/incoming: kaputtes Greeting nach Call-Erzeugung -> catch rendert Say(turnErrorSpeech)+Hangup statt Gruss/Gather", async () => {
  const srv = await startServer({ seed: seedBrokenGreetingFr() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: TELNYX_HEADERS,
      body: new URLSearchParams({ CallSid: "CAcatch1", From: "+4915112345678", To: TELNYX_NR }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();

    assert.ok(
      body.includes(LOCALES.fr.turnErrorSpeech),
      `FR-turnErrorSpeech fehlt - das beweist, dass der catch call.language=fr gelesen hat: ${body}`,
    );
    assert.match(
      body,
      /<Say voice="Azure\.fr-FR-DeniseNeural" language="fr-FR">/,
      "Azure-Bestandsstimme (Play-TTS-Flag bleibt aus)",
    );
    assert.match(body, /<Hangup\/>/, "gracefuler Hangup statt haengendem Call");
    assert.doesNotMatch(
      body,
      /<Gather/,
      "kein Erfolgs-Turn - NUR der catch rendert Say+Hangup ohne Gather",
    );
    assert.doesNotMatch(body, /helfen/, "kein Gruss-Rest (Erfolgspfad-Greeting) im Fehler-Body");

    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1, "der Call wurde VOR dem Fehler angelegt (createCall lief durch)");
    assert.equal(
      calls[0].language,
      "fr",
      "call.language kam aus der Nummer - Beleg fuer den call-abhaengigen catch-Zweig",
    );
    assert.match(
      srv.stdout,
      /\[incoming\][^\n]*replaceAll/,
      "Server-Log bestaetigt die erzwungene TypeError (replaceAll auf null-Greeting)",
    );
  } finally {
    await srv.stop();
  }
});
