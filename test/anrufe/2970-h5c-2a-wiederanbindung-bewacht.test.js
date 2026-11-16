import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeVoiceRoutes } from "../../src/routes/voice.js";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { seedCall } from "../helpers.js";

const BEWACHT = "h5c2a_hier";
const FREMD = "h5c2a_instanz_b";

function routenMitMenge(bewachte, protokoll) {
  const anrufe = new Map(
    [BEWACHT, FREMD].map((id) => [id, seedCall({ id, twilioSid: `CA_${id}`, status: "active", provider: "telnyx" })]),
  );
  const store = {
    getCall: (id) => anrufe.get(id) || [...anrufe.values()].find((anruf) => anruf.twilioSid === id) || null,
    anrufHierBewacht: (id) => bewachte.has(id),
    save: () => {},
    addTranscript: async () => {},
    markAnswered: async (id) => protokoll.angenommen.push(id),
    recordWebhookAnchors: () => {},
    countNoSpeechTurn: () => 1,
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({ skipTwilioSignatureCheck: true, machineDetection: { enabled: false, timeoutS: 25 } }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {
        reattachActiveCall: async (callId) => {
          protokoll.wiederaufnahmen.push(callId);
          return { call: null, logUnknown: false };
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
  return app;
}

async function mitServer(app, fn) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const post = async (pfad, felder = {}) => {
      const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(felder).toString(),
      });
      await antwort.text();
      return antwort;
    };
    await fn(post);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const ROUTEN = [
  ["/voice/turn", {}],
  ["/voice/outbound", {}],
  ["/voice/status", { CallStatus: "in-progress" }],
  ["/voice/el-rueckfall", {}],
];

for (const [pfad, felder] of ROUTEN) {
  test(`Wiederanbindung ${pfad}: Spiegeltreffer ohne Eintrag in der Menge loest Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
      await post(`${pfad}?callId=${FREMD}`, felder);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
  });

  test(`Wiederanbindung ${pfad}: Anruf in der Menge loest keine zweite Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
      await post(`${pfad}?callId=${BEWACHT}`, felder);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, []);
  });
}

test("Wiederanbindung /voice/status: Treffer ueber die Anruf-Kennung des Anbieters ohne Menge-Eintrag nimmt mit der Anfrage-Kennung wieder auf", async () => {
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  await mitServer(routenMitMenge(new Set(), protokoll), async (post) => {
    await post(`/voice/status`, { CallSid: `CA_${FREMD}`, CallStatus: "in-progress" });
  });
  assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
});

test("Wiederanbindung /voice/status: bewachter Anruf wird angenommen markiert", async () => {
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
    await post(`/voice/status?callId=${BEWACHT}`, { CallStatus: "in-progress" });
  });
  assert.deepEqual(protokoll.angenommen, [BEWACHT]);
});
