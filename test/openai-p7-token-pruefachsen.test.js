// OpenAI-P7 (T-12): belegt vier bisher nur am Code (src/auth.js) behauptete
// Token-Pruefachsen ueber den ECHTEN tools/list-Pfad (kein fakeRes, s. Lehre
// "registerTool() verwirft unbekannte Felder still" - dasselbe gilt fuer jede
// Behauptung ueber Auth: nur der echte HTTP-Response zaehlt):
//   T1 falscher Issuer  -> 401 (jwtVerify prueft `issuer`, src/auth.js:99)
//   T2 nbf in der Zukunft -> 401 (jwtVerify respektiert `nbf`, clockTolerance 30s, :101)
//   T3 (Positiv-Kontrolle) vollstaendige Scope-Menge -> 200
//   T4 einem erzwungenen Scope fehlt -> 403 insufficient_scope
// T3/T4 pinnten bis T2-23 Commit B eine DOKUMENTIERTE Luecke (docs/OPENAI-AUTH-
// ABWEICHUNGEN.md, ID T-12): kein Scope wurde ausgewertet, beide Faelle ergaben 200.
// Seit Commit B (Scope-Pruefung in verifyOauth, src/auth.js) prueft der Resource
// Server jedes Token gegen ENFORCED_OAUTH_SCOPES (NICHT die volle beworbene
// OAUTH_SCOPES - Safety-Review src/auth.js:36: "offline_access" ist ein Grant-Scope,
// steht typischerweise nie im Access-Token, und darf deshalb nicht erzwungen werden);
// T4 belegt jetzt, dass ein am RS fehlendes Element der ERZWUNGENEN Menge ablehnt.
// test/helpers.js#sign() signiert per Default die volle Scope-Menge - T4 ueberschreibt
// das explizit mit einem Scope-Claim, dem "email" (Teil der erzwungenen Menge) fehlt.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, mcpPost as post, MCP_AUDIENCE as AUDIENCE } from "./helpers.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
// Ein Issuer, den der lokale Mini-IdP nicht ausstellt - signiert wird trotzdem mit
// seinem echten Schluessel (idp.sign ueberschreibt nur den `iss`-Claim), die Signatur
// allein darf also NICHT reichen.
const FREMDER_ISSUER = "https://fremder-issuer.test";
// Weit jenseits der 30s clockTolerance (src/auth.js:101) - kein Uhren-Jitter-Flake.
const NBF_VORLAUF_SEK = 3600;
// "openid" fehlt "email" - ein Element der ERZWUNGENEN Menge (ENFORCED_OAUTH_SCOPES,
// src/auth.js) fehlt. Kein erfundener Scope-Name (der waere ein anderer Fehlerfall
// beim Auth-Server, nicht hier am RS).
const SCOPE_OHNE_ERZWUNGENES_ELEMENT = "openid";
const MS_PRO_SEKUNDE = 1000;

test("OpenAI-P7: Token-Pruefachsen (iss, nbf, Scope) am echten tools/list", async (ctx) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: AUDIENCE,
      // E4: idp.sign() ohne explizites sub signiert immer sub="user-1" - ohne diese
      // Bindung wuerden T3/T4 am Tenant-Torschluss (rejectIfNoTenant, routes/mcp.js:59)
      // mit 403 statt 200/403-wegen-Scope scheitern, bevor sie etwas ueber Scope belegen.
      OWNER_IDP_SUBJECT: "user-1",
    },
  });
  try {
    await ctx.test("OpenAI-P7-T1: fremder Issuer -> 401 + oauth-Challenge, kein jsonrpc", async () => {
      const token = await idp.sign({ email: "p7-t1@team.test" }, { iss: FREMDER_ISSUER });
      const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
      const wa = res.headers.get("www-authenticate") || "";
      assert.match(wa, /^Bearer resource_metadata="/);
      const body = await res.json();
      assert.equal(body.jsonrpc, undefined, "kein jsonrpc-Feld - kein Tool-Aufruf durchgelassen");
    });

    await ctx.test("OpenAI-P7-T2: nbf in der Zukunft (jenseits clockTolerance) -> 401", async () => {
      const nbf = Math.floor(Date.now() / MS_PRO_SEKUNDE) + NBF_VORLAUF_SEK;
      const token = await idp.sign({ email: "p7-t2@team.test", nbf });
      const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
    });

    await ctx.test("OpenAI-P7-T3 (Positiv-Kontrolle): vollstaendige Scope-Menge -> 200", async () => {
      // Kein scope-Claim in claims -> sign() setzt den Default (volle OAUTH_SCOPES).
      const token = await idp.sign({ email: "p7-t3@team.test" });
      const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
      assert.equal(res.status, HTTP_OK, "das Gate darf ein Token mit vollstaendigem Scope nicht ablehnen");
    });

    await ctx.test(
      "OpenAI-P7-T4: einem erzwungenen Scope fehlt -> 403 insufficient_scope (T-12 geschlossen)",
      async () => {
        const token = await idp.sign({ email: "p7-t4@team.test", scope: SCOPE_OHNE_ERZWUNGENES_ELEMENT });
        const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
        assert.equal(res.status, HTTP_FORBIDDEN, "fehlender Scope muss jetzt abgelehnt werden");
        const wa = res.headers.get("www-authenticate") || "";
        assert.match(wa, /error="insufficient_scope"/);
        const body = await res.json();
        assert.equal(body.jsonrpc, undefined, "kein jsonrpc-Feld - kein Tool-Aufruf durchgelassen");
      },
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});
