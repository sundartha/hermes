import assert from "node:assert/strict";
import { test } from "node:test";

import { startServerExpectExit } from "../helpers.js";

const HOSTING_ENV = { RENDER_EXTERNAL_URL: "https://hermes-probe.onrender.com" };
const REFUSAL = /\[Konfiguration fatal\] Boot wird verweigert/;
const SIGNATURE_FINDING = /SKIP_TWILIO_SIGNATURE_CHECK=true - \/voice-Webhooks bleiben ungeprueft/;
const EXIT_OK = 0;

test("SG-25 Start in Produktion mit abgeschalteter Signaturprüfung wird verweigert", async () => {
  const boot = await startServerExpectExit({
    env: { ...HOSTING_ENV, SKIP_TWILIO_SIGNATURE_CHECK: "true" },
  });
  assert.notEqual(boot.code, EXIT_OK);
  assert.match(boot.output, REFUSAL);
  assert.match(boot.output, SIGNATURE_FINDING);
  assert.doesNotMatch(boot.output, /laeuft auf http/);
});
