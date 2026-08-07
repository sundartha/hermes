// P3c: fail-closed Inbound-To-Routing. Eine unbekannte/fehlende To wird auf KEINEN
// Tenant aufgeloest (kein Default-Tenant) -> hoeflicher Hangup + Audit, KEIN
// Call-Record. Nur die geseedete Owner-Store-Nummer (OWNER_TEST_NUMBER) routet. Die
// Provider-Signatur wird VOR To geprueft (Anti-Spoof) - eine gespoofte To ohne
// gueltige Signatur erreicht das Routing nie (403). Build-Operate-Check je Konzept.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  waitForLog,
  OWNER_TEST_NUMBER,
  seedState,
  TELNYX_TEST_SIGNATURE_HEADERS,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const UNKNOWN_TO = "+49999999999"; // nicht geseedet -> nicht routbar

// F1 P4: aktive Nummern mit Geo-Anker (language) fuer das Inbound-Wiring. Alle gehoeren
// dem Owner-Tenant (Single-Tenant). ensureOwnerNumber ergaenzt zusaetzlich die DE-Owner-
// Nummer (Boot-Guard); die FR/EN-Nummern testen, dass call.language aus number.language faellt.
const FR_NUMBER = "+33111000222";
const EN_NUMBER = "+44111000333";
function geoSeed(extraSettings = {}) {
  return seedState({
    settings: extraSettings,
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
    numbers: [
      {
        id: "num_owner_de",
        e164: OWNER_TEST_NUMBER.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        country: "DE",
        language: "de",
      },
      {
        id: "num_fr",
        e164: FR_NUMBER,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        country: "FR",
        language: "fr",
      },
      {
        id: "num_en",
        e164: EN_NUMBER,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        country: "GB",
        language: "en",
      },
    ],
  });
}

test("unbekannte To -> fail-closed Hangup + Audit, kein Stream, kein Call-Record", async () => {
  const srv = await startServer({ env: { VOICE_ENGINE: "realtime" } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: UNKNOWN_TO }),
    });
    assert.equal(res.status, 200);
    const twiml = await res.text();
    assert.match(twiml, /<Hangup/, "nicht-routbare Nummer wird hoeflich aufgelegt");
    assert.ok(!twiml.includes('name="stream_token"'), "kein Realtime-Stream fuer unbekannte To");
    await waitForLog(srv, /\[audit\] inbound_unrouted/);
    assert.equal(srv.readStore().calls.length, 0, "kein Geist-Call fuer unbekannte To");
  } finally {
    await srv.stop();
  }
});

// Charakterisierung LANG-16 (tasks/i18n-tests/01-sprachaufloesung.md): der Unrouted-
// Hangup spricht FEST Deutsch - ohne Tenant gibt es keinen Sprach-Anker, der Satz haengt
// an keinem Locale-Bundle (src/routes/voice.js, sayD(...) im numberRecord-null-Zweig).
// Als CHARAKTERISIERUNG gekennzeichnet: der Ist-Zustand wird dokumentiert, nicht als
// Sollzustand erklaert - fuer einen weltweiten Start ist ein deutscher Satz an eine
// unbekannte Nummer der falsche Default. Der Satz ist der EINZIGE Pin dieses Tests.
test("Charakterisierung LANG-16 - Inbound-Ablehnung fuer unbekannte Zielnummer ist fest Deutsch", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: { "Accept-Language": "en-US" }, // kein Header-Signal beeinflusst den Satz
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: UNKNOWN_TO }),
    });
    assert.equal(res.status, 200);
    const twiml = await res.text();
    assert.match(twiml, /Diese Nummer ist nicht erreichbar\. Auf Wiederhören\./);
    assert.match(twiml, /<Hangup/);
    assert.equal(srv.readStore().calls.length, 0, "kein Call-Record fuer unbekannte To");
  } finally {
    await srv.stop();
  }
});

test("fehlende To -> fail-closed Hangup + Audit, kein Call-Record", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678" }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<Hangup/);
    await waitForLog(srv, /\[audit\] inbound_unrouted/);
    assert.equal(srv.readStore().calls.length, 0);
  } finally {
    await srv.stop();
  }
});

test("bekannte Owner-To -> normaler Greeting + Call-Record", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAtest",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<Gather/, "Owner-Nummer fuehrt in den Gespraechs-Turn");
    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1, "genau ein Call-Record fuer die Owner-Nummer");
    assert.equal(calls[0].to, OWNER_TEST_NUMBER.e164);
  } finally {
    await srv.stop();
  }
});

// ---- F1 P4: Inbound-Wiring (Nummer -> Sprache) ----

// C-P3: der Gegenstand dieser Tests ist die SPRACHWAHL (de/fr/en), nicht der Carrier.
// Der Twilio-Inbound-Pfad existiert nicht mehr, die Faelle ziehen deshalb geschlossen
// auf den Telnyx-Pfad um - die Sprach-Zusicherung bleibt woertlich erhalten, nur die
// Stimmen-Tabelle wechselt (Polly -> Azure). Das language-Attribut kommt fuer beide
// Renderer aus DERSELBEN Quelle (voice-locale.js) und aendert sich nicht.
async function postIncoming(srv, to) {
  const res = await fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: to }),
  });
  assert.equal(res.status, 200);
  return { twiml: await res.text(), call: srv.readStore().calls[0] };
}

test("DE-Nummer -> call.language=de + DE-Voice (Azure.de-DE-Katja/de-DE)", async () => {
  const srv = await startServer({ seed: geoSeed() });
  try {
    const { twiml, call } = await postIncoming(srv, OWNER_TEST_NUMBER.e164);
    assert.equal(call.language, "de");
    assert.match(twiml, /language="de-DE"/, "DE-STT-Locale");
    assert.match(twiml, /voice="Azure\.de-DE-KatjaNeural"/, "DE-Voice");
  } finally {
    await srv.stop();
  }
});

test("FR-Nummer -> call.language=fr + FR-Voice (Azure.fr-FR-Denise/fr-FR)", async () => {
  const srv = await startServer({ seed: geoSeed() });
  try {
    const { twiml, call } = await postIncoming(srv, FR_NUMBER);
    assert.equal(call.language, "fr", "Inbound-Sprache aus number.language (FR)");
    assert.match(twiml, /language="fr-FR"/, "FR-STT-Locale");
    assert.match(twiml, /voice="Azure\.fr-FR-DeniseNeural"/, "FR-Voice");
  } finally {
    await srv.stop();
  }
});

test("EN-Nummer -> call.language=en + EN-Voice (Azure.en-GB-Sonia/en-GB)", async () => {
  const srv = await startServer({ seed: geoSeed() });
  try {
    const { twiml, call } = await postIncoming(srv, EN_NUMBER);
    assert.equal(call.language, "en", "Inbound-Sprache aus number.language (EN)");
    assert.match(twiml, /language="en-GB"/, "EN-STT-Locale");
    assert.match(twiml, /voice="Azure\.en-GB-SoniaNeural"/, "EN-Voice");
  } finally {
    await srv.stop();
  }
});

test("Praezedenz #8: settings.language-Override schlaegt number.language (FR-Nummer, Override en -> call.language=en)", async () => {
  const srv = await startServer({ seed: geoSeed({ language: "en" }) });
  try {
    const { twiml, call } = await postIncoming(srv, FR_NUMBER);
    assert.equal(
      call.language,
      "en",
      "Owner-Override (settings.language=en) schlaegt die FR-Nummer",
    );
    assert.match(twiml, /language="en-GB"/, "Voice folgt dem Override");
  } finally {
    await srv.stop();
  }
});

test("Anti-Spoof: gespoofte To ohne gueltige Signatur -> 403, kein Routing/Call-Record", async () => {
  // Signaturpruefung aktiv: das Routing (To-Lese) liegt HINTER der Signatur.
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: UNKNOWN_TO }),
    });
    assert.equal(res.status, 403, "ohne gueltige Signatur kein Zugriff aufs Routing");
    assert.equal(srv.readStore().calls.length, 0);
  } finally {
    await srv.stop();
  }
});
