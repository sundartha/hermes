// Phase 2: Rechteprofile pro Nutzer. Beweist (nicht nur "gruen"), dass ein Profil
// die globalen Safety-Gates NUR einschraenken, nie aufweichen kann, und dass die
// Identitaet serverseitig (nicht aus dem Body) und nicht spoofbar ist.
//
// Offline-Twilio-Trick (wie number-gate/audit): eine NICHT mit "AC" beginnende
// TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron VOR jedem Netzzugriff
// werfen -> ein durchgelassener Call endet als 500 (alle Gates passiert), eine
// Sperre als 403/429. Nicht-leer, damit der fail-closed-Boot (OT-4) startet.
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

// ---- (b) X-Internal-Identity: nur localhost, extern wird ignoriert ----
test("(b) Identitaet nur vom localhost-Header, extern ignoriert (kein Spoof)", async (t) => {
  // global: leere Allowlist, Land +49. Profil evil@x = unrestricted (lockert die
  // Allowlist). Greift der Header von extern, wuerde die nicht-gelistete Nummer
  // durchgehen (500). Wird er ignoriert -> Owner -> leere Allowlist -> 403.
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49", ...OFFLINE },
    seed: seedState({ profiles: { "evil@x": { unrestricted: true } } }),
  });
  try {
    await t.test(
      "localhost: Header gilt -> unrestricted passiert die Allowlist (500)",
      async () => {
        const res = await postCall(srv.localUrl, "+4915777777777", "evil@x");
        assert.equal(res.status, 500, "localhost-Header muss die Identitaet setzen");
      },
    );

    // Laeuft immer (kein externes IP noetig): beweist die andere Haelfte - die
    // Identitaet kommt NIE aus dem Body, auch nicht von localhost.
    await t.test(
      "localhost: Body-Felder (requestedBy/email) gelten NICHT als Identitaet",
      async () => {
        const res = await fetch(`${srv.localUrl}/api/calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: "+4915777777777",
            objective: "Test",
            requestedBy: "evil@x",
            email: "evil@x",
          }),
        });
        assert.equal(res.status, 403, "Identitaet darf nie aus dem Body kommen -> Owner -> 403");
        assert.match((await res.json()).error, /Allowlist/);
      },
    );

    await t.test(
      "extern: Header ignoriert -> Owner -> leere globale Allowlist (403)",
      { skip: !srv.externalUrl && "keine externe Interface-IP" },
      async () => {
        const res = await postCall(srv.externalUrl, "+4915777777777", "evil@x");
        assert.equal(res.status, 403, "externer X-Internal-Identity darf NICHT gelten");
        assert.match((await res.json()).error, /Allowlist/);
      },
    );
  } finally {
    await srv.stop();
  }
});

// ---- (c) Land bleibt harte Obergrenze; unrestricted lockert NUR die Allowlist ----
test("(c) Profil-Land * widened nicht; unrestricted lockert nur die Allowlist", async (t) => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49", ...OFFLINE },
    seed: seedState({
      profiles: { "alice@team.test": { unrestricted: true, allowedCountryCodes: ["*"] } },
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

// ---- (d) Globales Stundenlimit bleibt harte Obergrenze ----
test("(d) global erschoepft -> frischer Nutzer trotzdem 429", async () => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "1", ...OFFLINE },
    seed: seedState({
      calls: [seedCall({ id: "g1", requestedBy: "owner" })], // 1 Outbound in der letzten Stunde
      profiles: { "fresh@team.test": { unrestricted: true, maxCallsPerHour: 100 } },
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
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "100", ...OFFLINE },
    seed: seedState({
      calls: [seedCall({ id: "u1", requestedBy: "bob@team.test" })],
      profiles: { "bob@team.test": { unrestricted: true, maxCallsPerHour: 1 } },
    }),
  });
  try {
    // bob hat 1 eigenen Call, sein Limit 1 -> 429, obwohl global (100) nicht erschoepft.
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

// ---- 2.4 Booking-Gate ----
test("Booking-Gate auf POST /api/calendar", async (t) => {
  const srv = await startServer({
    seed: seedState({ profiles: { "booker@team.test": { allowBooking: true } } }),
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
    await t.test("Owner (kein Header) -> 200", async () => {
      assert.equal((await cal(null)).status, 200);
    });

    await t.test("profilloser Nutzer (DEFAULT, allowBooking=false) -> 403", async () => {
      const res = await cal("nobody@team.test");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /allowBooking/);
    });

    await t.test("Profil mit allowBooking=true -> 200", async () => {
      assert.equal((await cal("booker@team.test")).status, 200);
    });
  } finally {
    await srv.stop();
  }
});

// ---- 2.5 Profil-Verwaltung (hinter Basic-Auth; hier localhost) ----
test("Profil-Verwaltung: POST/GET/DELETE + Audit ohne Werte", async (t) => {
  const srv = await startServer();
  try {
    await t.test("POST legt Profil an, sanitisiert Fremd-Keys/falsche Typen", async () => {
      const res = await postJson(`${srv.localUrl}/api/profiles`, {
        email: "dora@team.test",
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
      // Audit: nur email + Keys, KEINE Werte (Nummer darf nicht im Log stehen)
      await waitForLog(srv, /\[audit\] profile_update ip=\S+ email=dora@team\.test keys=/);
      assert.ok(!srv.stdout.includes("+4915122223333"), "Profil-Werte duerfen nicht im Log stehen");
    });

    await t.test("GET listet die Profile", async () => {
      const profiles = await (await fetch(`${srv.localUrl}/api/profiles`)).json();
      assert.ok("dora@team.test" in profiles);
      assert.equal(profiles["dora@team.test"].unrestricted, true);
    });

    await t.test("POST ohne gueltige email -> 400", async () => {
      assert.equal(
        (await postJson(`${srv.localUrl}/api/profiles`, { unrestricted: true })).status,
        400,
      );
    });

    await t.test("IdP-sub (kein @) ist als Schluessel erlaubt; Whitespace nicht", async () => {
      const ok = await postJson(`${srv.localUrl}/api/profiles`, {
        email: "user_01TESTKEY",
        unrestricted: true,
      });
      assert.equal(ok.status, 200);
      assert.ok("user_01TESTKEY" in srv.readStore().profiles);
      assert.equal(
        (await postJson(`${srv.localUrl}/api/profiles`, { email: "a b", unrestricted: true }))
          .status,
        400,
      );
    });

    await t.test("DELETE entfernt das Profil + Audit", async () => {
      const res = await fetch(
        `${srv.localUrl}/api/profiles/${encodeURIComponent("dora@team.test")}`,
        { method: "DELETE" },
      );
      assert.equal(res.status, 200);
      await waitForLog(srv, /\[audit\] profile_delete ip=\S+ email=dora@team\.test/);
      assert.equal("dora@team.test" in srv.readStore().profiles, false);
    });

    await t.test("DELETE unbekannt -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/profiles/${encodeURIComponent("nobody@x")}`, {
        method: "DELETE",
      });
      assert.equal(res.status, 404);
    });
  } finally {
    await srv.stop();
  }
});

// ---- PROFILES_JSON: Seed beim Start (persistiert ueber Render-Neustarts) ----
test("PROFILES_JSON seedet Profile beim Start", async (t) => {
  const srv = await startServer({
    env: {
      PROFILES_JSON: JSON.stringify({ user_01PERSIST: { unrestricted: true, evil: "x" } }),
      ALLOWED_NUMBERS: "",
      ALLOWED_COUNTRY_CODES: "*",
      ...OFFLINE,
    },
  });
  try {
    await t.test("GET /api/profiles zeigt das geseedete Profil (sanitisiert)", async () => {
      const profiles = await (await fetch(`${srv.localUrl}/api/profiles`)).json();
      assert.equal(profiles.user_01PERSIST?.unrestricted, true);
      assert.equal("evil" in profiles.user_01PERSIST, false, "Fremd-Key muss sanitisiert sein");
    });

    await t.test("geseedetes unrestricted-Profil hebt die Allowlist auf -> 500", async () => {
      const res = await postCall(srv.localUrl, "+4915123999999", "user_01PERSIST");
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

// ---- 2.3 e2e ueber /mcp mit JWT: Identitaet fliesst bis ins Audit ----
test("e2e /mcp: JWT-Identitaet -> requestedBy im Audit (nicht spoof-/fail-open-bar)", async (t) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: MCP_AUDIENCE,
      ALLOWED_NUMBERS: "",
      ALLOWED_COUNTRY_CODES: "*",
      ...OFFLINE,
    },
    seed: seedState({
      profiles: {
        "alice@team.test": { unrestricted: true },
        user_01PROD: { unrestricted: true }, // IdP-sub-Schluessel (Token ohne email)
      },
    }),
  });
  try {
    await t.test("place_call ueber MCP (JWT email) -> Audit requestedBy=<email>", async () => {
      const token = await idp.sign({ email: "alice@team.test" });
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
      // T-P0-7: das pro-Request-[mcp]-Diagnose-Log zeigt die E-Mail nur gehasht,
      // nie im Klartext (der forensische Klartext bleibt allein im audit()-Trail).
      await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("alice@team.test")} tenant=`));
      assert.ok(
        !/\[mcp\] alice@team\.test/.test(srv.stdout),
        "[mcp]-Log darf die Adresse nicht im Klartext zeigen",
      );
    });

    await t.test(
      "JWT OHNE email-Claim -> requestedBy=<sub>, NICHT owner (kein fail-open)",
      async () => {
        const token = await idp.sign({ sub: "subonly-9" }); // kein email-Claim
        const res = await mcpPost(
          `${srv.localUrl}/mcp`,
          token,
          toolCall("place_call", { to: "+4915123123124", objective: "Termin" }),
        );
        assert.notEqual(res.status, 401);
        // subonly-9 hat kein Profil -> DEFAULT (restriktiv) -> 403 allowlist, requestedBy=subonly-9
        await waitForLog(
          srv,
          /\[audit\] place_call_denied ip=\S+ to=\+4915123123124 grund=allowlist requestedBy=subonly-9/,
        );
        assert.ok(
          !/requestedBy=owner/.test(srv.stdout),
          "Token ohne email darf NICHT zum Owner werden",
        );
      },
    );

    await t.test("JWT OHNE email UND sub -> ANON (DEFAULT), kein fail-open zum Owner", async () => {
      const token = await idp.sign({}, { noSubject: true }); // weder email noch sub
      const res = await mcpPost(
        `${srv.localUrl}/mcp`,
        token,
        toolCall("place_call", { to: "+4915123123125", objective: "Termin" }),
      );
      assert.notEqual(res.status, 401);
      // ANON -> kein Profil -> DEFAULT (restriktiv) -> 403 allowlist, requestedBy=anon (NICHT owner).
      await waitForLog(
        srv,
        /\[audit\] place_call_denied ip=\S+ to=\+4915123123125 grund=allowlist requestedBy=anon/,
      );
      assert.ok(
        !/requestedBy=owner/.test(srv.stdout),
        "Token ohne Identitaet darf NICHT zum Owner werden",
      );
    });

    // Produktions-Szenario: WorkOS-Token traegt nur sub (kein email). Ein Profil,
    // das auf diese sub gekeyt ist, hebt die Allowlist auf.
    await t.test(
      "Profil per IdP-sub (Token ohne email) hebt die Allowlist auf -> 500",
      async () => {
        const token = await idp.sign({ sub: "user_01PROD" }); // identity = sub
        const res = await mcpPost(
          `${srv.localUrl}/mcp`,
          token,
          toolCall("place_call", { to: "+4915123123126", objective: "Termin" }),
        );
        assert.notEqual(res.status, 401);
        // unrestricted-Profil auf der sub -> Allowlist aufgehoben -> place_call (nicht denied)
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
