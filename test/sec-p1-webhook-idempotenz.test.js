import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  makeTelnyxSigner,
  nowSeconds,
  OWNER_TEST_NUMBER,
} from "./helpers.js";
import { startCountingAnthropicMock } from "./_outbound-harness.js";
import { incomingAnchors, turnAnchors, newTurnToken } from "../src/telephony/webhook-idempotenz.js";

const NIE_SCHEITERN = 0;
const HTTP_OK = 200;
const ZWEI_ANRUFE = 2;
const ANKER_PAAR = 2;

function turnTokenOf(xml) {
  return xml.match(/turnToken=([0-9a-f]{16})/)?.[1];
}

function sealedEnvelope(signer, fields) {
  const body = new URLSearchParams(fields).toString();
  const ts = String(nowSeconds());
  return {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(ts, body),
      "telnyx-timestamp": ts,
    },
  };
}

function deliver(srv, url, envelope) {
  return fetch(`${srv.localUrl}${url}`, {
    method: "POST",
    headers: envelope.headers,
    body: envelope.body,
  });
}

const turnEnv = (llmBaseUrl, publicKey) => ({
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  TELNYX_PUBLIC_KEY: publicKey,
  ANTHROPIC_BASE_URL: llmBaseUrl,
});

test("SEC-P1-1: /voice/incoming zweimal zugestellt -> EIN Anruf-Datensatz, beide 200", async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const envelope = sealedEnvelope(signer, {
      CallSid: "CAsecp1incoming",
      From: "+4915112345678",
      To: OWNER_TEST_NUMBER.e164,
    });
    const first = await deliver(srv, "/voice/incoming", envelope);
    const firstBody = await first.text();
    const second = await deliver(srv, "/voice/incoming", envelope);
    const secondBody = await second.text();

    assert.equal(first.status, HTTP_OK);
    assert.equal(second.status, HTTP_OK, "ein Anbieter-Retry ist legitim - kein 4xx");
    assert.equal(secondBody, firstBody, "die Wiederholung bekommt DIESELBE Antwort");
    assert.equal(srv.readStore().calls.length, 1, "kein zweiter Anruf-Datensatz (REPLAY-01)");
  } finally {
    await srv.stop();
  }
});

test("SEC-P1-2/3/4/5: /voice/turn - Wiederholung kostet nichts, echte Runden laufen", async (ctx) => {
  const signer = makeTelnyxSigner();
  const llm = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const srv = await startServer({
    env: turnEnv(llm.url, signer.publicKeyBase64),
    seed: seedState({
      calls: ["call_wdh", "call_pos", "call_runden", "call_strip"].map((id) =>
        seedCall({ id, provider: "telnyx", status: "active" }),
      ),
    }),
  });
  const callOf = (id) => srv.readStore().calls.find((call) => call.id === id);
  const transcriptOf = (id) => callOf(id).transcript.length;
  const usageSnapshot = () => JSON.stringify(srv.readStore().usage);
  try {
    await ctx.test("SEC-P1-2: byte-identische Wiederholung -> keine zweite Modellrunde", async () => {
      const url = `/voice/turn?callId=call_wdh&turnToken=${newTurnToken()}`;
      const envelope = sealedEnvelope(signer, { CallSid: "CAwdh", SpeechResult: "Guten Tag" });
      const first = await deliver(srv, url, envelope);
      const firstBody = await first.text();
      const callsAfterFirst = llm.count();
      const usageAfterFirst = usageSnapshot();
      const zeilenAfterFirst = transcriptOf("call_wdh");

      const second = await deliver(srv, url, envelope);
      assert.equal(second.status, HTTP_OK, "der Retry darf kein 4xx sehen");
      assert.equal(await second.text(), firstBody, "byte-identische Antwort aus dem Cache");
      assert.equal(llm.count(), callsAfterFirst, "KEIN zweiter Modellaufruf (REPLAY-02)");
      assert.equal(usageSnapshot(), usageAfterFirst, "Token/Cent unveraendert");
      assert.equal(transcriptOf("call_wdh"), zeilenAfterFirst, "Transkript unveraendert");
    });

    await ctx.test("SEC-P1-3: Positiv-Kontrolle - anderer Anker wird normal verarbeitet", async () => {
      const vorher = llm.count();
      const zeilenVorher = transcriptOf("call_pos");
      const res = await deliver(
        srv,
        `/voice/turn?callId=call_pos&turnToken=${newTurnToken()}`,
        sealedEnvelope(signer, { CallSid: "CApos", SpeechResult: "Etwas ganz anderes" }),
      );
      assert.equal(res.status, HTTP_OK);
      assert.equal(llm.count(), vorher + 1, "die Route lebt - ein echtes Ereignis ruft das Modell");
      assert.ok(transcriptOf("call_pos") > zeilenVorher, "das Transkript waechst");
    });

    await ctx.test("SEC-P1-4: drei ECHTE Runden desselben Anrufs laufen alle durch", async () => {
      let token = newTurnToken();
      let zeilen = transcriptOf("call_runden");
      for (const gesagt of ["Runde eins", "Runde zwei", "Runde drei"]) {
        const vorher = llm.count();
        const res = await deliver(
          srv,
          `/voice/turn?callId=call_runden&turnToken=${token}`,
          sealedEnvelope(signer, { CallSid: "CArunden", SpeechResult: gesagt }),
        );
        const xml = await res.text();
        assert.equal(res.status, HTTP_OK);
        assert.equal(llm.count(), vorher + 1, `"${gesagt}" wurde als echte Runde verarbeitet`);
        const gewachsen = transcriptOf("call_runden");
        assert.ok(gewachsen > zeilen, `"${gesagt}" steht im Transkript`);
        zeilen = gewachsen;
        token = turnTokenOf(xml) ?? newTurnToken();
      }
    });

    await ctx.test("SEC-P1-5: Marke gestrichen -> der Umschlag-Anker faengt die Wiederholung", async () => {
      const envelope = sealedEnvelope(signer, { CallSid: "CAstrip", SpeechResult: "Marke weg" });
      const first = await deliver(
        srv,
        `/voice/turn?callId=call_strip&turnToken=${newTurnToken()}`,
        envelope,
      );
      const firstBody = await first.text();
      const nachErst = llm.count();
      const zeilenNachErst = transcriptOf("call_strip");

      const second = await deliver(srv, "/voice/turn?callId=call_strip", envelope);
      assert.equal(second.status, HTTP_OK);
      assert.equal(await second.text(), firstBody, "dieselbe Antwort trotz gestrichener Marke");
      assert.equal(llm.count(), nachErst, "KEINE zweite Modellrunde");
      assert.equal(transcriptOf("call_strip"), zeilenNachErst, "Transkript unveraendert");
    });
  } finally {
    await srv.stop();
    await llm.close();
  }
});

test("SEC-P1-6: zwei verschiedene Anrufe im selben Moment - keiner schliesst den anderen aus", async () => {
  const signer = makeTelnyxSigner();
  const llm = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const srv = await startServer({
    env: turnEnv(llm.url, signer.publicKeyBase64),
    seed: seedState({
      calls: [
        seedCall({ id: "call_a", provider: "telnyx", status: "active" }),
        seedCall({ id: "call_b", provider: "telnyx", status: "active" }),
      ],
    }),
  });
  try {
    const vorher = llm.count();
    const resA = await deliver(
      srv,
      `/voice/turn?callId=call_a&turnToken=${newTurnToken()}`,
      sealedEnvelope(signer, { CallSid: "CAlegA", SpeechResult: "Hallo" }),
    );
    const resB = await deliver(
      srv,
      `/voice/turn?callId=call_b&turnToken=${newTurnToken()}`,
      sealedEnvelope(signer, { CallSid: "CAlegB", SpeechResult: "Hallo" }),
    );
    assert.equal(resA.status, HTTP_OK);
    assert.equal(resB.status, HTTP_OK);
    assert.equal(llm.count(), vorher + ZWEI_ANRUFE, "BEIDE Anrufe wurden verarbeitet");
    const store = srv.readStore();
    for (const id of ["call_a", "call_b"]) {
      const call = store.calls.find((seen) => seen.id === id);
      assert.ok(call.transcript.length > 0, `${id} hat seinen Turn bekommen`);
    }
  } finally {
    await srv.stop();
    await llm.close();
  }
});

test("SEC-P1-7: Neustart-Fall - persistierter Anker antwortet mit offenem Mikrofon", async () => {
  const signer = makeTelnyxSigner();
  const llm = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const token = newTurnToken();
  const srv = await startServer({
    env: turnEnv(llm.url, signer.publicKeyBase64),
    seed: seedState({
      calls: [
        seedCall({
          id: "call_restart",
          provider: "telnyx",
          status: "active",
          webhookAnchors: [`t:${token}`],
        }),
      ],
    }),
  });
  try {
    const res = await deliver(
      srv,
      `/voice/turn?callId=call_restart&turnToken=${token}`,
      sealedEnvelope(signer, { CallSid: "CArestart", SpeechResult: "nach dem Deploy" }),
    );
    const xml = await res.text();
    assert.equal(res.status, HTTP_OK);
    assert.match(xml, /<Gather/, "Mikrofon bleibt offen statt Stille-Falle");
    assert.equal(llm.count(), 0, "keine Modellrunde - die Wiederholung kostet keinen Cent");
    const call = srv.readStore().calls.find((seen) => seen.id === "call_restart");
    assert.equal(call.transcript.length, 0, "kein zweiter Transkript-Eintrag");
  } finally {
    await srv.stop();
    await llm.close();
  }
});

test("SEC-P1-9: /voice/incoming nach Neustart - der Anruf-Datensatz IST der Anker", async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
    seed: seedState({
      calls: [
        seedCall({
          id: "call_incoming_restart",
          provider: "telnyx",
          status: "active",
          twilioSid: "CAsecp1restart",
        }),
      ],
    }),
  });
  try {
    const envelope = sealedEnvelope(signer, {
      CallSid: "CAsecp1restart",
      From: "+4915112345678",
      To: OWNER_TEST_NUMBER.e164,
    });
    const res = await deliver(srv, "/voice/incoming", envelope);
    const xml = await res.text();
    assert.equal(res.status, HTTP_OK);
    assert.match(xml, /<Gather/, "keepAliveXml haelt das Mikrofon offen statt eines Fehlers");
    assert.equal(srv.readStore().calls.length, 1, "kein zweiter Anruf-Datensatz entsteht");
  } finally {
    await srv.stop();
  }
});

test("SEC-P1-8: Anker-Ableitung an den Raendern - leere Liste statt Throw", () => {
  assert.deepEqual(incomingAnchors({ body: { CallSid: "CAx" } }), ["in:CAx"]);
  assert.deepEqual(incomingAnchors({ body: {} }), [], "fehlende CallSid -> kein Anker");
  assert.deepEqual(incomingAnchors({}), [], "gar kein Body -> kein Anker");

  const headers = { "telnyx-timestamp": "1700000000" };
  const rawBody = Buffer.from("SpeechResult=hallo");
  const beide = turnAnchors({ query: { turnToken: "abc" }, headers, rawBody });
  assert.equal(beide.length, ANKER_PAAR, "Marke + Umschlag");
  assert.equal(beide[0], "t:abc");
  assert.match(beide[1], /^e:[0-9a-f]{64}$/);

  assert.deepEqual(
    turnAnchors({ query: {}, headers, rawBody }),
    [beide[1]],
    "fehlende Marke -> der Umschlag-Anker traegt allein",
  );
  assert.deepEqual(
    turnAnchors({ query: { turnToken: "abc" }, headers: {}, rawBody }),
    ["t:abc"],
    "kein signierter Umschlag (lokaler Skip-Modus) -> nur die Marke",
  );
  assert.deepEqual(turnAnchors({}), [], "gar nichts ableitbar -> leere Liste, kein Throw");

  const gleich = turnAnchors({ query: {}, headers, rawBody });
  assert.deepEqual(gleich, [beide[1]], "derselbe Umschlag ergibt denselben Fingerabdruck");
});
