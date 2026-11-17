import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { seedCall } from "../helpers.js";

const FREMD = "s4730_fremd";

async function statusEreignis(anbinden) {
  const aufrufe = [];
  const angenommen = [];
  const call = seedCall({ id: FREMD, twilioSid: `CA_${FREMD}`, status: "active", provider: "telnyx" });
  const store = {
    getCall: (id) => (id === FREMD || id === call.twilioSid ? call : null),
    anrufHierBewacht: () => false,
    save: () => {},
    markAnswered: async (id) => {
      angenommen.push(id);
    },
    recordWebhookAnchors: () => {},
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({ skipTwilioSignatureCheck: true, machineDetection: { enabled: false, timeoutS: 25 } }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_c, d) => d },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {
        reattachActiveCall: async (id) => {
          aufrufe.push(id);
          return anbinden();
        },
      },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
    }),
  );
  const fehler = [];
  const original = console.error;
  console.error = (...a) => fehler.push(a.join(" "));
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/status?callId=${FREMD}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "in-progress" }).toString(),
    });
    await antwort.text();
    await new Promise((r) => setImmediate(r));
  } finally {
    console.error = original;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  return { aufrufe, fehler, angenommen };
}

test("Status mit Spiegeltreffer: genau ein Aufruf der Wiederanbindung, kein Verwerfen im Log", async () => {
  const { aufrufe, fehler, angenommen } = await statusEreignis(async () => ({ call: null, fehlgeschlagen: true }));
  assert.deepEqual(aufrufe, [FREMD]);
  assert.deepEqual(angenommen, [FREMD]);
  assert.deepEqual(fehler, []);
});

test("Status mit Spiegeltreffer: abgelehnte Wiederanbindung wird mit Praefix und callId protokolliert", async () => {
  const { aufrufe, fehler, angenommen } = await statusEreignis(() => Promise.reject(new Error("Datenbank haengt")));
  assert.deepEqual(aufrufe, [FREMD]);
  assert.deepEqual(angenommen, [FREMD]);
  assert.deepEqual(fehler, [`[voice/status] Wiederanbindung abgelehnt (callId=${FREMD}): Datenbank haengt`]);
});
