// W5: Allowlist an das Abo gekoppelt (Tenant-Achse). Das Outbound-Allowlist-Gate
// (server.js allowlistError) behandelt einen AKTIVEN, KYC-verifizierten Subscriber wie
// `unrestricted` (Ziel-Nummer), waehrend Denylist/Land/Stundenlimit als harte Gates
// unberuehrt bleiben und ein suspendierter Tenant HART abgewiesen wird (Defense-in-depth).
//
// Reiner Spawn (startServer + seedState), KEIN pglite (Lehre p6a-Stall). Identitaet ueber
// den localhost-only X-Internal-Identity-Header = idpSubject (wie kyc-gate-outbound.test.js/
// outbound-tenant.test.js). Ein durchgelassener Call erreicht das Offline-Originate und
// endet 500 (= alle Gates passiert), eine Sperre als 403/429.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TO = "+4915112345678"; // normales DE-Ziel, BEWUSST NICHT in ALLOWED_NUMBERS
const DENY_EMERGENCY = "112"; // Notruf-Kurzwahl (Denylist, hardcoded)
const DENY_PREMIUM = "+4990012345678"; // DE-Premium (Denylist, hardcoded)
const US = "+12025550123"; // Land-Gate-Verletzer bei ALLOWED_COUNTRY_CODES=+49
const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A = "+4915110000001";

const activeNumber = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "twilio",
  status: "active",
  providerNumberId: null,
});

// Seed: Owner-Tenant (active) + Tenant A mit eigener aktiver Nummer + idpSubject + ownerName
// (P2b: das Outbound-Identitaets-Gate verlangt einen registrierten Namen VOR dem KYC-Gate).
// kycLevel/status/extraCalls/profiles optional ueberschreibbar.
function seed({ kycLevel, status = "active", calls = [], profiles = {} } = {}) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: A,
        status,
        idpSubject: SUB_A,
        ownerName: "Alice A",
        ...(kycLevel ? { kycLevel } : {}),
      },
    ],
    numbers: [activeNumber("num_a", NUM_A, A)],
    calls,
    profiles,
  });
}

// POST /api/calls ueber localhost (-> X-Internal-Identity gilt). identity = idpSubject des
// Request-Tenants (oder null fuer Owner/localhost-ohne-Identitaet).
const placeCall = (srv, identity, to = TO) =>
  fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: "Termin vereinbaren" }),
  });

const outboundCalls = (srv) => srv.readStore().calls.filter((c) => c.direction === "outbound");
const recent = () => new Date().toISOString();
const MT = { MULTI_TENANT: "true" }; // ALLOWED_NUMBERS bleibt leer (BASE_ENV), Land "*"

// ---- 1. Aktiver Subscriber + KYC ok -> beliebiges (Nicht-Deny-)Ziel ohne ALLOWED_NUMBERS ----
test("W5-1: aktiver Subscriber (kyc=card) waehlt beliebiges Ziel OHNE ALLOWED_NUMBERS-Eintrag", async () => {
  const srv = await startServer({ env: MT, seed: seed({ kycLevel: "card" }) });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 500, "Abo+KYC ersetzt die statische Allowlist -> alle Gates passiert");
    const call = outboundCalls(srv).find((c) => c.tenantId === A);
    assert.ok(call, "Call mit tenantId=A erzeugt (Allowlist abo-erfuellt)");
    assert.equal(call.from, NUM_A, "unter eigener Nummer");
    assert.equal(call.to, TO);
  } finally {
    await srv.stop();
  }
});

// ---- 2. Denylist bleibt unumgehbar, auch fuer den aktiven Subscriber ----
test("W5-2: aktiver Subscriber -> Denylist (Notruf/Premium) trotzdem 403, kein Call", async () => {
  const srv = await startServer({ env: MT, seed: seed({ kycLevel: "card" }) });
  try {
    for (const to of [DENY_EMERGENCY, DENY_PREMIUM]) {
      const res = await placeCall(srv, SUB_A, to);
      assert.equal(res.status, 403, `${to} muss trotz Abo gesperrt bleiben (Denylist)`);
      assert.match((await res.json()).error, /gesperrt/);
    }
    assert.equal(outboundCalls(srv).length, 0, "Denylist-Sperre VOR createCall -> kein Call");
  } finally {
    await srv.stop();
  }
});

// ---- 3. Suspendierter Tenant -> 403, auch mit gueltigem (unrestricted) Profil ----
test("W5-3: suspendierter Tenant -> 403 (Defense-in-depth), auch mit unrestricted-Profil", async () => {
  const srv = await startServer({
    env: MT,
    // Selber Account suspendiert + ein unrestricted-Profil auf der Identitaet: beweist, dass
    // der Hard-Block VOR der Profil-Lockerung greift (Abo gekuendigt -> kein freies Waehlen).
    seed: seed({ kycLevel: "card", status: "suspended", profiles: { [SUB_A]: { unrestricted: true } } }),
  });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 403, "suspended -> hart abgewiesen, trotz unrestricted-Profil");
    assert.match((await res.json()).error, /Abo inaktiv|gesperrt/i);
    assert.equal(outboundCalls(srv).length, 0, "Reject VOR createCall -> kein Call");
  } finally {
    await srv.stop();
  }
});

// ---- 4. Subscriber ohne ausreichendes KYC (otp < card) -> 403 KYC ----
test("W5-4: aktiver Subscriber kyc<card (otp) -> 403 KYC, Lockerung greift NICHT", async () => {
  const srv = await startServer({ env: MT, seed: seed({ kycLevel: "otp" }) });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 403, "otp < card -> KYC-Gate sperrt, Abo-Lockerung verlangt card");
    assert.match((await res.json()).error, /KYC/i);
    assert.equal(outboundCalls(srv).length, 0);
  } finally {
    await srv.stop();
  }
});

// ---- 5. Owner/Bestand (kein kyc_level, localhost) byte-identisch ----
test("W5-5a: Owner/Bestand wird NICHT abo-gelockert -> leere Allowlist sperrt wie heute (403)", async () => {
  // Kein MULTI_TENANT, keine Identitaet -> Owner (BOOTSTRAP, active, KEIN kyc_level).
  // ALLOWED_NUMBERS leer (BASE_ENV) -> exakt der Bestands-403 (number-gate.test.js).
  const srv = await startServer({ seed: seed({}) });
  try {
    const res = await placeCall(srv, null);
    assert.equal(res.status, 403, "Owner ohne kyc_level faellt auf die statische Allowlist zurueck");
    assert.match((await res.json()).error, /Allowlist/);
  } finally {
    await srv.stop();
  }
});

test("W5-5b: Owner/Bestand mit ALLOWED_NUMBERS-Eintrag passiert byte-identisch (500)", async () => {
  const srv = await startServer({ env: { ALLOWED_NUMBERS: TO }, seed: seed({}) });
  try {
    const res = await placeCall(srv, null);
    assert.equal(res.status, 500, "Ziel in ALLOWED_NUMBERS -> Legacy-Pfad passiert (bis Originate)");
    const call = outboundCalls(srv)[0];
    assert.equal(call.tenantId, BOOTSTRAP_TENANT_ID);
  } finally {
    await srv.stop();
  }
});

// ---- 6. Harte Gates bleiben scharf: die Abo-Lockerung hebt Land/Stundenlimit NICHT auf ----
test("W5-6a: aktiver Subscriber -> Land-Gate greift weiter (US -> 403 grund=land)", async () => {
  const srv = await startServer({
    env: { ...MT, ALLOWED_COUNTRY_CODES: "+49" },
    seed: seed({ kycLevel: "card" }),
  });
  try {
    const res = await placeCall(srv, SUB_A, US);
    assert.equal(res.status, 403, "Abo lockert NUR die Allowlist, nicht das Land-Gate");
    assert.match((await res.json()).error, /Laendervorwahl/);
    assert.equal(outboundCalls(srv).filter((c) => c.tenantId === A).length, 0);
  } finally {
    await srv.stop();
  }
});

test("W5-6b: aktiver Subscriber -> globales Stundenlimit greift weiter (429)", async () => {
  const srv = await startServer({
    env: { ...MT, MAX_CALLS_PER_HOUR: "1" },
    // ein frischer Outbound-Call fuellt das globale Stundenfenster (Limit 1).
    seed: seed({ kycLevel: "card", calls: [seedCall({ id: "c_recent", startedAt: recent() })] }),
  });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 429, "Abo lockert NUR die Allowlist, nicht das Stundenlimit");
    assert.match((await res.json()).error, /Stundenlimit/);
  } finally {
    await srv.stop();
  }
});
