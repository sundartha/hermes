import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { say, hangup } from "../src/telephony/directives.js";
import { renderDirectives as telnyxRender } from "../src/telephony/adapters/telnyx/render.js";
import { telnyxMessaging } from "../src/telephony/adapters/telnyx/messaging.js";
import { verifyInboundSignature as telnyxVerify } from "../src/telephony/adapters/telnyx/signature.js";

test("renderDirectives liefert einen nicht-leeren String", () => {
  const out = telnyxRender([say("Hallo"), hangup()]);
  assert.equal(typeof out, "string", "liefert String");
  assert.ok(out.length > 0, "nicht leer");
});

test("verifyInboundSignature ist bool + fail-closed (leerer Request)", () => {
  config.telephony.telnyxPublicKey = "";
  const out = telnyxVerify({ headers: {}, rawBody: Buffer.from(""), url: "", params: {} });
  assert.equal(typeof out, "boolean", "liefert boolean");
  assert.equal(out, false, "fail-closed");
});

test("sendSms ist aufrufbar und mappt (fetch gemockt)", async () => {
  config.telephony.telnyxApiKey = "k";
  config.telephony.telnyxApiBase = "https://api.telnyx.com";
  const originalFetch = global.fetch;
  let telnyxText;
  global.fetch = async (_url, opts) => {
    telnyxText = JSON.parse(opts.body).text;
    return { ok: true, status: 200 };
  };
  try {
    await telnyxMessaging.sendSms({ from: "+1", to: "+2", body: "hallo" });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(telnyxText, "hallo", "Telnyx mappt body->text");
});
