import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

async function statusOhneKennung() {
  const aufrufe = [];
  const store = {
    getCall: () => null,
    anrufHierBewacht: () => false,
    save: () => {},
    markAnswered: async () => {},
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
          return { call: null };
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
  app.set("env", "development");
  const fehler = [];
  const original = console.error;
  console.error = (...a) => fehler.push(a.join(" "));
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  let status;
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/status`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "completed" }).toString(),
    });
    status = antwort.status;
    await antwort.text();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  } finally {
    console.error = original;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  return { aufrufe, fehler, status };
}

test("Status ohne Kennung und ohne bekannten Anruf: 200, keine Wiederanbindung, kein Fehler", async () => {
  const { aufrufe, fehler, status } = await statusOhneKennung();
  assert.equal(status, 200);
  assert.deepEqual(aufrufe, []);
  assert.deepEqual(fehler, []);
});
