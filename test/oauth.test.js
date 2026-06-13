// OAuth-2.1-Resource-Server-Verhalten von /mcp (MCP_AUTH=oauth) plus die
// Well-known-Metadata. Laeuft offline: ein lokaler Mini-IdP (jose-Keypair,
// eigener HTTP-Server) liefert openid-configuration + JWKS, Tokens werden im
// Test signiert. Kein echter IdP, kein Netz nach aussen.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { startServer, waitForLog } from "./helpers.js";

const AUDIENCE = "https://agent.test/mcp"; // = PUBLIC_URL/mcp aus BASE_ENV
const KID = "test-key-1";

// Startet einen lokalen IdP: openid-configuration zeigt auf den JWKS-Endpunkt,
// JWKS enthaelt den oeffentlichen Schluessel. Liefert Issuer-URL + Signierer.
async function startIdp() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const server = http.createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const issuer = `http://127.0.0.1:${server.address().port}`;

  // Zweiter Schluessel mit GLEICHER kid -> jose findet den Key, die Signatur
  // passt aber nicht: sauberer 401 ohne JWKS-Refetch.
  const wrong = await generateKeyPair("RS256");

  const sign = (claims = {}, { key = privateKey, exp = "5m", aud = AUDIENCE, iss = issuer } = {}) =>
    new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(iss)
      .setAudience(aud)
      .setSubject(claims.sub || "user-1")
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(key);

  return { issuer, sign, wrongKey: wrong.privateKey, close: () => new Promise((r) => server.close(r)) };
}

const post = (url, token, body = { jsonrpc: "2.0", id: 1, method: "initialize" }) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

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
      assert.match(wa, /resource_metadata="https:\/\/agent\.test\/\.well-known\/oauth-protected-resource"/);
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

test("MCP_AUTH=oauth ohne OAUTH_ISSUER_URL: Start meldet fehlende Konfig", async () => {
  const srv = await startServer({ env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: "" } });
  try {
    await waitForLog(srv, /Konfiguration unvollstaendig.*OAUTH_ISSUER_URL/s);
  } finally {
    await srv.stop();
  }
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
