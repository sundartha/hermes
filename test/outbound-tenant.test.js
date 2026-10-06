import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TO = "+4915112345678";
const OWNER_NUMBER = "+15005550006";

const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A = "+4915110000001";
const B = "tenant-b",
  SUB_B = "sub-b",
  NUM_B = "+4915110000002";
const C = "tenant-c",
  SUB_C = "sub-c",
  NUM_C = "+4915110000003";

const activeNumber = (id, e164, tenantId, status = "active") => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status,
  providerNumberId: null,
});

const PROVISIONED_PROFILE = { maxCallsPerHour: null };

function seedTenants({ extraNumbers = [], usage } = {}) {
  const s = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: A, status: "active", idpSubject: SUB_A, ownerName: "Alice", kycLevel: "card" },
      { id: B, status: "active", idpSubject: SUB_B, ownerName: "Bob", kycLevel: "card" },
      { id: C, status: "active", idpSubject: SUB_C, ownerName: "Carol", kycLevel: "card" },
    ],
    numbers: [activeNumber("num_a", NUM_A, A), activeNumber("num_b", NUM_B, B), ...extraNumbers],
    profiles: { [A]: PROVISIONED_PROFILE, [B]: PROVISIONED_PROFILE, [C]: PROVISIONED_PROFILE },
  });
  if (usage) s.usage = usage;
  return s;
}

const bucket = (costEur) => ({ inputTokens: 0, outputTokens: 0, costEur, calls: costEur ? 1 : 0 });

function placeCall(srv, identity, body = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const FLAG_ON = { MULTI_TENANT: "true", ALLOWED_NUMBERS: TO };

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

test("Flag an: Outbound attribuiert from + tenantId pro Tenant (A->A-Nummer/A-Budget, B->B-Nummer); B nicht geblockt", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedTenants() });
  try {
    const resA = await placeCall(srv, SUB_A);
    const resB = await placeCall(srv, SUB_B);
    assert.equal(resA.status, 500, "A passiert Gates+Budget, scheitert erst am Offline-Originate");
    assert.equal(resB.status, 500, "B nicht budget-/nummer-geblockt (fresh) -> erreicht Originate");

    const calls = outboundCallsTo(srv);
    const callA = calls.find((c) => c.tenantId === A);
    const callB = calls.find((c) => c.tenantId === B);
    assert.ok(callA, "Call mit tenantId=A erzeugt");
    assert.equal(
      callA.from,
      NUM_A,
      "A telefoniert unter EIGENER aktiver Nummer (-> A-Budget via tenantId)",
    );
    assert.ok(callB, "Call mit tenantId=B erzeugt");
    assert.equal(callB.from, NUM_B, "B telefoniert unter EIGENER aktiver Nummer");
    assert.ok(
      !calls.some((c) => c.from === OWNER_NUMBER),
      "NIE Owner-Nummer fuer einen Fremd-Tenant",
    );
  } finally {
    await srv.stop();
  }
});

test("Flag an: Tenant ohne eigene AKTIVE Nummer -> 403 Reject, KEIN Call, NIE Owner-Nummer", async () => {
  const seed = seedTenants({ extraNumbers: [activeNumber("num_c", NUM_C, C, "suspended")] });
  const srv = await startServer({ env: FLAG_ON, seed });
  try {
    const res = await placeCall(srv, SUB_C);
    assert.equal(res.status, 403, "keine aktive eigene Nummer -> Reject (NICHT Owner-Nummer)");
    assert.match((await res.json()).error, /Nummer/i);

    assert.equal(outboundCallsTo(srv).length, 0, "Reject VOR createCall -> kein Call erzeugt");
    assert.ok(
      !srv.readStore().calls.some((c) => c.from === OWNER_NUMBER),
      "NIE Owner-Nummer als Fremd-Tenant-Fallback",
    );
  } finally {
    await srv.stop();
  }
});

test("Flag an: unbekannte Identitaet -> 403 Reject (NIE Owner-Tenant)", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedTenants() });
  try {
    const res = await placeCall(srv, "sub-voellig-unbekannt");
    assert.equal(res.status, 403, "unbekannter idpSubject -> Reject, kein Owner-Fallback");
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call erzeugt");
  } finally {
    await srv.stop();
  }
});

test("Flag an: erschoepftes Tenant-Budget blockt den Tenant (402), KEIN Call", async () => {
  const seed = seedTenants({ usage: { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(99) } });
  const srv = await startServer({ env: FLAG_ON, seed });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 402, "A-Budget erschoepft -> A geblockt");
    assert.equal(
      outboundCallsTo(srv).length,
      0,
      "kein Call bei Budget-Block (Reject vor createCall)",
    );
  } finally {
    await srv.stop();
  }
});

test("KS-P9: die Plattform-Summe sperrt nicht mehr - A telefoniert trotz gerissener Summe", async () => {
  const seed = seedTenants({
    usage: { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(20), [B]: bucket(20) },
  });
  const srv = await startServer({ env: FLAG_ON, seed });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 500, "Gate-Kette durchlaufen, Originate offline erreicht");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "genau EIN Outbound-Call erzeugt");
    assert.equal(calls[0].tenantId, A, "auf A attribuiert");
  } finally {
    await srv.stop();
  }
});

test("Ohne MULTI_TENANT gesetzt: Identitaets-Header attribuiert unbedingt auf den echten Tenant, NIE auf den Owner", async () => {
  const srv = await startServer({ env: { ALLOWED_NUMBERS: TO }, seed: seedTenants() });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 500, "Tenant-A-Pfad erreicht den Originate (offline 500)");

    const call = outboundCallsTo(srv)[0];
    assert.ok(call, "Call erzeugt");
    assert.equal(call.tenantId, A, "die Identitaet loest unbedingt auf den echten Tenant auf");
    assert.notEqual(call.tenantId, BOOTSTRAP_TENANT_ID, "NIE der Owner-Tenant");
    assert.equal(call.from, NUM_A, "unter A's eigener Nummer, NICHT der Owner-Nummer");
    assert.notEqual(call.from, OWNER_NUMBER);
  } finally {
    await srv.stop();
  }
});
