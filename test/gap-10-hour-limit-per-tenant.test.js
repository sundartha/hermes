// GAP-10 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-10").
// Das Stundenlimit greift plattformweit, nicht pro Tenant: globalHourReached() zaehlt
// store.countOutboundCallsSince() OHNE Tenant-Filter (src/telephony/outbound-gates.js:
// 190-192, Kommentar "Tenant-unabhaengig (ohne Filter = alle Calls)"). Ein bezahlter
// Plan setzt maxCallsPerHour:null (src/plans.js:106) und faellt damit auf GENAU dieses
// globale Limit zurueck. Reiner Spawn (startServer, Muster test/outbound-tenant.test.js:
// zwei aktive Tenants mit eigener Nummer/Identitaet ueber X-Internal-Identity).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant-gap10-a",
  SUB_A = "sub-gap10-a",
  NUM_A = "+4915120000001";
const B = "tenant-gap10-b",
  SUB_B = "sub-gap10-b",
  NUM_B = "+4915120000002";
const TO = "+4915112345678"; // erlaubtes DE-Ziel, kein Premium-/Notruf-Praefix

// maxCallsPerHour:null (wie das reale A2/A3-Profil, src/plans.js:106) - der Tenant
// entkoppelt sich NICHT vom globalen Stundenlimit, er faellt genau darauf zurueck.
const PROFILE = { maxCallsPerHour: null };

const activeNumber = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "twilio",
  status: "active",
  providerNumberId: null,
});

function seedTenants() {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: A, status: "active", idpSubject: SUB_A, ownerName: "Alice", kycLevel: "card" },
      { id: B, status: "active", idpSubject: SUB_B, ownerName: "Bob", kycLevel: "card" },
    ],
    numbers: [activeNumber("num_gap10_a", NUM_A, A), activeNumber("num_gap10_b", NUM_B, B)],
    profiles: { [A]: PROFILE, [B]: PROFILE },
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

test("GAP-10 SOLL: Stundenlimit gilt PRO Tenant - Tenant B bleibt frei, obwohl Tenant A das globale Limit (6) ausschoepft", async () => {
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
      "SOLL: Tenant B darf NICHT wegen Tenant A's Calls blockiert werden - heute zaehlt " +
        "globalHourReached() ALLE Tenants gemeinsam (outbound-gates.js:190-192), Tenant B " +
        `bekommt hier: ${resB.status}`,
    );
  } finally {
    await srv.stop();
  }
});

test("GAP-10 SOLL: der Ablehnungstext des Stundenlimits nennt keinen internen Env-Variablennamen", async () => {
  const srv = await startServer({ env: { ...FLAG_ON, MAX_CALLS_PER_HOUR: "1" }, seed: seedTenants() });
  try {
    await placeCall(srv, SUB_A); // verbraucht das Limit(1)
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 429, "Vorbedingung: das zweite A-Call trifft das Stundenlimit");
    const body = await res.json();
    assert.ok(
      !/MAX_CALLS_PER_HOUR/.test(body.error),
      "SOLL: der Ablehnungstext darf keinen internen Env-Namen preisgeben; heute: " +
        `"${body.error}" (outbound-gates.js:292)`,
    );
  } finally {
    await srv.stop();
  }
});
