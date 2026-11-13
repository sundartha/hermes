import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitUntil, makeTelnyxSigner, nowSeconds, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const FRIST = { timeout: 60_000 };
const WARTEN = { timeoutMs: 30_000 };
const ZIEL = "+4915112345678";

const anruf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);

test("Status-Meldungen mit gleichem Koerper und Zeitstempel fuer verschiedene Anrufe wirken beide", FRIST, async () => {
  const signer = makeTelnyxSigner();
  const s = seedState();
  const von = { from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL, status: "active" };
  s.calls = ["call_anker_1", "call_anker_2"].map((id) => seedCall({ id, ...von }));
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
    seed: s,
  });
  try {
    const body = new URLSearchParams({ CallStatus: "failed", SipHangupCause: "403" }).toString();
    const zeit = String(nowSeconds());
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(zeit, body),
      "telnyx-timestamp": zeit,
    };
    for (const id of ["call_anker_1", "call_anker_2"]) {
      const res = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, { method: "POST", headers, body });
      assert.equal(res.status, HTTP_OK);
      await waitUntil(() => anruf(srv, id).endedAt, WARTEN);
    }
  } finally {
    await srv.stop();
  }
});
