import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { telnyxMessaging } from "../src/telephony/adapters/telnyx/messaging.js";

function withMockFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = original;
  });
}

test("sendSms: POST /v2/messages, Bearer + JSON, body->text-Mapping", async () => {
  config.telephony.telnyxApiKey = "test-telnyx-key";
  config.telephony.telnyxApiBase = "https://api.telnyx.com";
  let captured;
  await withMockFetch(
    async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200 };
    },
    () => telnyxMessaging.sendSms({ from: "+15005550006", to: "+4915112345678", body: "Hallo" }),
  );
  assert.ok(captured.url.endsWith("/v2/messages"), "URL endet auf /v2/messages");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, "Bearer test-telnyx-key");
  assert.equal(captured.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(captured.opts.body), {
    from: "+15005550006",
    to: "+4915112345678",
    text: "Hallo",
  });
});

test("sendSms: Nicht-2xx -> wirft mit HTTP-Status, OHNE API-Key in der Meldung", async () => {
  config.telephony.telnyxApiKey = "geheim-leak-test";
  config.telephony.telnyxApiBase = "https://api.telnyx.com";
  await withMockFetch(
    async () => ({ ok: false, status: 422 }),
    async () => {
      await assert.rejects(
        () => telnyxMessaging.sendSms({ from: "+1", to: "+2", body: "x" }),
        (err) => {
          assert.match(err.message, /HTTP 422/);
          assert.ok(
            !err.message.includes("geheim-leak-test"),
            "API-Key darf nicht in der Fehlermeldung stehen",
          );
          return true;
        },
      );
    },
  );
});

test("sendSms: Nicht-2xx mit Telnyx-Errors-Envelope -> Meldung um code/title angereichert (P7-Cluster12)", async () => {
  config.telephony.telnyxApiKey = "geheim-leak-test-2";
  config.telephony.telnyxApiBase = "https://api.telnyx.com";
  await withMockFetch(
    async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ errors: [{ code: "10008", title: "invalid" }] }),
    }),
    async () => {
      await assert.rejects(
        () => telnyxMessaging.sendSms({ from: "+1", to: "+2", body: "x" }),
        (err) => {
          assert.match(err.message, /HTTP 422/);
          assert.match(err.message, /10008/);
          assert.match(err.message, /invalid/);
          assert.ok(
            !err.message.includes("geheim-leak-test-2"),
            "API-Key darf nicht in der Fehlermeldung stehen",
          );
          return true;
        },
      );
    },
  );
});

test("sendSms: fehlender API-Key -> wirft (fail-closed, kein Netz-Call)", async () => {
  config.telephony.telnyxApiKey = "";
  let called = false;
  await withMockFetch(
    async () => {
      called = true;
      return { ok: true, status: 200 };
    },
    async () => {
      await assert.rejects(
        () => telnyxMessaging.sendSms({ from: "+1", to: "+2", body: "x" }),
        /TELNYX_API_KEY fehlt/,
      );
    },
  );
  assert.equal(called, false, "ohne API-Key wird fetch nie gerufen");
});
