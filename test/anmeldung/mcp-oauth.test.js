import test from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  startServerExpectExit,
  waitForLog,
  startIdp,
  mcpPost as post,
  MCP_AUDIENCE as AUDIENCE,
  externalIp,
} from "../helpers.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const ALICE_EMAIL_HASH = "37774a9c";
const RESOURCE_METADATA_HINWEIS = /resource_metadata="https:\/\/agent\.test\/\.well-known\/oauth-protected-resource"/;
const EXTERNAL_IP = externalIp();

test("MCP_AUTH=oauth: Resource Server prueft Tokens", async (ctx) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: AUDIENCE,
      DASHBOARD_PASSWORD: "geheim",
      OWNER_IDP_SUBJECT: "user-1",
    },
  });
  try {
    await ctx.test("Well-known: 200 JSON ohne Auth-Prompt", async () => {
      const res = await fetch(`${srv.localUrl}/.well-known/oauth-protected-resource`);
      assert.equal(res.status, HTTP_OK);
      assert.ok(!res.headers.get("www-authenticate"));
      const doc = await res.json();
      assert.deepEqual(doc.authorization_servers, [idp.issuer]);
      assert.equal(doc.resource, AUDIENCE);
    });

    await ctx.test("Well-known pfadbezogen (/mcp) ebenfalls 200", async () => {
      const res = await fetch(`${srv.localUrl}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(res.status, HTTP_OK);
    });

    await ctx.test("ohne Token -> 401 + WWW-Authenticate mit resource_metadata", async () => {
      const res = await post(`${srv.localUrl}/mcp`, null);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
      assert.match(res.headers.get("www-authenticate") || "", RESOURCE_METADATA_HINWEIS);
    });

    await ctx.test("Muell-Token -> 401", async () => {
      const res = await post(`${srv.localUrl}/mcp`, "abc.def.ghi");
      assert.equal(res.status, HTTP_UNAUTHORIZED);
    });

    await ctx.test("abgelaufenes Token -> 401", async () => {
      const token = await idp.sign({ email: "exp@team.test" }, { exp: "-1m" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
    });

    await ctx.test("Token ohne exp -> 401 + WWW-Authenticate mit resource_metadata", async () => {
      const token = await idp.sign({ email: "noexp@team.test" }, { exp: null });
      const [, payloadB64] = token.split(".");
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      assert.equal(payload.exp, undefined, "Test-Setup: Token darf keinen exp-Claim tragen");

      for (const base of [srv.localUrl, EXTERNAL_IP ? srv.externalUrl : null].filter(Boolean)) {
        const res = await post(`${base}/mcp`, token);
        assert.equal(res.status, HTTP_UNAUTHORIZED, base);
        const wa = res.headers.get("www-authenticate") || "";
        assert.match(wa, /error="invalid_token"/, base);
        assert.match(
          wa,
          /resource_metadata="https:\/\/agent\.test\/\.well-known\/oauth-protected-resource"/,
          base,
        );
        const body = await res.json().catch(() => null);
        assert.ok(!body || !body.result, `Antwort darf kein jsonrpc-Ergebnis enthalten (${base})`);
      }
    });

    await ctx.test("falsche Audience -> 401", async () => {
      const token = await idp.sign({ email: "aud@team.test" }, { aud: "https://anderes.test/mcp" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
    });

    await ctx.test("falsche Signatur (fremder Schluessel) -> 401", async () => {
      const token = await idp.sign({ email: "sig@team.test" }, { key: idp.wrongKey });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
    });

    await ctx.test("gueltiges Token -> kein 401, req.auth.email gehasht im Log", async () => {
      const token = await idp.sign({ email: "alice@team.test" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.notEqual(res.status, HTTP_UNAUTHORIZED);
      await waitForLog(srv, new RegExp(`\\[mcp\\] ${ALICE_EMAIL_HASH} tenant=`));
    });
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MCP_AUTH=oauth: divergenter OAUTH_AUDIENCE -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: "https://idp.test",
      OAUTH_AUDIENCE: "https://workos-resource.example/mcp",
    },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /OAUTH_AUDIENCE/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("MCP_AUTH=oauth: JWKS-Discovery faellt auf oauth-authorization-server zurueck (WorkOS-Stil)", async (ctx) => {
  const idp = await startIdp({ metadataPath: "/.well-known/oauth-authorization-server" });
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: AUDIENCE },
  });
  try {
    await ctx.test("gueltiges Token wird trotzdem akzeptiert", async () => {
      const token = await idp.sign({ email: "bob@team.test" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.notEqual(res.status, HTTP_UNAUTHORIZED);
    });
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MCP_AUTH=oauth ohne OAUTH_ISSUER_URL: Boot verweigert (fail-closed, OT-4)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: "" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OAUTH_ISSUER_URL/);
});

test("MCP_AUTH=off: /mcp offen (nur lokale Demos)", async () => {
  const srv = await startServer({ env: { MCP_AUTH: "off" } });
  try {
    const res = await post(`${srv.localUrl}/mcp`, null);
    assert.notEqual(res.status, HTTP_UNAUTHORIZED);
  } finally {
    await srv.stop();
  }
});
