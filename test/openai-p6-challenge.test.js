// P6 (T-13, T-5): jeder 401 von /mcp traegt eine WWW-Authenticate-Bearer-Challenge -
// nicht nur der oauth-Zweig (Bestand), auch der token- und der Legacy-Zweig (neu).
// Testpraefix bewusst "P6-" (NICHT MCP-/GAP-/... - Katalog-Praefixe aus package.json
// config.i18nCatalogPattern wuerden die Datei still nach test:gates verschieben,
// Lehre catalog-id-prefix-misroutes-tests).
//
// Jeder Fall prueft am ECHTEN HTTP-Response (kein fakeRes): Status 401, der Header
// www-authenticate exakt gleich dem erwarteten String, und dass kein Tool lief (Body
// ist das erwartete Fehlerobjekt, hat weder jsonrpc noch result). P6-T4 ist die
// Ausnahme: die Produktions-Legacy-Verweigerung laesst sich nicht per Voll-Spawn
// erreichen (RENDER_EXTERNAL_URL -> PRODUCTION_FOOTGUNS verweigert offline den Boot,
// s.u.) - dort ein In-Process-Express mit echtem HTTP-Listener (Muster
// test/auth-p5-internal-only.test.js, mountProbe).
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { config } from "../src/config.js";
import { makeMcpAuth } from "../src/auth.js";
import { startServer, startIdp, mcpPost, MCP_AUDIENCE } from "./helpers.js";

// T2-07 (T-28): mcpAuth entsteht seit dieser Phase aus einer Fabrik, die den
// Ablehnungs-Zaehler und dessen IP-Sperre injiziert bekommt. Fuer diese Datei (Challenge-Wortlaut, kein
// Drossel-Verhalten) genuegen Attrappen, die nie drosseln.
const ERLAUBT = () => ({ allowed: true, retryAfterS: 0 });
const mcpAuth = makeMcpAuth({ ablehnungsDrossel: ERLAUBT, ipSperre: ERLAUBT });

const HTTP_UNAUTHORIZED = 401;
const STATIC_CHALLENGE = 'Bearer error="invalid_token"';
const OAUTH_CHALLENGE =
  'Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource", scope="openid email offline_access", error="invalid_token", error_description="Kein Token"';

// P6-T4 braucht die Ueberschreibung waehrend ECHTER Netzwerk-I/O (Express-Listener
// starten, echter HTTP-Request) - das ueberschreitet mehrere Makrotask-Grenzen. Der
// geteilte makeConfigOverrides-Helper (test/helpers.js:1092) restauriert dagegen
// SYNCHRON direkt nach dem Aufruf von fn(), ohne dessen Promise abzuwarten - fuer rein
// synchron (bis zum ersten await) lesende Aufrufer wie PA-17 korrekt, hier aber zu
// frueh: die Ueberschreibung waere laengst zurueckgesetzt, bevor der echte Request
// eintrifft (gemessen, s. Commit-Historie dieser Datei). Deshalb hier eine eigene,
// async-sichere Variante mit try/finally um das gesamte await.
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

// Belegt: kein Tool lief. Ein durchgelassener Request landete in der JSON-RPC-Antwort
// (jsonrpc/result); die 401-Ablehnung antwortet mit dem reinen Fehlerobjekt.
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

// P6-T4: die Produktions-Legacy-Verweigerung (Zeile :113-116 im Ist-Zustand) laesst
// sich nicht per Voll-Spawn erreichen - der Code erkennt Produktion an
// RENDER_EXTERNAL_URL (src/config.js), und ein Spawn damit verweigert offline den Boot
// (PRODUCTION_FOOTGUNS: STORE_BACKEND != pg, Muster test/boot-prod-footguns.test.js).
// Stattdessen ein In-Process-Express mit echtem HTTP-Listener (Port 0) - echtes
// res.set/res.status ueber echtes HTTP, der Header ist am Draht sichtbar.
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
