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
import { maskNumber } from "../src/util.js";
import { makeDefaultState, updateSettings } from "../src/store/state-ops.js";
import { defaultSettings, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const TENANT_CALL_TO = "+4915123123123";
const sternImMuster = (text) => text.replace(/\*/g, "\\*");
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

async function confirmedPlaceCallArgs(localUrl, args, tenantHeader) {
  const res = await fetch(`${localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": tenantHeader },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  return { ...args, confirmation_code: json.confirmation?.code };
}
const HTTP_SERVER_ERROR = 500;

const postCall = (url, to, identity) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: "Test" }),
  });

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

test("(c) Profil-Land * widened nicht; unrestricted lockert nur die Allowlist", async (ctx) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49" },
    seed: seedState({
      tenants: [subTenant("t_alice", "alice@team.test")],
      numbers: [activeNum("num_alice", "+4915110000011", "t_alice")],
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

test("(d) Config-Limit deckelt ein hoeheres Profil-Limit -> 429", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "1" },
    seed: seedState({
      calls: [seedCall({ id: "g1", tenantId: "t_fresh" })],
      tenants: [subTenant("t_fresh", "fresh@team.test")],
      numbers: [activeNum("num_fresh", "+4915110000021", "t_fresh")],
      profiles: { t_fresh: { unrestricted: true, maxCallsPerHour: 100 } },
    }),
  });
  try {
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
    const res = await postCall(srv.localUrl, "+4915111111111", "bob@team.test");
    assert.equal(res.status, HTTP_TOO_MANY_REQUESTS);
  } finally {
    await srv.stop();
  }
});

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

test("PROFILES_JSON seedet Profile beim Start", async (ctx) => {
  const srv = await startServer({
    env: {
      MULTI_TENANT: "true",
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
    assert.deepEqual(srv.readStore().profiles, {});
  } finally {
    await srv.stop();
  }
});

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
    srv.stdout.includes(`to=${maskNumber(TENANT_CALL_TO)}`),
    "Positiv-Kontrolle: der place_call MIT Mandant muss 'to=<nummer>' im Log hinterlassen",
  );
  assert.ok(!srv.stdout.includes(`to=${maskNumber(to)}`), "der Stub loest NIE einen echten Anruf aus");
  assert.equal(srv.stdout.includes(TENANT_CALL_TO.slice(1)), false);
}

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
      CALL_CONFIRMATION_SECRET: "profiles-test-confirmation-secret-mind-32-zeichen",
    },
    seed: seedState({
      tenants: [subTenant("t_alice", "alice-sub"), subTenant("t_prod", "user_01PROD")],
      numbers: [
        activeNum("num_alice", "+4915110000051", "t_alice"),
        activeNum("num_prod", "+4915110000052", "t_prod"),
      ],
      profiles: {
        t_alice: { unrestricted: true, maxCallsPerHour: null },
        t_prod: { unrestricted: true, maxCallsPerHour: null },
      },
    }),
  });
  try {
    await ctx.test("place_call ueber MCP (JWT email+sub) -> Audit requestedBy=<email>", async () => {
      const token = await idp.sign({ sub: "alice-sub", email: "alice@team.test" });
      const placeCallArgs = await confirmedPlaceCallArgs(
        srv.localUrl,
        { to: TENANT_CALL_TO, objective: "Termin" },
        "t_alice",
      );
      const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
      assert.notEqual(res.status, HTTP_UNAUTHORIZED);
      await waitForLog(
        srv,
        new RegExp(
          `\\[audit\\] place_call ip=\\S+ to=${sternImMuster(maskNumber(TENANT_CALL_TO))} .* requestedBy=${sternImMuster(`***@${hashEmail("alice@team.test")}`)}`,
        ),
      );
      assert.equal(srv.stdout.includes("alice@team.test"), false);
      assert.equal(srv.stdout.includes(TENANT_CALL_TO.slice(1)), false);
      await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("alice@team.test")} tenant=t_alice`));
      assert.ok(
        !/\[mcp\] alice@team\.test/.test(srv.stdout),
        "[mcp]-Log darf die Adresse nicht im Klartext zeigen",
      );
    });

    await ctx.test(
      "JWT OHNE email-Claim, unbekannter sub -> Tool-Fehler mit Re-Auth-Challenge, NICHT owner",
      async () => {
        const token = await idp.sign({ sub: "subonly-9" });
        await assertNoTenantPlaceCallStubbed(srv, token, {
          to: "+4915123123124",
          ownerMsg: "Token ohne email darf NICHT zum Owner werden",
        });
      },
    );

    await ctx.test(
      "JWT OHNE email UND sub -> ANON, Tool-Fehler mit Re-Auth-Challenge, kein fail-open zum Owner",
      async () => {
        const token = await idp.sign({}, { noSubject: true });
        await assertNoTenantPlaceCallStubbed(srv, token, {
          to: "+4915123123125",
          ownerMsg: "Token ohne Identitaet darf NICHT zum Owner werden",
        });
      },
    );

    await ctx.test(
      "Profil per Tenant (Token-sub -> idpSubject) hebt die Allowlist auf -> place_call",
      async () => {
        const token = await idp.sign({ sub: "user_01PROD" });
        const placeCallArgs = await confirmedPlaceCallArgs(
          srv.localUrl,
          { to: "+4915123123126", objective: "Termin" },
          "t_prod",
        );
        const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
        assert.notEqual(res.status, HTTP_UNAUTHORIZED);
        await waitForLog(
          srv,
          new RegExp(`\\[audit\\] place_call ip=\\S+ to=${sternImMuster(maskNumber("+4915123123126"))} .* requestedBy=user_01PROD`),
        );
        assert.equal(srv.stdout.includes("4915123123126"), false);
      },
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});
