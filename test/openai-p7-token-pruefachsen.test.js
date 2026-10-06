import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, mcpPost as post, MCP_AUDIENCE as AUDIENCE } from "./helpers.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const FREMDER_ISSUER = "https://fremder-issuer.test";
const NBF_VORLAUF_SEK = 3600;
const SCOPE_OHNE_ERZWUNGENES_ELEMENT = "openid";
const MS_PRO_SEKUNDE = 1000;

test("OpenAI-P7: Token-Pruefachsen (iss, nbf, Scope) am echten tools/list", async (ctx) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: AUDIENCE,
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
