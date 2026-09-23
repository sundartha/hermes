// Phase 2 (Phase S re-keyed): Rechteprofile pro Tenant. Beweist, dass ein Profil die
// globalen Safety-Gates NUR einschraenken, nie aufweichen kann, und dass die Identitaet
// serverseitig (nicht aus dem Body) und nicht spoofbar ist. Phase S: das Profil keyt auf die
// tenantId - die Gate-Narrowing-Tests laufen darum unter MULTI_TENANT=true mit geseedeten
// Tenants (idpSubject, kyc=card, ownerName, Profil unter tenantId) + eigener aktiver Nummer.
//
// Offline-Diskriminator: 500 = alle Gates passiert (originateCall wirft ohne
// TELNYX_API_KEY, s. BASE_ENV in helpers.js), 403/429 = ein Gate hat gesperrt.
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
  readToolResult,
  assertReauthChallenge,
} from "./helpers.js";
import { hashEmail } from "../src/util.js";
import { makeDefaultState, updateSettings } from "../src/store/state-ops.js";
import { defaultSettings, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
// Zielnummer des place_call MIT Mandant im e2e-/mcp-Test - zugleich Positiv-Kontrolle
// fuer die "to=<nummer>"-Negativpruefung in assertNoTenantPlaceCallStubbed.
const TENANT_CALL_TO = "+4915123123123";
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500; // Offline-Diskriminator: alle Gates passiert (kein TELNYX_API_KEY)

const postCall = (url, to, identity) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: "Test" }),
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
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

// ---- (b) X-Internal-Identity: nur localhost, extern wird ignoriert (Attribution) ----
// E4: der Identitaets-Header gilt unbedingt und loest die Tenant-Achse ECHT auf - "evil@x"
// ist deshalb per OWNER_IDP_SUBJECT an den Bootstrap-Tenant gebunden (Profil=OWNER_PROFILE,
// Owner ist Boot-Subscriber -> passiert). Diskriminator bleibt die ATTRIBUTION
// (call.requestedBy): aus dem localhost-Header (evil@x) ODER, wenn ignoriert (Body/extern),
// fail-closed der Owner ("owner").
test("(b) Identitaet nur vom localhost-Header, extern ignoriert (kein Spoof)", async (ctx) => {
  const callByTo = (srv, to) => srv.readStore().calls.find((call) => call.to === to);
  const TO_HDR = "+4915777777771",
    TO_BODY = "+4915777777772",
    TO_EXT = "+4915777777773";
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49", OWNER_IDP_SUBJECT: "evil@x" },
    seed: seedState({}),
  });
  try {
    await ctx.test("localhost: Header setzt die Identitaet -> requestedBy=evil@x", async () => {
      const res = await postCall(srv.localUrl, TO_HDR, "evil@x");
      assert.equal(res.status, HTTP_SERVER_ERROR, "passiert die Gates (bis Originate)");
      assert.equal(callByTo(srv, TO_HDR).requestedBy, "evil@x", "Identitaet kommt aus dem Header");
    });

    await ctx.test(
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
        assert.equal(res.status, HTTP_SERVER_ERROR);
        assert.equal(
          callByTo(srv, TO_BODY).requestedBy,
          "owner",
          "Identitaet darf nie aus dem Body kommen -> fail-closed Owner",
        );
      },
    );

    await ctx.test(
      "extern: kein Tenant -> 403, gar kein Call (kein Spoof)",
      { skip: !srv.externalUrl && "keine externe Interface-IP" },
      async () => {
        // AUTH-P3: der externe Aufrufer traegt keine Identitaet -> operatorChannelTenant
        // liefert TENANT_REJECT statt Bootstrap -> das Gate "tenant_reject" greift VOR
        // resolve_identity's Originate, also vor dem frueheren 500. Das ist keine
        // Abschwaechung der Spoof-Aussage, sondern deren fruehere Durchsetzung: der
        // externe X-Internal-Identity-Header gilt weiterhin nicht, UND es entsteht
        // ueberhaupt kein Call mehr (statt eines Calls mit requestedBy=owner).
        // AUTH-P5: der 403 kommt seit dieser Phase bereits von internalOnly (vor dem
        // Handler), nicht mehr vom tenant_reject-Gate im Handler-Rumpf - die Aussage
        // "kein Spoof, kein Call" bleibt unveraendert wahr, misst nur eine Schicht
        // frueher.
        const res = await postCall(srv.externalUrl, TO_EXT, "evil@x");
        assert.equal(res.status, HTTP_FORBIDDEN);
        assert.equal(
          callByTo(srv, TO_EXT),
          undefined,
          "extern entsteht gar kein Call mehr (tenant_reject vor resolve_identity's Originate)",
        );
      },
    );
  } finally {
    await srv.stop();
  }
});

// ---- (c) Land bleibt harte Obergrenze; unrestricted lockert NUR die Allowlist ----
// MULTI_TENANT=true -> das Profil (unter der tenantId) wird wirklich konsultiert.
test("(c) Profil-Land * widened nicht; unrestricted lockert nur die Allowlist", async (ctx) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49" },
    seed: seedState({
      tenants: [subTenant("t_alice", "alice@team.test")],
      numbers: [activeNum("num_alice", "+4915110000011", "t_alice")],
      // maxCallsPerHour:null (A4): vom DEFAULT(0)-User-Hour-Gate entkoppelt.
      profiles: { t_alice: { unrestricted: true, allowedCountryCodes: ["*"], maxCallsPerHour: null } },
    }),
  });
  try {
    await ctx.test("Profil-Land * bei global +49 blockt +1 (Land = Schnittmenge)", async () => {
      const res = await postCall(srv.localUrl, "+12025550123", "alice@team.test");
      assert.equal(res.status, HTTP_FORBIDDEN);
      assert.match((await res.json()).error, /Country code/);
    });

    await ctx.test(
      "unrestricted-Profil ruft nicht-gelistete +49-Nummer an (bis Twilio: 500)",
      async () => {
        const res = await postCall(srv.localUrl, "+4915888888888", "alice@team.test");
        assert.equal(res.status, HTTP_SERVER_ERROR);
      },
    );
  } finally {
    await srv.stop();
  }
});

// ---- (d) MAX_CALLS_PER_HOUR bleibt harte Obergrenze (ueber dem Profil-Limit) ----
test("(d) Config-Limit deckelt ein hoeheres Profil-Limit -> 429", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "1" },
    seed: seedState({
      // 1 Outbound DIESES Tenants in der letzten Stunde -> min(config=1, profil=100) = 1 erschoepft
      calls: [seedCall({ id: "g1", tenantId: "t_fresh" })],
      tenants: [subTenant("t_fresh", "fresh@team.test")],
      numbers: [activeNum("num_fresh", "+4915110000021", "t_fresh")],
      profiles: { t_fresh: { unrestricted: true, maxCallsPerHour: 100 } },
    }),
  });
  try {
    // MAX_CALLS_PER_HOUR=1 deckelt das Profil-Limit 100 - ein Profil kann nur senken.
    const res = await postCall(srv.localUrl, "+4915999999999", "fresh@team.test");
    assert.equal(res.status, HTTP_TOO_MANY_REQUESTS);
    assert.match((await res.json()).error, /Hourly limit/);
  } finally {
    await srv.stop();
  }
});

test("pro-Nutzer-Stundenlimit: Profil kann nur senken (min global/profil)", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "100" },
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
    assert.equal(res.status, HTTP_TOO_MANY_REQUESTS);
  } finally {
    await srv.stop();
  }
});

// ---- (e) Settings koennen Profile nicht anfassen ----
// AUTH-P4: die HTTP-Naht (POST /api/settings) ist geloescht - die Whitelist-Zusage
// (updateSettings kann keinen profiles-Key schreiben) wird jetzt direkt auf der
// Store-Ebene gemessen (Muster test/f1-geo-store.test.js), damit sie nicht mit der
// Route mitverschwindet.
test("(e) updateSettings({profiles}) aendert die Profile nicht", () => {
  const state = makeDefaultState();
  state.settings[BOOTSTRAP_TENANT_ID] = defaultSettings();
  state.profiles = { "carol@team.test": { unrestricted: false } };
  const { changed } = updateSettings(state, BOOTSTRAP_TENANT_ID, {
    profiles: { "evil@x": { unrestricted: true } },
    evil: "x",
  });
  assert.equal(changed.includes("profiles"), false, "settings darf keinen profiles-Key uebernehmen");
  assert.equal("evil@x" in state.profiles, false, "settings darf kein Profil anlegen");
  assert.deepEqual(state.profiles, { "carol@team.test": { unrestricted: false } });
});

// ---- PROFILES_JSON: Seed beim Start (persistiert ueber Render-Neustarts). Phase S: Keys = tenantIds ----
test("PROFILES_JSON seedet Profile beim Start", async (ctx) => {
  const srv = await startServer({
    env: {
      MULTI_TENANT: "true",
      // maxCallsPerHour:null (A4): sanitizeProfile haelt null; evil faellt raus. Schluessel = tenantId.
      PROFILES_JSON: JSON.stringify({ t_persist: { unrestricted: true, maxCallsPerHour: null, evil: "x" } }),
      ALLOWED_NUMBERS: "",
      ALLOWED_COUNTRY_CODES: "*",
    },
    seed: seedState({
      tenants: [subTenant("t_persist", "persist-sub")],
      numbers: [activeNum("num_persist", "+4915110000041", "t_persist")],
    }),
  });
  try {
    // AUTH-P4: GET /api/profiles ist geloescht - PROFILES_JSON wird NUR in-memory
    // geseedet (seedProfilesFromEnv() ruft KEIN save()); srv.readStore() liest aber die
    // DATEI. Reihenfolge deshalb bewusst: erst der place_call (createCall() persistiert
    // synchron ueber save(), das den GESAMTEN State inkl. profiles schreibt), DANACH aus
    // der Datei lesen - sonst traeft die Datei noch die urspruengliche, profil-lose Form.
    await ctx.test("geseedetes unrestricted-Profil (unter tenantId) hebt die Allowlist auf -> 500", async () => {
      const res = await postCall(srv.localUrl, "+4915123999999", "persist-sub");
      assert.equal(res.status, HTTP_SERVER_ERROR);
    });

    await ctx.test("Store traegt das geseedete Profil (sanitisiert)", () => {
      const profiles = srv.readStore().profiles;
      assert.equal(profiles.t_persist?.unrestricted, true);
      assert.equal("evil" in profiles.t_persist, false, "Fremd-Key muss sanitisiert sein");
    });
  } finally {
    await srv.stop();
  }
});

test("PROFILES_JSON kaputt -> Start crasht nicht, Store bleibt leer", async () => {
  const srv = await startServer({ env: { PROFILES_JSON: "{kein json" } });
  try {
    // AUTH-P4: GET /api/profiles ist geloescht - direkt aus dem Store lesen.
    assert.deepEqual(srv.readStore().profiles, {});
  } finally {
    await srv.stop();
  }
});

// T2-05 (T-14): geteilte Pruefung fuer die zwei "kein Mandant"-Faelle unten - haelt die
// umschliessende Testfunktion unter dem Zeilenlimit (G30) UND vermeidet Kopie/Einfuegen
// derselben vier Assertions. place_call laeuft NIE (Stub ruft nie api()), deshalb darf
// im Stdout weder "requestedBy=owner" noch ein "place_call"-Audit fuer DIESE Nummer stehen.
// Positiv-Kontrolle fuer die "to=<nummer>"-Negativpruefung: derselbe Server hat im
// vorangehenden Teiltest MIT Mandant (TENANT_CALL_TO) einen echten place_call auditiert -
// die Form "to=<nummer>" MUSS dort im Stdout stehen, sonst saehe die Negativpruefung
// unten nur deshalb gruen aus, weil das Log diese Form gar nicht schreibt.
async function assertNoTenantPlaceCallStubbed(srv, token, { to, ownerMsg }) {
  const res = await mcpPost(
    `${srv.localUrl}/mcp`,
    token,
    toolCall("place_call", { to, objective: "Termin" }),
  );
  assert.equal(res.status, HTTP_OK);
  assertReauthChallenge(await readToolResult(res));
  await waitForLog(srv, /\[audit\] auth_failed ip=\S+ path=\/mcp grund=kein_tenant/);
  assert.ok(!/requestedBy=owner/.test(srv.stdout), ownerMsg);
  assert.ok(
    srv.stdout.includes(`to=${TENANT_CALL_TO}`),
    "Positiv-Kontrolle: der place_call MIT Mandant muss 'to=<nummer>' im Log hinterlassen",
  );
  assert.ok(!srv.stdout.includes(`to=${to}`), "der Stub loest NIE einen echten Anruf aus");
}

// ---- 2.3 e2e ueber /mcp mit JWT: Identitaet fliesst bis ins Audit (MULTI_TENANT=true) ----
test("e2e /mcp: JWT-Identitaet -> requestedBy im Audit (nicht spoof-/fail-open-bar)", async (ctx) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: MCP_AUDIENCE,
      MULTI_TENANT: "true",
      ALLOWED_NUMBERS: "",
      ALLOWED_COUNTRY_CODES: "*",
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
    await ctx.test("place_call ueber MCP (JWT email+sub) -> Audit requestedBy=<email>", async () => {
      const token = await idp.sign({ sub: "alice-sub", email: "alice@team.test" });
      const res = await mcpPost(
        `${srv.localUrl}/mcp`,
        token,
        toolCall("place_call", { to: TENANT_CALL_TO, objective: "Termin" }),
      );
      assert.notEqual(res.status, HTTP_UNAUTHORIZED);
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

    // Kritische Eigenschaft: ein Token OHNE email/sub darf NIE zum Owner fail-open'en. E4/
    // T2-05: der /mcp-Torschluss (routes/mcp.js) erkennt eine unbekannte Identitaet JETZT
    // schon am Gateway (Audit "grund=kein_tenant", VOR jedem echten Tool-Zugriff) - seit
    // T2-05 registriert er im OAuth-Modus die Stub-Fassade (registerNoTenantStubs) statt
    // 403 zu senden: place_call laeuft NIE (der Stub ruft nie api()), also entsteht auch
    // kein "place_call"-Audit mehr. Der Anti-Spoof-Beweis bleibt derselbe (nie Owner).
    await ctx.test(
      "JWT OHNE email-Claim, unbekannter sub -> Tool-Fehler mit Re-Auth-Challenge, NICHT owner",
      async () => {
        const token = await idp.sign({ sub: "subonly-9" }); // kein email-Claim, kein Tenant
        await assertNoTenantPlaceCallStubbed(srv, token, {
          to: "+4915123123124",
          ownerMsg: "Token ohne email darf NICHT zum Owner werden",
        });
      },
    );

    await ctx.test(
      "JWT OHNE email UND sub -> ANON, Tool-Fehler mit Re-Auth-Challenge, kein fail-open zum Owner",
      async () => {
        const token = await idp.sign({}, { noSubject: true }); // weder email noch sub
        await assertNoTenantPlaceCallStubbed(srv, token, {
          to: "+4915123123125",
          ownerMsg: "Token ohne Identitaet darf NICHT zum Owner werden",
        });
      },
    );

    // Produktions-Szenario: WorkOS-Token traegt nur sub (kein email). Der Tenant, dessen
    // idpSubject auf diese sub keyt, traegt ein unrestricted-Profil -> Allowlist aufgehoben.
    await ctx.test(
      "Profil per Tenant (Token-sub -> idpSubject) hebt die Allowlist auf -> place_call",
      async () => {
        const token = await idp.sign({ sub: "user_01PROD" }); // identity = sub, loest t_prod auf
        const res = await mcpPost(
          `${srv.localUrl}/mcp`,
          token,
          toolCall("place_call", { to: "+4915123123126", objective: "Termin" }),
        );
        assert.notEqual(res.status, HTTP_UNAUTHORIZED);
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
