// AL-P2b-Fix1 (S2-1): geteilter Telnyx-HTTP-Baustein (src/telephony/adapters/telnyx/
// http-client.js). Vorher bauten scripts/al-p2-spike-driver.mjs, scripts/telnyx-call-
// latency.mjs und scripts/telnyx-assistant-provision.mjs unabhaengig voneinander denselben
// Bearer-Header + fetch + assertTelnyxOk + {data}-Envelope-Unwrap. Dieser Test sichert die
// Vertrags-Eigenschaften ab, an denen der zusammengezogene Code haengt: Header-Form,
// path- vs. url-Aufloesung, body-Serialisierung, {data}-Unwrap und Fehler-Propagation ueber
// assertTelnyxOk. Offline: global.fetch wird gestubbt (F.I.R.S.T.), kein echtes Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { telnyxHeaders, telnyxRequest } from "../src/telephony/adapters/telnyx/http-client.js";
import { config } from "../src/config.js";

function stubFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => {
    global.fetch = original;
  };
}

test("telnyxHeaders: Bearer aus config.telephony.telnyxApiKey + Content-Type json", () => {
  const headers = telnyxHeaders();
  assert.equal(headers.Authorization, `Bearer ${config.telephony.telnyxApiKey}`);
  assert.equal(headers["Content-Type"], "application/json");
});

test("telnyxRequest: path wird gegen telnyxApiBase aufgeloest, method/headers/body korrekt gebaut", async () => {
  let seenUrl;
  let seenInit;
  const restore = stubFetch(async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return { ok: true, status: 200, json: async () => ({ data: { id: "abc" } }) };
  });
  try {
    const result = await telnyxRequest({
      method: "PATCH",
      path: "/v2/phone_numbers/num-1",
      body: { connection_id: "conn-1" },
      op: "test-op",
    });
    assert.equal(seenUrl, `${config.telephony.telnyxApiBase}/v2/phone_numbers/num-1`);
    assert.equal(seenInit.method, "PATCH");
    assert.equal(seenInit.headers.Authorization, `Bearer ${config.telephony.telnyxApiKey}`);
    assert.equal(seenInit.body, JSON.stringify({ connection_id: "conn-1" }));
    assert.deepEqual(result, { id: "abc" });
  } finally {
    restore();
  }
});

test("telnyxRequest: url ueberschreibt path (Update-Fall mit ID-tragender URL), body undefined bei GET", async () => {
  let seenUrl;
  let seenInit;
  const restore = stubFetch(async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return { ok: true, status: 200, json: async () => ({ data: { id: "assistant-1" } }) };
  });
  try {
    const explicitUrl = "https://api.telnyx.com/v2/ai/assistants/assistant-1";
    const result = await telnyxRequest({ url: explicitUrl, op: "fetchAssistant" });
    assert.equal(seenUrl, explicitUrl);
    assert.equal(seenInit.method, "GET");
    assert.equal(seenInit.body, undefined);
    assert.deepEqual(result, { id: "assistant-1" });
  } finally {
    restore();
  }
});

test("telnyxRequest: Envelope ohne data-Feld -> ganzes JSON wird zurueckgegeben", async () => {
  const restore = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ voice_url: "x" }) }));
  try {
    const result = await telnyxRequest({ path: "/v2/texml_applications/1", op: "test-op" });
    assert.deepEqual(result, { voice_url: "x" });
  } finally {
    restore();
  }
});

test("telnyxRequest: Fehlerantwort wirft ueber assertTelnyxOk (fail-closed), kein stiller Erfolg", async () => {
  const body = JSON.stringify({ errors: [{ code: "10015", title: "Payment required" }] });
  const restore = stubFetch(async () => ({ ok: false, status: 402, text: async () => body }));
  try {
    await assert.rejects(
      () => telnyxRequest({ path: "/v2/ai/assistants/x", op: "fetchAssistant" }),
      (err) => {
        assert.match(err.message, /HTTP 402/);
        assert.match(err.message, /10015/);
        assert.equal(err.providerStatus, 402);
        return true;
      },
    );
  } finally {
    restore();
  }
});
