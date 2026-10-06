import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, OWNER_TEST_FIRST_NAME, OWNER_TEST_NUMBER } from "./helpers.js";

const TENANT_B = "B";
const B_NUMBER = "+4915255555555";

function seedWithB() {
  return seedState({
    tenants: [{ id: TENANT_B, status: "active", ownerName: "Maria" }],
    numbers: [
      {
        id: "num_b",
        e164: B_NUMBER,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
}

test("Inbound auf Tenant-B-Nummer -> Begruessung nennt B's ownerName", async () => {
  const srv = await startServer({ seed: seedWithB() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAb", From: "+4915112345678", To: B_NUMBER }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Maria/);
  } finally {
    await srv.stop();
  }
});

test("Inbound auf Owner-Nummer -> Begruessung nennt weiter Jonas (byte-identisch)", async () => {
  const srv = await startServer({ seed: seedWithB() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAo",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), new RegExp(OWNER_TEST_FIRST_NAME));
  } finally {
    await srv.stop();
  }
});
