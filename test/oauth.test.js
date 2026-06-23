// OAuth-2.1-Resource-Server-Verhalten von /mcp (MCP_AUTH=oauth) plus die
// Well-known-Metadata. Laeuft offline: ein lokaler Mini-IdP (jose-Keypair,
// eigener HTTP-Server) liefert openid-configuration + JWKS, Tokens werden im
// Test signiert. Kein echter IdP, kein Netz nach aussen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  startServerExpectExit,
  waitForLog,
  startIdp,
  mcpPost as post,
  MCP_AUDIENCE as AUDIENCE,
} from "./helpers.js";

test("MCP_AUTH=oauth: Resource Server prueft Tokens", async (t) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: AUDIENCE,
      DASHBOARD_PASSWORD: "geheim", // beweist: Well-known braucht KEINE Basic-Auth
    },
  });
  try {
    await t.test("Well-known: 200 JSON ohne Basic-Auth-Prompt", async () => {
      const res = await fetch(`${srv.localUrl}/.well-known/oauth-protected-resource`);
      assert.equal(res.status, 200);
      assert.ok(!res.headers.get("www-authenticate"));
      const doc = await res.json();
      assert.deepEqual(doc.authorization_servers, [idp.issuer]);
      assert.equal(doc.resource, AUDIENCE);
    });

    await t.test("Well-known pfadbezogen (/mcp) ebenfalls 200", async () => {
      const res = await fetch(`${srv.localUrl}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(res.status, 200);
    });

    await t.test("ohne Token -> 401 + WWW-Authenticate mit resource_metadata", async () => {
      const res = await post(`${srv.localUrl}/mcp`, null);
      assert.equal(res.status, 401);
      const wa = res.headers.get("www-authenticate") || "";
      assert.match(
        wa,
        /resource_metadata="https:\/\/agent\.test\/\.well-known\/oauth-protected-resource"/,
      );
    });

    await t.test("Muell-Token -> 401", async () => {
      const res = await post(`${srv.localUrl}/mcp`, "abc.def.ghi");
      assert.equal(res.status, 401);
    });

    await t.test("abgelaufenes Token -> 401", async () => {
      const token = await idp.sign({ email: "exp@team.test" }, { exp: "-1m" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.equal(res.status, 401);
    });

    await t.test("falsche Audience -> 401", async () => {
      const token = await idp.sign({ email: "aud@team.test" }, { aud: "https://anderes.test/mcp" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.equal(res.status, 401);
    });

    await t.test("falsche Signatur (fremder Schluessel) -> 401", async () => {
      const token = await idp.sign({ email: "sig@team.test" }, { key: idp.wrongKey });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.equal(res.status, 401);
    });

    await t.test("gueltiges Token -> kein 401, req.auth.email im Log", async () => {
      const token = await idp.sign({ email: "alice@team.test" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.notEqual(res.status, 401);
      await waitForLog(srv, /\[mcp\] alice@team\.test/);
    });
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MCP_AUTH=oauth: JWKS-Discovery faellt auf oauth-authorization-server zurueck (WorkOS-Stil)", async (t) => {
  // IdP liefert NUR den OAuth-2.1-Metadata-Pfad, kein openid-configuration.
  const idp = await startIdp({ metadataPath: "/.well-known/oauth-authorization-server" });
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: AUDIENCE },
  });
  try {
    await t.test("gueltiges Token wird trotzdem akzeptiert", async () => {
      const token = await idp.sign({ email: "bob@team.test" });
      const res = await post(`${srv.localUrl}/mcp`, token);
      assert.notEqual(res.status, 401);
    });
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MCP_AUTH=oauth ohne OAUTH_ISSUER_URL: Boot verweigert (fail-closed, OT-4)", async () => {
  // Ein OAuth-Resource-Server ohne Issuer kann keine Tokens verifizieren -> /mcp
  // waere kaputt/offen. assertConfig wertet das als Pflicht-Config; der Boot wird
  // jetzt verweigert (exit 1) statt nur zu warnen und trotzdem zu starten.
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
    assert.notEqual(res.status, 401);
  } finally {
    await srv.stop();
  }
});
