import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant-gap10-a",
  SUB_A = "sub-gap10-a",
  NUM_A = "+4915120000001";
const B = "tenant-gap10-b",
  SUB_B = "sub-gap10-b",
  NUM_B = "+4915120000002";
const TO = "+4915112345678";

const PROFILE = { maxCallsPerHour: null };

const activeNumber = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

function seedTenants(calls = []) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: A, status: "active", idpSubject: SUB_A, ownerName: "Alice", kycLevel: "card" },
      { id: B, status: "active", idpSubject: SUB_B, ownerName: "Bob", kycLevel: "card" },
    ],
    numbers: [activeNumber("num_gap10_a", NUM_A, A), activeNumber("num_gap10_b", NUM_B, B)],
    profiles: { [A]: PROFILE, [B]: PROFILE },
    calls,
  });
}

const FLAG_ON = { MULTI_TENANT: "true", MAX_CALLS_PER_HOUR: "6" };

function placeCall(srv, identity) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
  });
}

test("Stundenlimit gilt PRO Tenant - Tenant B bleibt frei, obwohl Tenant A sein Limit (6) ausschoepft", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedTenants() });
  try {
    for (let i = 1; i <= 6; i++) {
      const res = await placeCall(srv, SUB_A);
      assert.equal(res.status, 500, `A-Call ${i} muss das Gate passieren (Offline-Originate)`);
    }
    const resB = await placeCall(srv, SUB_B);
    assert.notEqual(
      resB.status,
      429,
      `Tenant B darf NICHT wegen Tenant A's Calls blockiert werden - hier: ${resB.status}`,
    );
  } finally {
    await srv.stop();
  }
});

test("der Ablehnungstext des Stundenlimits nennt keinen internen Env-Variablennamen", async () => {
  const srv = await startServer({ env: { ...FLAG_ON, MAX_CALLS_PER_HOUR: "1" }, seed: seedTenants() });
  try {
    await placeCall(srv, SUB_A);
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 429, "Vorbedingung: das zweite A-Call trifft das Stundenlimit");
    const body = await res.json();
    assert.ok(
      !/MAX_CALLS_PER_HOUR/.test(body.error),
      `der Ablehnungstext darf keinen internen Env-Namen preisgeben; hier: "${body.error}"`,
    );
  } finally {
    await srv.stop();
  }
});

test("zwei Identitaeten desselben Tenants teilen sich EIN Stundenlimit", async () => {
  const srv = await startServer({
    env: { ...FLAG_ON, MAX_CALLS_PER_HOUR: "1" },
    seed: seedTenants([seedCall({ id: "c_other_identity", tenantId: A, requestedBy: "other-identity" })]),
  });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(
      res.status,
      429,
      "das Limit haengt am Tenant, nicht an der Identitaet - sonst waere es beliebig vervielfachbar",
    );
  } finally {
    await srv.stop();
  }
});

test("Quelltext: jeder countOutboundCallsSince-Aufruf in outbound-gates.js traegt einen Filter", () => {
  const source = fs.readFileSync(new URL("../src/telephony/outbound-gates.js", import.meta.url), "utf8");
  const callLines = source.split("\n").filter((l) => l.includes("countOutboundCallsSince("));
  assert.ok(callLines.length > 0, "der Zaehler muss ueberhaupt aufgerufen werden");
  for (const line of callLines)
    assert.match(
      line,
      /countOutboundCallsSince\(.*\{/,
      `ungefilterter Aufruf gefunden: ${line.trim()} - das waere eine Plattform-Achse`,
    );
});
