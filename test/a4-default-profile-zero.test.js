import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { resolveProfileFrom, BOOTSTRAP_TENANT_ID, KYC_LEVEL } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

const TO = "+4915112345678";
const MT = { MULTI_TENANT: "true", ALLOWED_COUNTRY_CODES: "*" };

const postCall = (url, to, identity) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: "Test" }),
  });

const outboundCalls = (srv) => srv.readStore().calls.filter((c) => c.direction === "outbound");

const subscriberTenant = (id, idpSubject) => ({
  id,
  status: "active",
  idpSubject,
  ownerName: `${id} Tester`,
  kycLevel: KYC_LEVEL.CARD,
});
const activeNumber = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

test("A4: resolveProfileFrom - DEFAULT=0 harter Block, Owner/Tier unberuehrt", () => {
  assert.equal(
    resolveProfileFrom("nobody@x", undefined).maxCallsPerHour,
    0,
    "profil-lose, bekannte tenantId -> DEFAULT_PROFILE.maxCallsPerHour === 0",
  );
  assert.equal(
    resolveProfileFrom(BOOTSTRAP_TENANT_ID, undefined).maxCallsPerHour,
    null,
    "BOOTSTRAP -> OWNER_PROFILE, von A4 unberuehrt (null = nur globaler Cap)",
  );
  assert.equal(
    resolveProfileFrom("t_paid", planProfileFor("starter")).maxCallsPerHour,
    null,
    "A2/A3-Tier-Profil (maxCallsPerHour=null) hebt den DEFAULT-0-Block auf",
  );
});

test("A4: profil-loser Tenant -> 429 bei 0 Calls (harter Block)", async () => {
  const srv = await startServer({
    env: MT,
    seed: seedState({
      tenants: [subscriberTenant("t_np", "sub-np")],
      numbers: [activeNumber("num_np", "+4915110000091", "t_np")],
    }),
  });
  try {
    const res = await postCall(srv.localUrl, TO, "sub-np");
    assert.equal(res.status, 429, "DEFAULT_PROFILE(maxCallsPerHour=0) blockt sofort");
    assert.match((await res.json()).error, /Hourly limit/);
    assert.equal(outboundCalls(srv).length, 0, "Block VOR createCall -> kein Call-Record");
  } finally {
    await srv.stop();
  }
});

test("A4: provisioniertes Tier-Profil + Owner passieren das Gate (500)", async () => {
  const srv = await startServer({
    env: MT,
    seed: seedState({
      tenants: [subscriberTenant("t_paid", "sub-paid")],
      numbers: [activeNumber("num_paid", "+4915110000092", "t_paid")],
      profiles: { t_paid: planProfileFor("starter") },
    }),
  });
  try {
    assert.equal(
      (await postCall(srv.localUrl, TO, "sub-paid")).status,
      500,
      "provisioniert (maxCallsPerHour=null) -> passiert, scheitert erst am Offline-Originate",
    );
    assert.equal(
      (await postCall(srv.localUrl, TO, null)).status,
      500,
      "Owner (kein Header -> BOOTSTRAP) -> OWNER_PROFILE, unberuehrt -> passiert",
    );
  } finally {
    await srv.stop();
  }
});
