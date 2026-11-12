import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitUntil, makeTelnyxSigner, nowSeconds, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_VERBOTEN = 403;
const FRIST = { timeout: 60_000 };
const ZIEL = "+4915112345678";
const CODE = "not-placed:invite-403";

const stand = () => {
  const s = seedState();
  s.calls = [seedCall({ id: "call_sig", from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL, status: "active" })];
  return s;
};
const anruf = (srv) => srv.readStore().calls.find((call) => call.id === "call_sig");
const marker = (srv) => srv.readStore().outageAlerts.find((alert) => alert.code === CODE);

function melde(srv, signer, { signatur, zeit = String(nowSeconds()) } = {}) {
  const body = new URLSearchParams({ CallStatus: "failed", SipHangupCause: "403" }).toString();
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signatur !== "keine") {
    headers["telnyx-signature-ed25519"] = signatur ?? signer.sign(zeit, body);
    headers["telnyx-timestamp"] = zeit;
  }
  return abrufMitFrist(`${srv.localUrl}/voice/status?callId=call_sig`, { method: "POST", headers, body });
}

test("Anrufende mit scharfer Signaturpruefung: echt signiertes Ende wird gemeldet, ungueltig oder unsigniert wird abgewiesen", FRIST, async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64, OUTAGE_ALERT_MIN_FAILURES: "2", OUTAGE_ALERT_RETRY_MS: "0", OUTAGE_ALERT_WINDOW_MS: "86400000", INBOUND_OUTAGE_ALERT_WINDOW_MS: "86400000", OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0", PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0" },
    seed: stand(),
  });
  try {
    const fremd = makeTelnyxSigner();
    const falsch = await melde(srv, signer, { signatur: fremd.sign(String(nowSeconds()), "x") });
    assert.equal(falsch.status, HTTP_VERBOTEN);
    const ohne = await melde(srv, signer, { signatur: "keine" });
    assert.equal(ohne.status, HTTP_VERBOTEN);
    assert.equal(marker(srv), undefined);
    assert.equal(anruf(srv).endedAt, null);

    const echt = await melde(srv, signer);
    assert.equal(echt.status, HTTP_OK);
    await waitUntil(() => marker(srv));
    assert.equal(marker(srv).code, CODE);
    assert.ok(anruf(srv).endedAt);
  } finally {
    await srv.stop();
  }
});
