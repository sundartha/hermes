// OpenAI-P7 (T-12): belegt drei bisher nur am Code (src/auth.js:98-102) behauptete
// Token-Pruefachsen ueber den ECHTEN tools/list-Pfad (kein fakeRes, s. Lehre
// "registerTool() verwirft unbekannte Felder still" - dasselbe gilt fuer jede
// Behauptung ueber Auth: nur der echte HTTP-Response zaehlt):
//   T1 falscher Issuer  -> 401 (jwtVerify prueft `issuer`, src/auth.js:99)
//   T2 nbf in der Zukunft -> 401 (jwtVerify respektiert `nbf`, clockTolerance 30s, :101)
//   T3/T4 Scope-Claim wird weder verlangt noch ausgewertet -> 200 in beiden Faellen
// T3/T4 pinnen eine DOKUMENTIERTE Luecke (docs/OPENAI-AUTH-ABWEICHUNGEN.md, ID T-12):
// wird je eine Scope-Pruefung gebaut, MUESSEN T3 und/oder T4 rot werden - und muessen
// dann zusammen mit src/mcp-security-schemes.js:21-27 (securitySchemes.scopes = [])
// und dem Dokument geaendert werden. Diese Datei aendert KEINEN Produktionscode.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, mcpPost as post, MCP_AUDIENCE as AUDIENCE } from "./helpers.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
// Ein Issuer, den der lokale Mini-IdP nicht ausstellt - signiert wird trotzdem mit
// seinem echten Schluessel (idp.sign ueberschreibt nur den `iss`-Claim), die Signatur
// allein darf also NICHT reichen.
const FREMDER_ISSUER = "https://fremder-issuer.test";
// Weit jenseits der 30s clockTolerance (src/auth.js:101) - kein Uhren-Jitter-Flake.
const NBF_VORLAUF_SEK = 3600;
const BELIEBIGER_SCOPE = "nicht-vergeben";
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
      // mit 403 statt 200 scheitern, bevor sie etwas ueber Scope belegen.
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

    await ctx.test("OpenAI-P7-T3 (Positiv-Kontrolle): gueltiges Token ohne scope-Claim -> 200", async () => {
      const token = await idp.sign({ email: "p7-t3@team.test" });
      const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
      assert.equal(res.status, HTTP_OK, "das Gate darf nicht pauschal alles ablehnen");
    });

    await ctx.test(
      "OpenAI-P7-T4: beliebiger scope-Claim wird nicht ausgewertet -> 200 (pinnt T-12-Luecke)",
      async () => {
        const token = await idp.sign({ email: "p7-t4@team.test", scope: BELIEBIGER_SCOPE });
        const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
        assert.equal(res.status, HTTP_OK, "ein unbekannter Scope-Wert sperrt heute niemanden aus");
      },
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});
