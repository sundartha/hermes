import assert from "node:assert/strict";
import test from "node:test";

import { placeCall, startServer } from "./helpers.js";
import { starteAufzeichnendeAttrappe } from "./helpers/aufzeichnende-attrappe.js";

const HTTP_OK = 200;
const TARGET = "+4917312345678";
const PUBLIC_URL = "https://hermes-staging.example";
const TEXML_ANRUF_ANGELEGT = Object.freeze({ status: HTTP_OK, koerper: { sid: "tnx_rueckruf_1" } });

test("RUECKRUF-ADRESSEN: ein TeXML-Anruf schickt Url und StatusCallback auf die gesetzte PUBLIC_URL", async () => {
  const telnyx = await starteAufzeichnendeAttrappe(() => TEXML_ANRUF_ANGELEGT);
  const srv = await startServer({
    env: {
      PUBLIC_URL,
      TELNYX_API_KEY: "KEYtest-secret",
      TELNYX_CONNECTION_ID: "conn_test",
      TELNYX_API_BASE: telnyx.url,
      ALLOWED_NUMBERS: TARGET,
    },
    ownerNumber: { e164: "+13125550100", provider: "telnyx" },
  });
  try {
    const res = await placeCall(srv, TARGET);
    const { callId } = await res.json();
    assert.equal(res.status, HTTP_OK);
    assert.ok(callId, "callId fehlt in der Antwort");
    assert.equal(telnyx.anfragen.length, 1, "genau ein TeXML-Anrufstart bei Telnyx");

    const form = new URLSearchParams(telnyx.anfragen[0].rumpf);
    assert.equal(form.get("Url"), `${PUBLIC_URL}/voice/outbound?callId=${callId}`);
    assert.equal(form.get("StatusCallback"), `${PUBLIC_URL}/voice/status?callId=${callId}`);
  } finally {
    await srv.stop();
    await telnyx.schliesse();
  }
});
