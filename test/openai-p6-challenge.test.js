import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { config } from "../src/config.js";
import { makeMcpAuth } from "../src/auth.js";
import { startServer, startIdp, mcpPost, MCP_AUDIENCE } from "./helpers.js";

const ERLAUBT = () => ({ allowed: true, retryAfterS: 0 });
const mcpAuth = makeMcpAuth({ ablehnungsDrossel: ERLAUBT, ipSperre: ERLAUBT });

const HTTP_UNAUTHORIZED = 401;
const STATIC_CHALLENGE = 'Bearer error="invalid_token"';
const OAUTH_CHALLENGE =
  'Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource", scope="openid email offline_access", error="invalid_token", error_description="Kein Token"';

async function withServerConfig({ mcpAuth, mcpAuthToken, isProduction }, fn) {
  const saved = {
    mcpAuth: config.auth.mcpAuth,
    mcpAuthToken: config.auth.mcpAuthToken,
    isProduction: config.server.isProduction,
  };
  config.auth.mcpAuth = mcpAuth;
  config.auth.mcpAuthToken = mcpAuthToken;
  config.server.isProduction = isProduction;
  try {
    return await fn();
  } finally {
    config.auth.mcpAuth = saved.mcpAuth;
    config.auth.mcpAuthToken = saved.mcpAuthToken;
    config.server.isProduction = saved.isProduction;
  }
}

function assertNoToolRan(body) {
  assert.equal(body.jsonrpc, undefined, "kein jsonrpc-Feld - kein Tool-Aufruf durchgelassen");
  assert.equal(body.result, undefined, "kein result-Feld - kein Tool-Aufruf durchgelassen");
}

async function assertStatic401(res, expectedBody) {
  assert.equal(res.status, HTTP_UNAUTHORIZED);
  assert.equal(res.headers.get("www-authenticate"), STATIC_CHALLENGE);
  const body = await res.json();
  assert.deepEqual(body, expectedBody);
  assertNoToolRan(body);
}

const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };

test("P6-T1: MCP_AUTH=token ohne MCP_AUTH_TOKEN -> 401 statische Challenge, kein resource_metadata", async () => {
  const srv = await startServer({ env: { MCP_AUTH: "token" } });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
    await assertStatic401(res, { error: "unauthorized" });
  } finally {
    await srv.stop();
  }
});

test("P6-T2: MCP_AUTH=token mit MCP_AUTH_TOKEN gesetzt - falsches/fehlendes/korrektes Bearer", async (ctx) => {
  const srv = await startServer({ env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: "p6-token" } });
  try {
    await ctx.test("P6-T2a: falsches Bearer -> 401 statische Challenge", async () => {
      const res = await mcpPost(`${srv.localUrl}/mcp`, "falsch", TOOLS_LIST_BODY);
      await assertStatic401(res, { error: "unauthorized" });
    });

    await ctx.test("P6-T2b: kein Authorization-Header -> 401 statische Challenge", async () => {
      const res = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
      await assertStatic401(res, { error: "unauthorized" });
    });

    await ctx.test("P6-T2c: korrektes Bearer -> kein 401 (Positiv-Kontrolle)", async () => {
      const res = await mcpPost(`${srv.localUrl}/mcp`, "p6-token", TOOLS_LIST_BODY);
      assert.notEqual(res.status, HTTP_UNAUTHORIZED, "ein gueltiger Request kommt weiterhin durch");
    });
  } finally {
    await srv.stop();
  }
});

test("P6-T3: Legacy (MCP_AUTH=\"\") mit MCP_AUTH_TOKEN gesetzt, falsches Bearer -> 401 statische Challenge", async () => {
  const srv = await startServer({ env: { MCP_AUTH: "", MCP_AUTH_TOKEN: "p6-legacy" } });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, "falsch", TOOLS_LIST_BODY);
    await assertStatic401(res, { error: "unauthorized" });
  } finally {
    await srv.stop();
  }
});

async function mountMcpAuthProbe() {
  const app = express();
  let handlerReached = false;
  app.post("/mcp", mcpAuth, (_req, res) => {
    handlerReached = true;
    res.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    reachedHandler: () => handlerReached,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("P6-T4: Legacy ohne MCP_AUTH_TOKEN in Produktion -> 401 statische Challenge, Handler nie erreicht", async () => {
  await withServerConfig({ mcpAuth: "", mcpAuthToken: "", isProduction: true }, async () => {
    const srv = await mountMcpAuthProbe();
    try {
      const res = await mcpPost(`${srv.base}/mcp`, null, TOOLS_LIST_BODY);
      assert.equal(res.status, HTTP_UNAUTHORIZED);
      assert.equal(res.headers.get("www-authenticate"), STATIC_CHALLENGE);
      const body = await res.json();
      assert.deepEqual(body, {
        error: "MCP_AUTH_TOKEN nicht gesetzt - /mcp ist nur von localhost (ausserhalb Produktion) erreichbar",
      });
      assertNoToolRan(body);
      assert.equal(srv.reachedHandler(), false, "der Handler darf in Produktion nie erreicht werden");
    } finally {
      await srv.close();
    }
  });
});

test("P6-T4b (Gegenprobe): dieselbe Anfrage ausserhalb Produktion - Bypass unveraendert, Handler erreicht", async () => {
  await withServerConfig({ mcpAuth: "", mcpAuthToken: "", isProduction: false }, async () => {
    const srv = await mountMcpAuthProbe();
    try {
      const res = await mcpPost(`${srv.base}/mcp`, null, TOOLS_LIST_BODY);
      assert.notEqual(res.status, HTTP_UNAUTHORIZED);
      assert.equal(srv.reachedHandler(), true, "ausserhalb Produktion bleibt der Loopback-Bypass unveraendert");
    } finally {
      await srv.close();
    }
  });
});

test("P6-T5: MCP_AUTH=oauth - Bestand byte-exakt (Gegenprobe gegen Aufweichung/Verschlucken)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: MCP_AUDIENCE },
  });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    assert.equal(res.headers.get("www-authenticate"), OAUTH_CHALLENGE);
    const body = await res.json();
    assertNoToolRan(body);

    const token = await idp.sign({ email: "p6@team.test" });
    const okRes = await mcpPost(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
    assert.notEqual(okRes.status, HTTP_UNAUTHORIZED, "ein gueltiges Token kommt weiterhin durch");
  } finally {
    await idp.close();
    await srv.stop();
  }
});
