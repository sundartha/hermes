// IE6-S2: Testpflicht "neu" - die Realtime-Bridge ist nicht abgeschaltet, sondern NICHT
// ERREICHBAR. Alte Realtime-Schalter werden ausdruecklich gesetzt; der Boot laeuft
// trotzdem sauber, kein Media-Stream-Pfad, kein WebSocket-Upgrade.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  startServer,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  tempDataDir,
  seedState,
  seedCall,
  waitForLog,
  TELNYX_TEST_OWNER_NUMBER,
} from "./helpers.js";

const HTTP_OK = 200;
const HTTP_SWITCHING_PROTOCOLS = 101;
const WS_SAMPLE_KEY = "dGhlIHNhbXBsZSBub25jZQ=="; // RFC 6455, Beispiel-Nonce
const REARM_REST_MS = 10_000; // Muster max-duration-rearm.test.js
const REARM_MAX_DURATION_S = 180;
const ALTER_OPENAI_SCHLUESSEL = "sk-alt-nie-gelesen";

const ALTE_REALTIME_SCHALTER_AN = Object.freeze({
  VOICE_ENGINE: "realtime",
  OPENAI_API_KEY: ALTER_OPENAI_SCHLUESSEL,
  REALTIME_MODEL: "irgendwas-ohne-preis",
  REALTIME_VOICE: "shimmer",
});

// Normalisierung server-generierter Zufallsteile (Muster IE6-S1-3): callId=call_... und
// turnToken=... unterscheiden sich zwischen zwei Servern (server-generiert, zufaellig).
function normalizeTexml(xml) {
  return xml
    .replaceAll(/callId=call_[a-zA-Z0-9_]+/g, "callId=call_X")
    .replaceAll(/turnToken=[a-f0-9]+/g, "turnToken=X");
}

// Upgrade-Anfrage an einen Pfad; loest mit {upgraded, status} auf ('upgrade' ODER
// 'response' feuert bei einer HTTP/WS-Verhandlung immer genau eines von beiden).
function requestWebSocketUpgrade(srv, pfad) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: srv.port,
      path: pfad,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": WS_SAMPLE_KEY,
      },
    });
    req.on("upgrade", (res) => {
      resolve({ upgraded: true, status: res.statusCode });
      req.destroy();
    });
    req.on("response", (res) => {
      resolve({ upgraded: false, status: res.statusCode });
      res.resume();
    });
    req.on("error", reject);
    req.end();
  });
}

test("IE6-S2-1: Boot mit alten Realtime-Schaltern laeuft sauber (wirkungslos, nicht abgelehnt)", async () => {
  const srv = await startServer({ env: ALTE_REALTIME_SCHALTER_AN });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(srv.stdout, /openai_realtime|realtime_carrier_uncollected|realtime_no_midcall_budget/);
    assert.doesNotMatch(srv.stdout, /OPENAI_API_KEY fehlt/);
    assert.match(srv.stdout, /Voice-Engine:\s+budget/);
    assert.doesNotMatch(srv.stdout, new RegExp(ALTER_OPENAI_SCHLUESSEL));
  } finally {
    await srv.stop();
  }
});

test("IE6-S2-2: Inbound bei gesetzten Alt-Schaltern bleibt byte-identisch zu einem Server ohne sie", async () => {
  const dataDirAlt = tempDataDir(seedWithTelnyxNumber());
  const srvAlt = await startServer({ env: ALTE_REALTIME_SCHALTER_AN, dataDir: dataDirAlt });
  const dataDirClean = tempDataDir(seedWithTelnyxNumber());
  const srvClean = await startServer({ dataDir: dataDirClean });
  try {
    const resAlt = await postTelnyxIncoming(srvAlt, { callSid: "v3:ie6s2" });
    const resClean = await postTelnyxIncoming(srvClean, { callSid: "v3:ie6s2" });
    const xmlAlt = await resAlt.text();
    const xmlClean = await resClean.text();
    assert.equal(normalizeTexml(xmlAlt), normalizeTexml(xmlClean), "TeXML byte-identisch nach Normalisierung");
    assert.doesNotMatch(xmlAlt, /<Connect/);
    assert.doesNotMatch(xmlAlt, /<Stream/);
    assert.doesNotMatch(xmlAlt, /stream_token/);
    assert.match(xmlAlt, /<Gather/);

    const callAlt = srvAlt.readStore().calls.find((eintrag) => eintrag.twilioSid === "v3:ie6s2");
    assert.equal(callAlt.costProfile, "telnyx_inbound_budget");
  } finally {
    await srvAlt.stop();
    await srvClean.stop();
  }
});

test("IE6-S2-3: Outbound bei gesetzten Alt-Schaltern bleibt byte-identisch zu einem Server ohne sie", async () => {
  const id = "call_ie6s2_out";
  const seed = seedState({ calls: [seedCall({ id, provider: "telnyx", status: "active", direction: "outbound" })] });
  const srvAlt = await startServer({
    env: ALTE_REALTIME_SCHALTER_AN,
    seed,
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  const srvClean = await startServer({ seed, ownerNumber: TELNYX_TEST_OWNER_NUMBER });
  try {
    const bodyAlt = new URLSearchParams({ CallSid: "CAtest" });
    const bodyClean = new URLSearchParams({ CallSid: "CAtest" });
    const resAlt = await fetch(`${srvAlt.localUrl}/voice/outbound?callId=${id}`, { method: "POST", body: bodyAlt });
    const resClean = await fetch(`${srvClean.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: bodyClean,
    });
    const xmlAlt = await resAlt.text();
    const xmlClean = await resClean.text();
    assert.equal(normalizeTexml(xmlAlt), normalizeTexml(xmlClean), "TeXML byte-identisch nach Normalisierung");
    assert.match(xmlAlt, /<Gather/);
    assert.doesNotMatch(xmlAlt, /<Stream/);
  } finally {
    await srvAlt.stop();
    await srvClean.stop();
  }
});

test("IE6-S2-4: kein WebSocket-Upgrade auf /media/telnyx", async () => {
  const srv = await startServer({ env: ALTE_REALTIME_SCHALTER_AN });
  try {
    const { upgraded, status } = await requestWebSocketUpgrade(srv, "/media/telnyx");
    assert.equal(upgraded, false);
    assert.notEqual(status, HTTP_SWITCHING_PROTOCOLS);
  } finally {
    await srv.stop();
  }
});

test("IE6-S2-5: Boot-Re-Arm ohne Realtime-Sonderfall", async () => {
  const answeredAt = new Date(Date.now() - REARM_REST_MS).toISOString();
  const srv = await startServer({
    env: ALTE_REALTIME_SCHALTER_AN,
    seed: seedState({
      calls: [
        seedCall({
          id: "call_ie6s2_rearm",
          direction: "outbound",
          status: "active",
          answeredAt,
          endedAt: null,
          maxDurationS: REARM_MAX_DURATION_S,
        }),
      ],
    }),
  });
  try {
    await waitForLog(srv, /\[rearm\] aktive Calls beim Boot: 1 re-armed, 0 terminalisiert/);
  } finally {
    await srv.stop();
  }
});

test("IE6-S2-6: Render fail-closed - unbekannte Direktive (stream) wirft, kein STREAM mehr im Enum", async () => {
  const { renderDirectives } = await import("../src/telephony/adapters/telnyx/render.js");
  const direktiven = await import("../src/telephony/directives.js");
  assert.throws(
    () => renderDirectives([{ kind: "stream", url: "wss://x", params: [] }]),
    /unbekannte Direktive: stream/,
  );
  // IEL-B7: DIAL_SIP ist die einzige Erweiterung seit IE6-S2; STREAM bleibt draussen.
  assert.deepEqual(Object.keys(direktiven.DIRECTIVE), ["SAY", "GATHER", "HANGUP", "REDIRECT", "DIAL_SIP"]);
  assert.ok(!("stream" in direktiven));
});

test("IE6-S2-7: Altzeile telnyx_inbound_realtime bleibt unaufgeloest (fail-closed)", async () => {
  const {
    istBekanntesKostenprofil,
    kostenprofilFuerAnruf,
    pflichttypenFuerProfil,
    PFLICHTTYPEN_UNGEMESSEN,
    KOSTENART,
    KOSTENARTEN,
  } = await import("../src/billing/kostenarten.js");
  const { sweepTraegerFuerProfil } = await import("../src/billing/sweep-kostenbeleg.js");
  const { legRunsOurTurnLoop } = await import("../src/telephony/leg-turn-loop.js");
  const { LATENT_COST_PATH_FINDING } = await import("../src/boot-guard.js");

  const ALTES_PROFIL = "telnyx_inbound_realtime";
  assert.equal(istBekanntesKostenprofil(ALTES_PROFIL), false);
  assert.equal(kostenprofilFuerAnruf({ costProfile: ALTES_PROFIL }), ALTES_PROFIL);
  assert.equal(pflichttypenFuerProfil(ALTES_PROFIL, []), PFLICHTTYPEN_UNGEMESSEN);
  assert.equal(sweepTraegerFuerProfil(ALTES_PROFIL), null);
  assert.equal(legRunsOurTurnLoop({ costProfile: ALTES_PROFIL }), true);

  assert.ok(!Object.values(KOSTENART).includes("openai_realtime"));
  assert.ok(!Object.hasOwn(KOSTENARTEN, "openai_realtime"));
  assert.deepEqual(Object.keys(LATENT_COST_PATH_FINDING), ["PLAY_TTS_UNPRICED", "EL_INBOUND_CARRIER_UNCOLLECTED"]);
});

test("IE6-S2-8: Config/Registry kennen die Realtime-Felder nicht mehr", async () => {
  const { config, VOICE_ENGINE, CONFIG_NAMESPACES } = await import("../src/config.js");
  assert.ok(!CONFIG_NAMESPACES.voice.includes("openaiApiKey"));
  assert.ok(!CONFIG_NAMESPACES.voice.includes("realtimeModel"));
  assert.ok(!CONFIG_NAMESPACES.voice.includes("realtimeVoice"));
  assert.throws(() => config.voice.openaiApiKey, TypeError);
  assert.deepEqual(Object.values(VOICE_ENGINE), ["budget"]);
  assert.equal(config.voice.voiceEngine, "budget");
  const registry = await import("../src/telephony/registry.js");
  assert.ok(!("mediaTransport" in registry));
});
