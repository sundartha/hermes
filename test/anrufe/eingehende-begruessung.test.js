import assert from "node:assert/strict";
import { test } from "node:test";
import {
  startServer,
  seedState,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_NUMBER,
  postElRueckfall,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_B = "B";
const B_NUMBER = "+4915255555555";

function seedWithB(sprache = {}) {
  return seedState({
    tenants: [{ id: TENANT_B, status: "active", ownerName: "Maria" }],
    numbers: [
      {
        id: "num_b",
        e164: B_NUMBER,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        ...sprache,
        providerNumberId: null,
      },
    ],
  });
}

test("Inbound auf Tenant-B-Nummer -> Begruessung nennt B's ownerName", async () => {
  const srv = await startServer({ seed: seedWithB() });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAb", From: "+4915112345678", To: B_NUMBER }),
    });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), /<Dial/);
    assert.match(await (await postElRueckfall(srv)).text(), /Maria/);
  } finally {
    await srv.stop();
  }
});

test("Inbound auf Owner-Nummer -> Begruessung nennt weiter Jonas (byte-identisch)", async () => {
  const srv = await startServer({ seed: seedWithB() });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAo",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), /<Dial/);
    assert.match(await (await postElRueckfall(srv)).text(), new RegExp(OWNER_TEST_FIRST_NAME));
  } finally {
    await srv.stop();
  }
});

const TELNYX_HEADERS = { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "1" };
async function inbound(srv, { callSid }) {
  const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: TELNYX_HEADERS,
    body: new URLSearchParams({ CallSid: callSid, From: "+4915112345678", To: B_NUMBER }),
  });
  assert.equal(res.status, HTTP_OK);
  assert.match(await res.text(), /<Dial/);
  return (await postElRueckfall(srv)).text();
}

test("Ohne ElevenLabs-Env: Telnyx-Inbound bleibt byte-identisch auf dem Azure-Bestand", async () => {
  const srv = await startServer({ seed: seedWithB({ language: "de" }) });
  try {
    const xml = await inbound(srv, { callSid: "CAel3" });
    assert.match(xml, /voice="Azure\.de-DE-KatjaNeural"/, "Azure-Default unveraendert");
    assert.doesNotMatch(xml, /ElevenLabs/, "Gate aus -> kein ElevenLabs-Attribut");
  } finally {
    await srv.stop();
  }
});

const HTTP_OK = 200;
