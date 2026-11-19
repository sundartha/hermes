import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { startServer, seedState, seedCall, waitUntil } from "../helpers.js";
import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const TOKEN_GRENZE = 128;
const WARTEN = { timeoutMs: 30_000 };
const JSON_KOPF = { "content-type": "application/json" };
const FORM_KOPF = { "content-type": "application/x-www-form-urlencoded" };
const UNGUELTIG = { error: "invalid_body" };

async function mitTtsAbruf(run) {
  const angefragt = [];
  const app = express();
  app.use(
    makeVoiceRoutes({
      store: { getCall: () => null, anrufHierBewacht: () => false, save: () => {}, recordWebhookAnchors: () => {} },
      config: withConfigNamespaces({ skipTwilioSignatureCheck: true, machineDetection: { enabled: false, timeoutS: 25 } }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_c, d) => d },
      ttsStore: {
        takeOnce: async (token) => {
          angefragt.push(token);
          return { contentType: "audio/mpeg", bytes: Buffer.from([1, 2, 3]) };
        },
      },
      lifecycle: { reattachActiveCall: async () => ({ call: null }) },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, angefragt);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("voice-eingaben: ein ungueltiges TTS-Token liefert 404 ohne Zugriff auf den Speicher, ein gueltiges Audio", async () => {
  await mitTtsAbruf(async (basis, angefragt) => {
    const ungueltig = ["x".repeat(TOKEN_GRENZE + 1), "%21abc", "abc%21", "ab%20cd", "ab.cd", "ab%2Fcd"];
    for (const token of ungueltig) {
      const res = await abrufMitFrist(`${basis}/voice/tts/${token}`);
      assert.equal(res.status, HTTP_NOT_FOUND, token);
    }
    assert.deepEqual(angefragt, []);
    const gueltig = ["x".repeat(TOKEN_GRENZE), "a-B_9"];
    for (const token of gueltig) {
      const res = await abrufMitFrist(`${basis}/voice/tts/${token}`);
      assert.equal(res.status, HTTP_OK, token);
      assert.equal(res.headers.get("content-type"), "audio/mpeg");
    }
    assert.deepEqual(angefragt, gueltig);
  });
});

const anruf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);

async function mitServer(run) {
  const srv = await startServer({
    seed: seedState({ calls: ["call_vs_a", "call_vs_b"].map((id) => seedCall({ id, status: "active" })) }),
  });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const sende = (srv, pfad, { kopf = JSON_KOPF, body }) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, { method: "POST", headers: kopf, body });

test("voice-eingaben: ein Status-Koerper mit falschen Typen wird mit 400 invalid_body abgewiesen und beendet den Anruf nicht", async () => {
  await mitServer(async (srv) => {
    const falsch = JSON.stringify({ CallStatus: "failed", HangupCause: ["x"] });
    const abgewiesen = await sende(srv, "/voice/status?callId=call_vs_a", { body: falsch });
    assert.equal(abgewiesen.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await abgewiesen.json(), UNGUELTIG);
    const richtig = await sende(srv, "/voice/status?callId=call_vs_b", {
      kopf: FORM_KOPF,
      body: new URLSearchParams({ CallStatus: "failed", HangupCause: "x" }).toString(),
    });
    assert.equal(richtig.status, HTTP_OK);
    await waitUntil(() => anruf(srv, "call_vs_b").endedAt, WARTEN);
    assert.equal(anruf(srv, "call_vs_a").status, "active");
    assert.equal(anruf(srv, "call_vs_a").endedAt, null);
  });
});

test("voice-eingaben: Status, Vorspann und Bein-Meldung mit falsch getypten Feldern liefern 400 invalid_body", async () => {
  await mitServer(async (srv) => {
    const faelle = [
      ["/voice/status?callId=call_vs_a", { CallSid: 5 }],
      ["/voice/status?callId=call_vs_a", { CallDuration: {} }],
      ["/voice/status?callId=call_vs_a", { HangupSource: 1 }],
      ["/voice/status?callId=call_vs_a", { SipHangupCause: 1 }],
      ["/voice/el-bein?callId=call_vs_a", { CallStatus: ["completed"] }],
      ["/voice/vorspann?callId=call_vs_a", { data: "x" }],
      ["/voice/vorspann?callId=call_vs_a", { data: { event_type: 5 } }],
      ["/voice/vorspann?callId=call_vs_a", { data: { payload: { call_control_id: 5 } } }],
      ["/voice/vorspann?callId=call_vs_a", { data: { payload: { status: 5 } } }],
    ];
    for (const [pfad, koerper] of faelle) {
      const res = await sende(srv, pfad, { body: JSON.stringify(koerper) });
      assert.equal(res.status, HTTP_BAD_REQUEST, `${pfad} ${JSON.stringify(koerper)}`);
      assert.deepEqual(await res.json(), UNGUELTIG);
    }
  });
});

test("voice-eingaben: gueltige Koerper werden wie bisher mit 200 angenommen", async () => {
  await mitServer(async (srv) => {
    const faelle = [
      ["/voice/status?callId=call_vs_a", { CallStatus: "ringing", CallDuration: 3, CallSid: "x" }],
      ["/voice/el-bein?callId=call_vs_a", { CallStatus: "ringing" }],
      ["/voice/vorspann?callId=call_vs_a", { data: { event_type: "call.answered", payload: { call_control_id: "cc_unbekannt", status: "x" } } }],
      ["/voice/vorspann?callId=call_vs_a", {}],
      ["/voice/vorspann?callId=call_vs_a", { data: { event_type: "call.hangup" } }],
      ["/voice/status?callId=call_vs_a", { CallDuration: "3", HangupSource: "callee", SipHangupCause: "486" }],
      ["/voice/el-rueckfall?callId=call_vs_a", {}],
    ];
    for (const [pfad, koerper] of faelle) {
      const res = await sende(srv, pfad, { body: JSON.stringify(koerper) });
      assert.equal(res.status, HTTP_OK, `${pfad} ${JSON.stringify(koerper)}`);
    }
  });
});

test("voice-eingaben: eine callId, die kein Text ist, wird auf allen voice-Routen mit 400 invalid_body abgewiesen", async () => {
  await mitServer(async (srv) => {
    const pfade = ["/voice/status", "/voice/el-bein", "/voice/vorspann", "/voice/el-rueckfall"];
    for (const pfad of pfade) {
      for (const abfrage of ["callId=a&callId=b", "callId[x]=b"]) {
        const res = await sende(srv, `${pfad}?${abfrage}`, { body: "{}" });
        assert.equal(res.status, HTTP_BAD_REQUEST, `${pfad}?${abfrage}`);
        assert.deepEqual(await res.json(), UNGUELTIG);
      }
    }
  });
});
