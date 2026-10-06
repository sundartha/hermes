import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TO = "+4915112345678";
const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A = "+4915110000001";

const activeNumber = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

const PROVISIONED_PROFILE = { maxCallsPerHour: null };

function seedIdentity(ownerName) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: A,
        status: "active",
        idpSubject: SUB_A,
        kycLevel: "card",
        ...(ownerName ? { ownerName } : {}),
      },
    ],
    numbers: [activeNumber("num_a", NUM_A, A)],
    profiles: { [A]: PROVISIONED_PROFILE },
  });
}

const placeCall = (srv, identity) =>
  fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
  });

const FLAG_ON = { MULTI_TENANT: "true", ALLOWED_NUMBERS: TO };
const outboundCalls = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

test("Flag an: Tenant MIT ownerName passiert das Identitaets-Gate (erreicht Originate, offline 500)", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedIdentity("Alice Anwender") });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(
      res.status,
      500,
      "registrierter Name passiert Identitaet+KYC+Gates+Budget -> scheitert erst am Offline-Originate",
    );
    const call = outboundCalls(srv).find((c) => c.tenantId === A);
    assert.ok(call, "Call mit tenantId=A erzeugt (Identitaets-Gate passiert)");
    assert.equal(call.from, NUM_A, "unter eigener Nummer");
  } finally {
    await srv.stop();
  }
});

test("Flag an: Tenant OHNE ownerName -> 403 keine_identitaet, KEIN Call (fail-closed)", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedIdentity(null) });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 403, "kein registrierter Auftraggeber-Name -> Reject");
    assert.match((await res.json()).error, /Auftraggeber-Name/, "Identitaets-Gate-Fehlertext");
    assert.equal(outboundCalls(srv).length, 0, "Reject VOR createCall -> kein Call");
  } finally {
    await srv.stop();
  }
});
