// OpenAI-T2-23 (T-16, Commit A): Scope-Angabe des Resource-Servers - PRM
// (scopes_supported), oauth-401-Challenge (scope=) und securitySchemes tragen alle
// dieselbe Menge S; token-/Legacy-Zweig bleiben byte-gleich ohne scope=. Die
// Scope-PRUEFUNG am Token (T-12, Commit B) kommt in einem eigenen, zuruecknehmbaren
// Commit und ergaenzt diese Datei um weitere Tests. Jeder Beleg liest den ECHTEN
// HTTP-Draht (kein fakeRes), s. Lehre "registerTool() verwirft unbekannte Felder
// still" - dasselbe gilt fuer jede Auth-Behauptung.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, mcpPost as post, readToolResult, MCP_AUDIENCE as AUDIENCE } from "./helpers.js";
import { OAUTH_SCOPES } from "../src/auth.js";
import { TOOL_SECURITY_SCHEMES } from "../src/mcp-security-schemes.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const SCOPE_PARAM = OAUTH_SCOPES.join(" ");
const EXPECTED_CHALLENGE_401 =
  'Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource", ' +
  `scope="${SCOPE_PARAM}", error="invalid_token", error_description="Kein Token"`;

test("OpenAI-T2-23-A1: PRM traegt scopes_supported nur mit Authorization-Server", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: AUDIENCE },
  });
  try {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(`${srv.localUrl}${path}`);
      const doc = await res.json();
      assert.deepEqual(doc.scopes_supported, [...OAUTH_SCOPES], path);
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("OpenAI-T2-23-A2: PRM ohne Authorization-Server hat kein scopes_supported-Feld", async () => {
  const srv = await startServer({ env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: "geheim" } });
  try {
    const res = await fetch(`${srv.localUrl}/.well-known/oauth-protected-resource`);
    const doc = await res.json();
    assert.deepEqual(doc.authorization_servers, []);
    assert.equal("scopes_supported" in doc, false);
  } finally {
    await srv.stop();
  }
});

test("OpenAI-T2-23-A3: oauth-401-Challenge traegt scope= (kein Token, Muell-Token)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: AUDIENCE },
  });
  try {
    const ohneToken = await post(`${srv.localUrl}/mcp`, "", TOOLS_LIST_BODY);
    assert.equal(ohneToken.status, HTTP_UNAUTHORIZED);
    assert.equal(ohneToken.headers.get("www-authenticate"), EXPECTED_CHALLENGE_401);

    const muellToken = await post(`${srv.localUrl}/mcp`, "muell", TOOLS_LIST_BODY);
    assert.equal(muellToken.status, HTTP_UNAUTHORIZED);
    const wa = muellToken.headers.get("www-authenticate") || "";
    assert.match(wa, /resource_metadata="https:\/\/agent\.test\/\.well-known\/oauth-protected-resource"/);
    assert.match(wa, new RegExp(`scope="${SCOPE_PARAM}"`));
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("OpenAI-T2-23-A4: token- und Legacy-Challenge bleiben byte-gleich (kein scope=)", async () => {
  const srv = await startServer({ env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: "geheim" } });
  try {
    const res = await post(`${srv.localUrl}/mcp`, "falsch", TOOLS_LIST_BODY);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    const wa = res.headers.get("www-authenticate") || "";
    assert.equal(wa, 'Bearer error="invalid_token"');
    assert.doesNotMatch(wa, /scope=/);
    assert.doesNotMatch(wa, /resource_metadata=/);
  } finally {
    await srv.stop();
  }
});

test("OpenAI-T2-23-A5: securitySchemes traegt S auf jedem Werkzeug (HTTP, echter tools/list)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: AUDIENCE, OWNER_IDP_SUBJECT: "user-1" },
  });
  try {
    const token = await idp.sign({ email: "t2-23-a5@team.test" });
    const res = await post(`${srv.localUrl}/mcp`, token, TOOLS_LIST_BODY);
    assert.equal(res.status, HTTP_OK);
    const result = await readToolResult(res);
    assert.ok(result.tools.length > 0);
    for (const tool of result.tools) {
      assert.deepEqual(tool.securitySchemes, [...TOOL_SECURITY_SCHEMES], tool.name);
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});
