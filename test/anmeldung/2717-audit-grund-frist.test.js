import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, startIdp, mcpPost, waitForLog, seedState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const METADATEN_FRIST_PUFFER_MS = 5_000;

const HTTP_UNAUTHORIZED = 401;

async function startStummenIdp() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.url !== "/.well-known/oauth-authorization-server") res.writeHead(404).end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    issuer: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((r) => server.close(r));
    },
  };
}

const oauthEnv = (idp) => ({ MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true" });

test("2717: Frist in der Metadaten-Suche -> Audit grund=TimeoutError, Antwort bleibt 401 invalid_token", async () => {
  const idp = await startStummenIdp();
  const signierer = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedState({}) });
  try {
    const token = await signierer.sign({ sub: "user-1" });
    const res = await abrufMitFrist(
      `${srv.localUrl}/mcp`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      },
      { wartezeitMs: METADATEN_FRIST_PUFFER_MS },
    );
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    assert.match(res.headers.get("www-authenticate"), /error="invalid_token"/);
    assert.deepEqual(await res.json(), { error: "Token-Pruefung fehlgeschlagen" });
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=TimeoutError/);
    assert.doesNotMatch(srv.stdout, /grund=23/);
  } finally {
    await srv.stop();
    await idp.close();
    await signierer.close();
  }
});

test("2717: string-wertiger code bleibt der Audit-Grund (Signatur falsch)", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedState({}) });
  try {
    const token = await idp.sign({ sub: "user-1" }, { key: idp.wrongKey });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=ERR_JWS_SIGNATURE_VERIFICATION_FAILED/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});
