import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TO = "+4915112345678";
const OWNER_NUMBER = "+15005550006";
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

function seedKyc(kycLevel) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: A, status: "active", idpSubject: SUB_A, ownerName: "Alice A", ...(kycLevel ? { kycLevel } : {}) },
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

test("Flag an: Tenant kyc_level<card (otp) -> 403 KYC-Reject, KEIN Call", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedKyc("otp") });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 403, "otp < card -> Reject");
    assert.match((await res.json()).error, /KYC/i);
    assert.equal(outboundCalls(srv).length, 0, "Reject VOR createCall -> kein Call");
  } finally {
    await srv.stop();
  }
});

test("Flag an: Tenant kyc_level>=card -> KYC passiert (erreicht Originate, offline 500)", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedKyc("card") });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(
      res.status,
      500,
      "card passiert KYC+Gates+Budget -> scheitert erst am Offline-Originate",
    );
    const call = outboundCalls(srv).find((c) => c.tenantId === A);
    assert.ok(call, "Call mit tenantId=A erzeugt (KYC passiert)");
    assert.equal(call.from, NUM_A, "unter eigener Nummer");
  } finally {
    await srv.stop();
  }
});

test("Flag an: Gate-Schnittmenge - kyc<card sperrt, OBWOHL alle anderen Gates frei waeren", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedKyc("none") });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 403, "none sperrt trotz freier Nummer/Budget (Schnittmenge)");
    assert.equal(outboundCalls(srv).length, 0);
  } finally {
    await srv.stop();
  }
});

test("Flag an: Tenant OHNE kyc_level (Nicht-Subscriber, eigene Nummer) -> 403 (Toll-Fraud-Riegel)", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedKyc(null) });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 403, "fehlendes kyc_level -> fail-closed am KYC-Gate");
    assert.match((await res.json()).error, /KYC/i);
    assert.equal(outboundCalls(srv).length, 0, "Reject VOR createCall -> kein Call");
  } finally {
    await srv.stop();
  }
});

test("Betreiber-Kanal (keine Identitaet): Owner-Pfad passiert via Boot-Seed id_verified (kein Selbst-Aussperren)", async () => {
  const srv = await startServer({ env: { ALLOWED_NUMBERS: TO }, seed: seedKyc("none") });
  try {
    const res = await placeCall(srv, null);
    assert.equal(res.status, 500, "identitaetslos -> tenantId=owner, Boot-Seed id_verified -> KYC passiert");
    const call = outboundCalls(srv)[0];
    assert.equal(call.tenantId, BOOTSTRAP_TENANT_ID);
    assert.equal(call.from, OWNER_NUMBER);
    const owner = srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
    assert.equal(owner.kycLevel, "id_verified", "seedBootstrapKyc heilte den Owner beim Boot");
  } finally {
    await srv.stop();
  }
});
