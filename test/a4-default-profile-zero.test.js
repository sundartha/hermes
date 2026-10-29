import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import {
  resolveProfileFrom,
  sanitizeProfile,
  BOOTSTRAP_TENANT_ID,
  KYC_LEVEL,
} from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const TO = "+4915112345678";
const MT = { MULTI_TENANT: "true", ALLOWED_COUNTRY_CODES: "*" };

const postCall = (url, to, identity) =>
  abrufMitFrist(`${url}/api/calls`, {
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

const TENANT_OHNE_PROFIL = "t_ohne_profil";

test("[NIE1] Standardprofil ohne Rechte mit 0 Calls pro Stunde, Owner-Profil mit allen vier Rechten", () => {
  assert.deepEqual(resolveProfileFrom(TENANT_OHNE_PROFIL, undefined), {
    allowedNumbers: [],
    allowedCountryCodes: [],
    unrestricted: false,
    allowCalendar: false,
    allowConsult: false,
    allowLookup: false,
    allowBooking: false,
    maxCallsPerHour: 0,
  });
  assert.deepEqual(resolveProfileFrom(BOOTSTRAP_TENANT_ID, undefined), {
    allowedNumbers: [],
    allowedCountryCodes: [],
    unrestricted: false,
    allowCalendar: true,
    allowConsult: true,
    allowLookup: true,
    allowBooking: true,
    maxCallsPerHour: null,
  });
});

test("[NIE2] resolveProfileFrom liefert je Aufruf ein neues Objekt, die Listen bleiben geteilt", () => {
  const ersterOwner = resolveProfileFrom(BOOTSTRAP_TENANT_ID, undefined);
  ersterOwner.allowCalendar = false;
  assert.equal(resolveProfileFrom(BOOTSTRAP_TENANT_ID, undefined).allowCalendar, true);

  const ersterStandard = resolveProfileFrom(TENANT_OHNE_PROFIL, undefined);
  ersterStandard.allowCalendar = true;
  const zweiterStandard = resolveProfileFrom(TENANT_OHNE_PROFIL, undefined);
  assert.equal(zweiterStandard.allowCalendar, false);
  assert.notEqual(zweiterStandard, ersterStandard);
  assert.equal(zweiterStandard.allowedNumbers, ersterStandard.allowedNumbers);
  assert.equal(zweiterStandard.allowedCountryCodes, ersterStandard.allowedCountryCodes);

  const gespeichert = { allowedNumbers: ["+4915112345678"], allowedCountryCodes: ["DE"] };
  const ausGespeichertem = resolveProfileFrom(TENANT_OHNE_PROFIL, gespeichert);
  assert.notEqual(ausGespeichertem, gespeichert);
  assert.equal(ausGespeichertem.allowedNumbers, gespeichert.allowedNumbers);
  assert.equal(ausGespeichertem.allowedCountryCodes, gespeichert.allowedCountryCodes);
  assert.equal(ausGespeichertem.allowCalendar, false);
  assert.equal(ausGespeichertem.maxCallsPerHour, 0);
});

test("[NIE3] sanitizeProfile uebernimmt nur Felder aus PROFILE_FIELDS mit passendem Typ", () => {
  assert.deepEqual(
    sanitizeProfile({
      unrestricted: true,
      allowCalendar: true,
      allowConsult: false,
      allowLookup: true,
      allowBooking: false,
      maxCallsPerHour: 7,
      unbekannt: true,
    }),
    {
      unrestricted: true,
      allowCalendar: true,
      allowConsult: false,
      allowLookup: true,
      allowBooking: false,
      maxCallsPerHour: 7,
    },
  );
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: null }), { maxCallsPerHour: null });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: "7", unrestricted: "yes" }), {});
  assert.deepEqual(
    sanitizeProfile({ allowedNumbers: "+4915112345678", allowedCountryCodes: 49 }),
    {},
  );
  assert.deepEqual(sanitizeProfile(undefined), {});
});

test("[NIE3] sanitizeProfile verwirft ein Listenfeld ganz, wenn ein Eintrag kein String ist", () => {
  assert.deepEqual(sanitizeProfile({ allowedNumbers: ["+4915112345678", 5] }), {});
  assert.deepEqual(sanitizeProfile({ allowedCountryCodes: ["DE", null] }), {});
  assert.deepEqual(
    sanitizeProfile({ allowedNumbers: ["+4915112345678"], allowedCountryCodes: ["DE", 1] }),
    { allowedNumbers: ["+4915112345678"] },
  );
});

test("[NIE3] sanitizeProfile bereinigt allowedNumbers mit normNum und allowedCountryCodes nur per trim", () => {
  assert.deepEqual(sanitizeProfile({ allowedNumbers: ["+49 151-1234 (5678)", "  ", ""] }), {
    allowedNumbers: ["+4915112345678"],
  });
  assert.deepEqual(sanitizeProfile({ allowedCountryCodes: [" DE ", "", "  ", "4 9"] }), {
    allowedCountryCodes: ["DE", "4 9"],
  });
});

test("[NIE3] sanitizeProfile verwirft geerbte Schluessel aus JSON.parse still", () => {
  const eingabe = JSON.parse(
    '{"constructor":{},"toString":1,"__proto__":{"allowCalendar":true},"allowBooking":true}',
  );
  assert.deepEqual(sanitizeProfile(eingabe), { allowBooking: true });
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
