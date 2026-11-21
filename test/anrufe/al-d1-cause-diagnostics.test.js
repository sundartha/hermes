import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

let inCall;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [],
    }),
  );
  await import("../../src/config.ts");
  inCall = await import("../../src/consult/in-call.js");
});

test("AL-D1-6: consultClientIsPolling haelt an seinen Grenzen (frisch / genau zu alt / fehlend)", () => {
  const now = Date.now();
  const grenze = inCall.CONSULT_POLL_FRESH_MS;

  assert.equal(inCall.consultClientIsPolling({ consultPolledAtMs: now }, now), true);
  assert.equal(inCall.consultClientIsPolling({ consultPolledAtMs: now - grenze }, now), true);
  assert.equal(inCall.consultClientIsPolling({ consultPolledAtMs: now - grenze - 1 }, now), false);
  assert.equal(inCall.consultClientIsPolling({}, now), false, "fehlendes Feld -> fail-closed");
});
