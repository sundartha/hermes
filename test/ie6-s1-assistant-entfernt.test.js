// IE6-S1: Testpflicht "neu" - nicht nur abgeschaltet, sondern NICHT ERREICHBAR. Alte
// Assistant-Schalter werden ausdruecklich AN gesetzt; der Boot muss trotzdem sauber
// durchlaufen (kein Pflichtbefund mehr) und die entfernten Routen/Zweige duerfen keine
// Spur hinterlassen. Server-Start nur ueber test/helpers.js#startServer (Lehre
// test-base-env-drift).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  placeCall,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  tempDataDir,
  TELNYX_TEST_OWNER_NUMBER,
} from "./helpers.js";

const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;

// Alte Assistant-Schalter, ausdruecklich AN - der Boot muss trotzdem durchlaufen (kein
// Pflichtbefund mehr, keine Route mehr) und /v1/chat/completions bleibt unauffindbar,
// unabhaengig vom Env-Wert.
const ALTE_ASSISTANT_SCHALTER_AN = Object.freeze({
  TELNYX_AI_ASSISTANT_ENABLED: "true",
  TELNYX_INBOUND_HANDOFF_ENABLED: "true",
  TELNYX_ASSISTANT_ID: "asst_alt",
  TELNYX_CALL_CONTROL_APP_ID: "ccapp_alt",
  TELNYX_SHIM_SHARED_SECRET: "shim_alt",
});

test("IE6-S1-1: POST /v1/chat/completions ist entfernt - 404 unabhaengig von Env, kein Pflichtbefund", async () => {
  const srv = await startServer({ env: { ...ALTE_ASSISTANT_SCHALTER_AN } });
  try {
    const res = await fetch(`${srv.localUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer shim_alt", "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hallo" }],
        extra_metadata: { call_control_id: "cc_1" },
      }),
    });
    assert.equal(res.status, HTTP_NOT_FOUND);
    const text = await res.text();
    assert.ok(!text.includes("choices"), "kein choices-Feld im Antwortkoerper");
    assert.ok(!text.includes("data:"), "keine SSE-Antwort");
  } finally {
    await srv.stop();
  }
});

test("IE6-S1-2: Outbound bei gesetzten Alt-Schaltern faellt auf den TeXML-Zweig zurueck", async () => {
  const srv = await startServer({
    env: { ...ALTE_ASSISTANT_SCHALTER_AN, FAKE_ORIGINATE: "true", ELEVENLABS_OUTBOUND_ENABLED: "false" },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, HTTP_OK);
    const { callId } = await res.json();
    const calls = srv.readStore().calls;
    const call = calls.find((eintrag) => eintrag.id === callId);
    assert.equal(call.costProfile, "telnyx_budget");
    assert.equal(call.callControlId, null);
    assert.match(call.twilioSid, /^fake_/);
    assert.ok(!/^fake_cc_/.test(call.twilioSid), "kein Call-Control-Fake-Praefix");
  } finally {
    await srv.stop();
  }
});

test("IE6-S1-3: Inbound bei gesetzten Alt-Schaltern bleibt byte-identisch zu einem Server ohne sie", async () => {
  const dataDir = tempDataDir(seedWithTelnyxNumber());
  const srvAlt = await startServer({ env: { ...ALTE_ASSISTANT_SCHALTER_AN }, dataDir });
  const dataDir2 = tempDataDir(seedWithTelnyxNumber());
  const srvClean = await startServer({ dataDir: dataDir2 });
  try {
    const resAlt = await postTelnyxIncoming(srvAlt, { callSid: "v3:ie6s1" });
    const resClean = await postTelnyxIncoming(srvClean, { callSid: "v3:ie6s1" });
    const contentType = resAlt.headers.get("content-type");
    assert.equal(contentType.split(";")[0], "text/xml");
    const xmlAlt = await resAlt.text();
    const xmlClean = await resClean.text();
    // Normalisierung: callId=call_... und turnToken=... unterscheiden sich zwischen
    // den zwei Servern (server-generiert, zufaellig).
    const normalize = (xml) =>
      xml
        .replaceAll(/callId=call_[a-zA-Z0-9]+/g, "callId=call_X")
        .replaceAll(/turnToken=[a-f0-9]+/g, "turnToken=X");
    assert.equal(normalize(xmlAlt), normalize(xmlClean), "TeXML byte-identisch nach callId-Normalisierung");

    const altCalls = srvAlt.readStore().calls;
    const callAlt = altCalls.find((eintrag) => eintrag.twilioSid === "v3:ie6s1");
    assert.equal(callAlt.callControlId, null);

    const inboundPathLines = srvAlt.stdout.match(/\[inbound-path\] inbound_path \{"callId":"call_[^"]+","path":"budget"\}/g);
    assert.equal(inboundPathLines ? inboundPathLines.length : 0, 1, "genau eine Sonden-Zeile");
    assert.ok(!srvAlt.stdout.includes("handoff_fallback"));
    assert.ok(!srvAlt.stdout.includes("[voice/call-control]"));
  } finally {
    await srvAlt.stop();
    await srvClean.stop();
  }
});

test("IE6-S1-4: POST /voice/call-control existiert nicht mehr (404)", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/voice/call-control?callId=x`, { method: "POST" });
    assert.equal(res.status, HTTP_NOT_FOUND);
  } finally {
    await srv.stop();
  }
});

test("IE6-S1-5: das Boot-Banner enthaelt keine entfernten Assistant-Zeilen mehr", async () => {
  const srv = await startServer({ env: { ...ALTE_ASSISTANT_SCHALTER_AN } });
  try {
    for (const zeile of ["Assistant-Pfad:", "Inbound-Handoff:", "Pro-Call-Transkription:", "Token-Streaming:"]) {
      assert.ok(!srv.stdout.includes(zeile), `Boot-Banner darf "${zeile}" nicht mehr enthalten`);
    }
  } finally {
    await srv.stop();
  }
});

test("IE6-S1-6: logInboundPath schreibt genau eine byte-gleiche Zeile; INBOUND_PATH hat genau einen Token", async () => {
  const { logInboundPath, INBOUND_PATH } = await import("../src/telephony/inbound-path.js");
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    logInboundPath({ callId: "call_a", path: INBOUND_PATH.BUDGET });
  } finally {
    console.log = original;
  }
  assert.deepEqual(lines, ['[inbound-path] inbound_path {"callId":"call_a","path":"budget"}']);
  assert.deepEqual(Object.keys(INBOUND_PATH), ["BUDGET"]);
});

test("IE6-S1-7: eine Altzeile mit costProfile='telnyx_assistant' bleibt fail-closed unaufgeloest", async () => {
  const {
    istBekanntesKostenprofil,
    kostenprofilFuerAnruf,
    pflichttypenFuerProfil,
    PFLICHTTYPEN_UNGEMESSEN,
  } = await import("../src/billing/kostenarten.js");
  const { sweepTraegerFuerProfil } = await import("../src/billing/sweep-kostenbeleg.js");
  const { legRunsOurTurnLoop } = await import("../src/telephony/leg-turn-loop.js");

  assert.equal(istBekanntesKostenprofil("telnyx_assistant"), false);
  assert.equal(kostenprofilFuerAnruf({ costProfile: "telnyx_assistant" }), "telnyx_assistant");
  assert.equal(pflichttypenFuerProfil("telnyx_assistant", []), PFLICHTTYPEN_UNGEMESSEN);
  assert.equal(sweepTraegerFuerProfil("telnyx_assistant"), null);
  assert.equal(legRunsOurTurnLoop({ costProfile: "telnyx_assistant" }), true);
});

test("IE6-S1-8: der telnyxAssistant-Namespace ist aus config.js entfernt", async () => {
  const { config, CONFIG_NAMESPACES } = await import("../src/config.js");
  const { CAPABILITY } = await import("../src/telephony/registry.js");
  assert.deepEqual(CONFIG_NAMESPACES.telnyx, ["telnyxElevenLabs"]);
  assert.throws(() => config.telnyx.telnyxAssistant, TypeError);
  assert.deepEqual(Object.keys(config.telnyx.telnyxElevenLabs), ["voiceId"]);
  assert.deepEqual(Object.keys(CAPABILITY), ["PLAY_AUDIO_TTS"]);
});
