import test from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  waitForLog,
  startIdp,
  seedState,
  mcpPost as post,
  MCP_AUDIENCE as AUDIENCE,
  toolCall,
  readToolResult,
  assertReauthChallenge,
} from "./helpers.js";
import { hashEmail } from "../src/util.js";

const TENANT_B = "B";
const SUB_B = "sub-b";
const UNKNOWN_SUB = "sub-unbekannt";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const seedTenantB = () =>
  seedState({ tenants: [{ id: TENANT_B, status: "active", idpSubject: SUB_B }] });
const oauthEnv = (issuer, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: issuer,
  OAUTH_AUDIENCE: AUDIENCE,
  ...extra,
});

test("V1: bekannter sub loest unbedingt auf tenant=B, OHNE MULTI_TENANT gesetzt zu haben", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp.issuer), seed: seedTenantB() });
  try {
    const token = await idp.sign({ sub: SUB_B, email: "alice@team.test" });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.notEqual(res.status, HTTP_UNAUTHORIZED);
    await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("alice@team.test")} tenant=${TENANT_B}`));
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V2: bekannter sub -> tenant=B", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ sub: SUB_B });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.notEqual(res.status, HTTP_UNAUTHORIZED);
    await waitForLog(srv, /\[mcp\].*tenant=B/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V3: unbekannter sub -> Tool-Fehler mit Re-Auth-Challenge (T2-05, NIE Owner)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ sub: UNKNOWN_SUB });
    const res = await post(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
    assertReauthChallenge(await readToolResult(res));
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V4: verifiziertes Token OHNE sub -> Tool-Fehler mit Re-Auth-Challenge (T2-05, NIE Owner)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ email: "nosub@team.test" }, { noSubject: true });
    const res = await post(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
    assertReauthChallenge(await readToolResult(res));
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});
