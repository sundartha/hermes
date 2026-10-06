import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { LOCALES } from "../src/i18n/locales.js";

const TELNYX_NR = "+13125550100";
const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };

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
