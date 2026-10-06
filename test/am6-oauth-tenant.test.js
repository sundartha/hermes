import test from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  startIdp,
  mcpPost,
  toolCall,
  readToolResult,
  waitForLog,
  seedState,
  assertReauthChallenge,
} from "./helpers.js";
import { hashEmail } from "../src/util.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER_SUB = "owner-sub-1";
const OWNER_NUM = "+18643028341";
const HTTP_OK = 200;

const oauthEnv = (idp, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  OWNER_IDP_SUBJECT: OWNER_SUB,
  ...extra,
});

async function myNumberOver(srv, token) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
  assert.notEqual(res.status, 401, "gueltiges Token muss akzeptiert werden");
  return (await readToolResult(res)).structuredContent.number;
}

test("AM6: geseedeter Owner-sub -> Gateway-Tenant=owner (auch mit email-Claim)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const token = await idp.sign({ sub: OWNER_SUB, email: "owner@team.test" });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    assert.notEqual(res.status, 401);
    await waitForLog(
      srv,
      new RegExp(`\\[mcp\\] ${hashEmail("owner@team.test")} tenant=${BOOTSTRAP_TENANT_ID}`),
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 e2e: Owner-Token MIT email -> get_agent_number traegt die aktive Nummer (honest-green)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const token = await idp.sign({ sub: OWNER_SUB, email: "owner@team.test" });
    assert.equal(await myNumberOver(srv, token), OWNER_NUM);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 T2-05: unbekannter sub -> Tool-Fehler mit Re-Auth-Challenge, kein echter Tool-Zugriff", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const token = await idp.sign({ sub: "fremd-sub", email: "fremd@team.test" });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
    const result = await readToolResult(res);
    assertReauthChallenge(result);
    assert.ok(!JSON.stringify(result).includes(OWNER_NUM), "NIE die Owner-Nummer");
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 T2-05: verifiziertes Token OHNE sub -> Tool-Fehler mit Re-Auth-Challenge, NIE Owner", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const token = await idp.sign({ email: "evil@attacker.test" }, { noSubject: true });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK);
    const result = await readToolResult(res);
    assertReauthChallenge(result);
    assert.ok(!JSON.stringify(result).includes(OWNER_NUM), "NIE die Owner-Nummer");
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 set-if-absent: bestehende idpSubject-Bindung gewinnt gegen OWNER_IDP_SUBJECT", async () => {
  const idp = await startIdp();
  const seed = seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        ownerName: "Jonas Beispiel",
        idpSubject: "bound-sub",
      },
    ],
  });
  const srv = await startServer({
    env: oauthEnv(idp, { OWNER_IDP_SUBJECT: "other-sub" }),
    seed,
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const boundTok = await idp.sign({ sub: "bound-sub" });
    assert.equal(await myNumberOver(srv, boundTok), OWNER_NUM, "bestehende Bindung loest auf");
    const envTok = await idp.sign({ sub: "other-sub" });
    const res = await mcpPost(`${srv.localUrl}/mcp`, envTok, toolCall("get_agent_number"));
    assert.equal(res.status, HTTP_OK, "abweichendes OWNER_IDP_SUBJECT wurde NICHT gebunden (set-if-absent No-Op)");
    assertReauthChallenge(await readToolResult(res));
  } finally {
    await srv.stop();
    await idp.close();
  }
});
