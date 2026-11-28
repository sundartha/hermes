import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, OWNER_TEST_NUMBER, postElRueckfall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const DE_GREETING_MARKER = /Hier ist der KI-Assistent/;

test("Inbound-Greeting fuer einen EN-Tenant ist strukturell englisch (ex PROMPT-03)", async () => {
  const srv = await startServer({ seed: seedState() });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAprompt03",
        From: "+15005550101",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.match(await res.text(), /<Dial/);
    const body = await (await postElRueckfall(srv)).text();
    assert.match(
      body,
      DE_GREETING_MARKER,
      `Inbound startet auf de, auch fuer einen EN-Tenant: ${body}`,
    );
  } finally {
    await srv.stop();
  }
});
