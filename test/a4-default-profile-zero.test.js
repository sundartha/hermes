// A4 (go-live-Haertung): DEFAULT_PROFILE.maxCallsPerHour = 0. Pinnt die zwei
// Invarianten: (a) der DEFAULT-Wert ist 0 und 0 ist kein Falsy-Missverstaendnis
// (echte Schwelle), (b) am HTTP-Gate blockt ein profil-loser authentifizierter
// Caller hart bei 0 Calls (429 stundenlimit_nutzer), waehrend ein A2/A3-
// provisionierter Subscriber (maxCallsPerHour=null) UND der Owner (OWNER_PROFILE)
// das Gate passieren. Reine Unit (resolveProfileFrom) + Spawn-Integration in EINER
// Datei, KEIN pglite (Lehre p6a: pglite + Server-Spawn NIE mischen; pure Unit +
// Spawn ist erlaubt, vgl. b2-quota-gate.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { resolveProfileFrom } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

const TO = "+4915112345678"; // erlaubtes Ziel (ALLOWED_NUMBERS), kein Premium/Notruf
// nicht-AC TWILIO_ACCOUNT_SID -> der Twilio-Client wirft synchron VOR jedem Netzzugriff
// -> ein durchgelassener Call endet als 500 (alle Gates passiert), eine Sperre als 429.
const OFFLINE = { TWILIO_ACCOUNT_SID: "x" };

const postCall = (url, to, identity) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: "Test" }),
  });

const outboundCalls = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound");

// (1) Reine Unit: DEFAULT_PROFILE traegt maxCallsPerHour=0 (nicht 2, nicht falsy-Luecke);
// der Owner (leere email) bleibt von A4 unberuehrt (OWNER_PROFILE, null = nur globaler Cap);
// ein A2/A3-Tier-Profil (planProfileFor) ueberschreibt den DEFAULT-0-Block auf null.
test("A4: resolveProfileFrom - DEFAULT=0 harter Block, Owner/Tier unberuehrt", () => {
  assert.equal(
    resolveProfileFrom("nobody@x", undefined).maxCallsPerHour,
    0,
    "profil-loser, bekannter Nutzer -> DEFAULT_PROFILE.maxCallsPerHour === 0",
  );
  assert.equal(
    resolveProfileFrom("", undefined).maxCallsPerHour,
    null,
    "leere email -> OWNER_PROFILE, von A4 unberuehrt (null = nur globaler Cap)",
  );
  assert.equal(
    resolveProfileFrom("paid@x", planProfileFor("starter")).maxCallsPerHour,
    null,
    "A2/A3-Tier-Profil (maxCallsPerHour=null) hebt den DEFAULT-0-Block auf",
  );
});

// (2) Integration: profil-loser authentifizierter Caller blockt HART bei 0 Calls (429),
// kein Call-Record. Beweist den harten Block (0 als echte Schwelle, nicht "kein Limit").
// MULTI_TENANT aus -> tenantId=BOOTSTRAP (Owner ist beim Boot KYC+Identitaet-geheilt) ->
// die Gate-Kette erreicht den profil-getriebenen userHourReached, der bei 0 sperrt.
test("A4: profil-loser authentifizierter Nutzer -> 429 bei 0 Calls (harter Block)", async () => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: TO, ALLOWED_COUNTRY_CODES: "*", ...OFFLINE },
    seed: seedState({}), // keine profiles, KEINE Calls -> Stundenfenster leer
  });
  try {
    const res = await postCall(srv.localUrl, TO, "nobody@x");
    assert.equal(res.status, 429, "DEFAULT_PROFILE(maxCallsPerHour=0) blockt sofort");
    assert.match((await res.json()).error, /Stundenlimit/);
    assert.equal(outboundCalls(srv).length, 0, "Block VOR createCall -> kein Call-Record");
  } finally {
    await srv.stop();
  }
});

// (3) Integration: provisionierter Subscriber (A2/A3-Tier-Profil) telefoniert weiter (500);
// der Owner ohne Identitaet ebenfalls (OWNER_PROFILE), unberuehrt von A4.
test("A4: provisioniertes Tier-Profil + Owner passieren das Gate (500)", async () => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: TO, ALLOWED_COUNTRY_CODES: "*", ...OFFLINE },
    seed: seedState({ profiles: { "paid@x": planProfileFor("starter") } }),
  });
  try {
    assert.equal(
      (await postCall(srv.localUrl, TO, "paid@x")).status,
      500,
      "provisioniert (maxCallsPerHour=null) -> passiert, scheitert erst am Offline-Originate",
    );
    assert.equal(
      (await postCall(srv.localUrl, TO, null)).status,
      500,
      "Owner (leere email) -> OWNER_PROFILE, unberuehrt -> passiert",
    );
  } finally {
    await srv.stop();
  }
});
