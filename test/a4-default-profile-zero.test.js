// A4 (go-live-Haertung): DEFAULT_PROFILE.maxCallsPerHour = 0. Pinnt die zwei Invarianten:
// (a) der DEFAULT-Wert ist 0 und 0 ist kein Falsy-Missverstaendnis (echte Schwelle), (b) am
// HTTP-Gate blockt ein profil-loser Tenant hart bei 0 Calls (429 stundenlimit_nutzer),
// waehrend ein A2/A3-provisionierter Subscriber (maxCallsPerHour=null) UND der Owner
// (OWNER_PROFILE) das Gate passieren. Phase S: das Profil keyt auf die tenantId, deshalb
// laufen die Integration-Faelle unter MULTI_TENANT=true mit geseedeten Tenants (idpSubject,
// kyc=card, ownerName, Profil unter tenantId) - genau der Production-Pfad. Reine Unit
// (resolveProfileFrom) + Spawn-Integration in EINER Datei, KEIN pglite (Lehre p6a).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { resolveProfileFrom, BOOTSTRAP_TENANT_ID, KYC_LEVEL } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

const TO = "+4915112345678"; // erlaubtes Ziel, kein Premium/Notruf
// nicht-AC TWILIO_ACCOUNT_SID -> der Twilio-Client wirft synchron VOR jedem Netzzugriff
// -> ein durchgelassener Call endet als 500 (alle Gates passiert), eine Sperre als 429.
const OFFLINE = { TWILIO_ACCOUNT_SID: "x" };
const MT = { MULTI_TENANT: "true", ALLOWED_COUNTRY_CODES: "*", ...OFFLINE };

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
  provider: "twilio",
  status: "active",
  providerNumberId: null,
});

// (1) Reine Unit: DEFAULT_PROFILE traegt maxCallsPerHour=0 (nicht falsy-Luecke); der Owner
// (tenantId === BOOTSTRAP) bleibt von A4 unberuehrt (OWNER_PROFILE, null = nur globaler Cap);
// ein A2/A3-Tier-Profil (planProfileFor) ueberschreibt den DEFAULT-0-Block auf null.
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

// (2) Integration: profil-loser Tenant blockt HART bei 0 Calls (429), kein Call-Record.
// MULTI_TENANT=true -> X-Internal-Identity loest den geseedeten Tenant auf; ohne Profil
// greift DEFAULT_PROFILE(0) am User-Hour-Gate.
test("A4: profil-loser Tenant -> 429 bei 0 Calls (harter Block)", async () => {
  const srv = await startServer({
    env: MT,
    seed: seedState({
      tenants: [subscriberTenant("t_np", "sub-np")], // KEIN Profil unter t_np
      numbers: [activeNumber("num_np", "+4915110000091", "t_np")],
    }),
  });
  try {
    const res = await postCall(srv.localUrl, TO, "sub-np");
    assert.equal(res.status, 429, "DEFAULT_PROFILE(maxCallsPerHour=0) blockt sofort");
    assert.match((await res.json()).error, /Stundenlimit/);
    assert.equal(outboundCalls(srv).length, 0, "Block VOR createCall -> kein Call-Record");
  } finally {
    await srv.stop();
  }
});

// (3) Integration: provisionierter Subscriber (A2/A3-Tier-Profil) telefoniert weiter (500);
// der Owner ohne Header ebenfalls (OWNER_PROFILE via BOOTSTRAP), unberuehrt von A4.
test("A4: provisioniertes Tier-Profil + Owner passieren das Gate (500)", async () => {
  const srv = await startServer({
    env: MT,
    seed: seedState({
      tenants: [subscriberTenant("t_paid", "sub-paid")],
      numbers: [activeNumber("num_paid", "+4915110000092", "t_paid")],
      profiles: { t_paid: planProfileFor("starter") }, // Profil unter der tenantId (Phase S)
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
