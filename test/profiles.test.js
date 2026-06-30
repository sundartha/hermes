// Phase 2 (Phase S re-keyed): Rechteprofile pro Tenant. Beweist, dass ein Profil die
// globalen Safety-Gates NUR einschraenken, nie aufweichen kann, und dass die Identitaet
// serverseitig (nicht aus dem Body) und nicht spoofbar ist. Phase S: das Profil keyt auf die
// tenantId - die Gate-Narrowing-Tests laufen darum unter MULTI_TENANT=true mit geseedeten
// Tenants (idpSubject, kyc=card, ownerName, Profil unter tenantId) + eigener aktiver Nummer.
//
// Offline-Twilio-Trick (wie number-gate/audit): eine NICHT mit "AC" beginnende
// TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron VOR jedem Netzzugriff werfen ->
// ein durchgelassener Call endet als 500 (alle Gates passiert), eine Sperre als 403/429.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  startIdp,
  mcpPost,
  toolCall,
  waitForLog,
  MCP_AUDIENCE,
} from "./helpers.js";
import { hashEmail } from "../src/util.js";

const OFFLINE = { TWILIO_ACCOUNT_SID: "x" }; // nicht-AC -> Twilio-Client wirft sync -> durchgelassen = 500
const postCall = (url, to, identity) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: "Test" }),
  });
const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Telefonbarer Nicht-Owner-Tenant: aktiv, CARD-verifiziert, ownerName (passiert KYC- +
// Identitaets-Gate). idpSubject = der X-Internal-Identity-/sub-Aufloesungs-Schluessel.
const subTenant = (id, idpSubject, extra = {}) => ({
  id,
  status: "active",
  idpSubject,
  ownerName: `${id} Owner`,
  kycLevel: "card",
  ...extra,
});
const activeNum = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "twilio",
  status: "active",
  providerNumberId: null,
});

// ---- (b) X-Internal-Identity: nur localhost, extern wird ignoriert (Attribution) ----
// MULTI_TENANT aus -> tenantId=BOOTSTRAP, Profil=OWNER_PROFILE (Owner ist Boot-Subscriber ->
// passiert). Diskriminator ist die ATTRIBUTION (call.requestedBy): aus dem localhost-Header
// (evil@x) ODER, wenn ignoriert (Body/extern), fail-closed der Owner ("owner"). Kein Profil
// noetig - der Seed ist key-neutral.
test("(b) Identitaet nur vom localhost-Header, extern ignoriert (kein Spoof)", async (t) => {
  const callByTo = (srv, to) => srv.readStore().calls.find((c) => c.to === to);
  const TO_HDR = "+4915777777771",
    TO_BODY = "+4915777777772",
    TO_EXT = "+4915777777773";
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49", ...OFFLINE },
    seed: seedState({}),
  });
  try {
    await t.test("localhost: Header setzt die Identitaet -> requestedBy=evil@x", async () => {
      const res = await postCall(srv.localUrl, TO_HDR, "evil@x");
      assert.equal(res.status, 500, "passiert die Gates (bis Originate)");
      assert.equal(callByTo(srv, TO_HDR).requestedBy, "evil@x", "Identitaet kommt aus dem Header");
    });

    await t.test(
      "localhost: Body-Felder (requestedBy/email) gelten NICHT als Identitaet -> requestedBy=owner",
      async () => {
        const res = await fetch(`${srv.localUrl}/api/calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: TO_BODY,
            objective: "Test",
            requestedBy: "evil@x",
            email: "evil@x",
          }),
        });
        assert.equal(res.status, 500);
        assert.equal(
          callByTo(srv, TO_BODY).requestedBy,
          "owner",
          "Identitaet darf nie aus dem Body kommen -> fail-closed Owner",
        );
      },
    );

    await t.test(
      "extern: Header ignoriert -> requestedBy=owner (kein Spoof)",
      { skip: !srv.externalUrl && "keine externe Interface-IP" },
      async () => {
        const res = await postCall(srv.externalUrl, TO_EXT, "evil@x");
        assert.equal(res.status, 500);
        assert.equal(
          callByTo(srv, TO_EXT).requestedBy,
          "owner",
          "externer X-Internal-Identity darf NICHT gelten",
        );
      },
    );
  } finally {
    await srv.stop();
  }
});

// ---- (c) Land bleibt harte Obergrenze; unrestricted lockert NUR die Allowlist ----
// MULTI_TENANT=true -> das Profil (unter der tenantId) wird wirklich konsultiert.
test("(c) Profil-Land * widened nicht; unrestricted lockert nur die Allowlist", async (t) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49", ...OFFLINE },
    seed: seedState({
      tenants: [subTenant("t_alice", "alice@team.test")],
      numbers: [activeNum("num_alice", "+4915110000011", "t_alice")],
      // maxCallsPerHour:null (A4): vom DEFAULT(0)-User-Hour-Gate entkoppelt.
      profiles: { t_alice: { unrestricted: true, allowedCountryCodes: ["*"], maxCallsPerHour: null } },
    }),
  });
  try {
    await t.test("Profil-Land * bei global +49 blockt +1 (Land = Schnittmenge)", async () => {
      const res = await postCall(srv.localUrl, "+12025550123", "alice@team.test");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /Laendervorwahl/);
    });

    await t.test(
      "unrestricted-Profil ruft nicht-gelistete +49-Nummer an (bis Twilio: 500)",
      async () => {
        const res = await postCall(srv.localUrl, "+4915888888888", "alice@team.test");
        assert.equal(res.status, 500);
      },
    );
  } finally {
    await srv.stop();
  }
});

// ---- (d) Globales Stundenlimit bleibt harte Obergrenze (ueber dem Profil-Limit) ----
test("(d) global erschoepft -> Tenant mit hohem Profil-Limit trotzdem 429", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "1", ...OFFLINE },
    seed: seedState({
      calls: [seedCall({ id: "g1" })], // 1 Outbound in der letzten Stunde (global erschoepft)
      tenants: [subTenant("t_fresh", "fresh@team.test")],
      numbers: [activeNum("num_fresh", "+4915110000021", "t_fresh")],
      profiles: { t_fresh: { unrestricted: true, maxCallsPerHour: 100 } },
    }),
  });
  try {
    // fresh hat 0 EIGENE Calls + hohes Profil-Limit, aber global (1>=1) ist erschoepft.
    const res = await postCall(srv.localUrl, "+4915999999999", "fresh@team.test");
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /Stundenlimit/);
  } finally {
    await srv.stop();
  }
});

test("pro-Nutzer-Stundenlimit: Profil kann nur senken (min global/profil)", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "100", ...OFFLINE },
    seed: seedState({
      calls: [seedCall({ id: "u1", requestedBy: "bob@team.test", tenantId: "t_bob" })],
      tenants: [subTenant("t_bob", "bob@team.test")],
      numbers: [activeNum("num_bob", "+4915110000031", "t_bob")],
      profiles: { t_bob: { unrestricted: true, maxCallsPerHour: 1 } },
    }),
  });
  try {
    // bob hat 1 eigenen Call, sein Profil-Limit 1 -> 429, obwohl global (100) nicht erschoepft.
    const res = await postCall(srv.localUrl, "+4915111111111", "bob@team.test");
    assert.equal(res.status, 429);
  } finally {
    await srv.stop();
  }
});

// ---- (e) Settings koennen Profile nicht anfassen ----
test("(e) POST /api/settings {profiles} aendert die Profile nicht", async () => {
  const srv = await startServer({
    seed: seedState({ profiles: { "carol@team.test": { unrestricted: false } } }),
  });
  try {
    const res = await postJson(`${srv.localUrl}/api/settings`, {
      profiles: { "evil@x": { unrestricted: true } },
      evil: "x",
    });
    assert.equal(res.status, 200);
    assert.equal(
      "profiles" in (await res.json()),
      false,
      "settings darf keinen profiles-Key bekommen",
    );
    const stored = srv.readStore();
    assert.equal("evil@x" in stored.profiles, false, "settings darf kein Profil anlegen");
    assert.deepEqual(stored.profiles, { "carol@team.test": { unrestricted: false } });
  } finally {
    await srv.stop();
  }
});

// ---- 2.4 Booking-Gate (MULTI_TENANT=true: das Booking-Recht keyt auf die tenantId) ----
test("Booking-Gate auf POST /api/calendar", async (t) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({
      tenants: [subTenant("t_booker", "booker@team.test"), subTenant("t_def", "default@team.test")],
      profiles: { t_booker: { allowBooking: true } }, // t_def hat KEIN Profil -> DEFAULT (allowBooking=false)
    }),
  });
  const cal = (identity) =>
    fetch(`${srv.localUrl}/api/calendar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(identity ? { "X-Internal-Identity": identity } : {}),
      },
      body: JSON.stringify({
        title: "Termin",
        start: "2026-07-01T10:00:00Z",
        end: "2026-07-01T11:00:00Z",
      }),
    });
  try {
    await t.test("Owner (kein Header -> BOOTSTRAP/OWNER_PROFILE) -> 200", async () => {
      assert.equal((await cal(null)).status, 200);
    });

    await t.test("profilloser Tenant (DEFAULT, allowBooking=false) -> 403", async () => {
      const res = await cal("default@team.test");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /allowBooking/);
    });

    await t.test("Tenant-Profil mit allowBooking=true -> 200", async () => {
      assert.equal((await cal("booker@team.test")).status, 200);
    });
  } finally {
    await srv.stop();
  }
});

// ---- 2.5 Profil-Verwaltung (hinter Basic-Auth; hier localhost). Phase S: Schluessel = tenantId ----
test("Profil-Verwaltung: POST/GET/DELETE + Audit ohne Werte", async (t) => {
  const srv = await startServer();
  try {
    await t.test("POST legt Profil an, sanitisiert Fremd-Keys/falsche Typen", async () => {
      const res = await postJson(`${srv.localUrl}/api/profiles`, {
        tenantId: "t_dora",
        unrestricted: true,
        allowedNumbers: ["+49 151 2222-3333"], // wird normalisiert
        evil: "x", // Fremd-Key -> verworfen
        maxCallsPerHour: "viele", // falscher Typ -> verworfen
      });
      assert.equal(res.status, 200);
      const { profile } = await res.json();
      assert.equal(profile.unrestricted, true);
      assert.deepEqual(profile.allowedNumbers, ["+4915122223333"]);
      assert.equal("evil" in profile, false);
      assert.equal("maxCallsPerHour" in profile, false);
      // Audit: nur tenantId + Keys, KEINE Werte (Nummer darf nicht im Log stehen)
      await waitForLog(srv, /\[audit\] profile_update ip=\S+ tenantId=t_dora keys=/);
      assert.ok(!srv.stdout.includes("+4915122223333"), "Profil-Werte duerfen nicht im Log stehen");
    });

    await t.test("GET listet die Profile", async () => {
      const profiles = await (await fetch(`${srv.localUrl}/api/profiles`)).json();
      assert.ok("t_dora" in profiles);
      assert.equal(profiles["t_dora"].unrestricted, true);
    });

    await t.test("POST ohne gueltige tenantId -> 400", async () => {
      assert.equal(
        (await postJson(`${srv.localUrl}/api/profiles`, { unrestricted: true })).status,
        400,
      );
    });

    await t.test("IdP-sub-foermiger Schluessel (kein @) ist erlaubt; Whitespace nicht", async () => {
      const ok = await postJson(`${srv.localUrl}/api/profiles`, {
        tenantId: "t_user_01TESTKEY",
        unrestricted: true,
      });
      assert.equal(ok.status, 200);
      assert.ok("t_user_01TESTKEY" in srv.readStore().profiles);
      assert.equal(
        (await postJson(`${srv.localUrl}/api/profiles`, { tenantId: "a b", unrestricted: true }))
          .status,
        400,
      );
    });

    await t.test("DELETE entfernt das Profil + Audit", async () => {
      const res = await fetch(`${srv.localUrl}/api/profiles/t_dora`, { method: "DELETE" });
      assert.equal(res.status, 200);
      await waitForLog(srv, /\[audit\] profile_delete ip=\S+ tenantId=t_dora/);
      assert.equal("t_dora" in srv.readStore().profiles, false);
    });

    await t.test("DELETE unbekannt -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/profiles/t_nobody`, { method: "DELETE" });
      assert.equal(res.status, 404);
    });
  } finally {
    await srv.stop();
  }
});

// ---- PROFILES_JSON: Seed beim Start (persistiert ueber Render-Neustarts). Phase S: Keys = tenantIds ----
test("PROFILES_JSON seedet Profile beim Start", async (t) => {
  const srv = await startServer({
    env: {
      MULTI_TENANT: "true",
      // maxCallsPerHour:null (A4): sanitizeProfile haelt null; evil faellt raus. Schluessel = tenantId.
      PROFILES_JSON: JSON.stringify({ t_persist: { unrestricted: true, maxCallsPerHour: null, evil: "x" } }),
      ALLOWED_NUMBERS: "",
      ALLOWED_COUNTRY_CODES: "*",
      ...OFFLINE,
    },
    seed: seedState({
      tenants: [subTenant("t_persist", "persist-sub")],
      numbers: [activeNum("num_persist", "+4915110000041", "t_persist")],
    }),
  });
  try {
    await t.test("GET /api/profiles zeigt das geseedete Profil (sanitisiert)", async () => {
      const profiles = await (await fetch(`${srv.localUrl}/api/profiles`)).json();
      assert.equal(profiles.t_persist?.unrestricted, true);
      assert.equal("evil" in profiles.t_persist, false, "Fremd-Key muss sanitisiert sein");
    });

    await t.test("geseedetes unrestricted-Profil (unter tenantId) hebt die Allowlist auf -> 500", async () => {
      const res = await postCall(srv.localUrl, "+4915123999999", "persist-sub");
      assert.equal(res.status, 500);
    });
  } finally {
    await srv.stop();
  }
});

test("PROFILES_JSON kaputt -> Start crasht nicht, Store bleibt leer", async () => {
  const srv = await startServer({ env: { PROFILES_JSON: "{kein json" } });
  try {
    const profiles = await (await fetch(`${srv.localUrl}/api/profiles`)).json();
    assert.deepEqual(profiles, {});
  } finally {
    await srv.stop();
  }
});

// ---- 2.3 e2e ueber /mcp mit JWT: Identitaet fliesst bis ins Audit (MULTI_TENANT=true) ----
test("e2e /mcp: JWT-Identitaet -> requestedBy im Audit (nicht spoof-/fail-open-bar)", async (t) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: MCP_AUDIENCE,
      MULTI_TENANT: "true",
      ALLOWED_NUMBERS: "",
      ALLOWED_COUNTRY_CODES: "*",
      ...OFFLINE,
    },
    seed: seedState({
      tenants: [subTenant("t_alice", "alice-sub"), subTenant("t_prod", "user_01PROD")],
      numbers: [
        activeNum("num_alice", "+4915110000051", "t_alice"),
        activeNum("num_prod", "+4915110000052", "t_prod"),
      ],
      // maxCallsPerHour:null (A4): provisioniert -> passiert den place_call (Attribution traegt).
      profiles: {
        t_alice: { unrestricted: true, maxCallsPerHour: null },
        t_prod: { unrestricted: true, maxCallsPerHour: null },
      },
    }),
  });
  try {
    await t.test("place_call ueber MCP (JWT email+sub) -> Audit requestedBy=<email>", async () => {
      const token = await idp.sign({ sub: "alice-sub", email: "alice@team.test" });
      const res = await mcpPost(
        `${srv.localUrl}/mcp`,
        token,
        toolCall("place_call", { to: "+4915123123123", objective: "Termin" }),
      );
      assert.notEqual(res.status, 401);
      await waitForLog(
        srv,
        /\[audit\] place_call ip=\S+ to=\+4915123123123 .* requestedBy=alice@team\.test/,
      );
      // T-P0-7: das pro-Request-[mcp]-Diagnose-Log zeigt die E-Mail nur gehasht, nie im Klartext.
      await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("alice@team.test")} tenant=t_alice`));
      assert.ok(
        !/\[mcp\] alice@team\.test/.test(srv.stdout),
        "[mcp]-Log darf die Adresse nicht im Klartext zeigen",
      );
    });

    // Kritische Eigenschaft: ein Token OHNE email/sub darf NIE zum Owner fail-open'en -
    // requestedBy MUSS die echte Identitaet (sub bzw. "anon") tragen, nie "owner". Phase S:
    // ein unbekannter sub loest KEINEN Tenant auf -> tenant=reject -> grund=tenant_unbekannt
    // (statt frueher des sub-keyed DEFAULT_PROFILE-Stundenlimits); die requestedBy-Attribution
    // (der eigentliche Anti-Spoof-Beweis) bleibt unveraendert daran haengen.
    await t.test(
      "JWT OHNE email-Claim, unbekannter sub -> requestedBy=<sub>, tenant=reject, NICHT owner",
      async () => {
        const token = await idp.sign({ sub: "subonly-9" }); // kein email-Claim, kein Tenant
        const res = await mcpPost(
          `${srv.localUrl}/mcp`,
          token,
          toolCall("place_call", { to: "+4915123123124", objective: "Termin" }),
        );
        assert.notEqual(res.status, 401);
        await waitForLog(
          srv,
          /\[audit\] place_call_denied ip=\S+ to=\+4915123123124 grund=tenant_unbekannt requestedBy=subonly-9/,
        );
        assert.ok(
          !/requestedBy=owner/.test(srv.stdout),
          "Token ohne email darf NICHT zum Owner werden",
        );
      },
    );

    await t.test("JWT OHNE email UND sub -> ANON, tenant=reject, kein fail-open zum Owner", async () => {
      const token = await idp.sign({}, { noSubject: true }); // weder email noch sub
      const res = await mcpPost(
        `${srv.localUrl}/mcp`,
        token,
        toolCall("place_call", { to: "+4915123123125", objective: "Termin" }),
      );
      assert.notEqual(res.status, 401);
      await waitForLog(
        srv,
        /\[audit\] place_call_denied ip=\S+ to=\+4915123123125 grund=tenant_unbekannt requestedBy=anon/,
      );
      assert.ok(
        !/requestedBy=owner/.test(srv.stdout),
        "Token ohne Identitaet darf NICHT zum Owner werden",
      );
    });

    // Produktions-Szenario: WorkOS-Token traegt nur sub (kein email). Der Tenant, dessen
    // idpSubject auf diese sub keyt, traegt ein unrestricted-Profil -> Allowlist aufgehoben.
    await t.test(
      "Profil per Tenant (Token-sub -> idpSubject) hebt die Allowlist auf -> place_call",
      async () => {
        const token = await idp.sign({ sub: "user_01PROD" }); // identity = sub, loest t_prod auf
        const res = await mcpPost(
          `${srv.localUrl}/mcp`,
          token,
          toolCall("place_call", { to: "+4915123123126", objective: "Termin" }),
        );
        assert.notEqual(res.status, 401);
        await waitForLog(
          srv,
          /\[audit\] place_call ip=\S+ to=\+4915123123126 .* requestedBy=user_01PROD/,
        );
      },
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});
