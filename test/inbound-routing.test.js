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

const UNKNOWN_TO = "+49999999999";

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
  const srv = await startServer();
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

test("Charakterisierung LANG-16 - Inbound-Ablehnung fuer unbekannte Zielnummer ist fest Deutsch", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: { "Accept-Language": "en-US" },
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
