import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, OWNER_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const EN_GREETING_MARKER = /This is .+ AI assistant/;

test("Inbound-Greeting fuer einen EN-Tenant ist strukturell englisch (ex PROMPT-03)", async () => {
  const srv = await startServer({ seed: seedState({ settings: { language: "en" } }) });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAprompt03",
        From: "+15005550101",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    const body = await res.text();
    assert.match(
      body,
      EN_GREETING_MARKER,
      `EN-Tenant bekommt weiterhin die deutsche Begruessung (Launch-Blocker): ${body}`,
    );
  } finally {
    await srv.stop();
  }
});
