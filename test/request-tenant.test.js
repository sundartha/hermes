// I4, seit E4 ueberholt: requestTenant wurde urspruenglich ueber die /mcp-Audit-Logzeile
// beobachtet, weil damals KEIN Endpunkt filterte. Seit E4 gibt es dafuer einen echten
// Torschluss VOR dieser Logzeile (routes/mcp.js: TENANT_REJECT -> 403, bevor das
// [mcp]-Diagnose-Log ueberhaupt laeuft) - fuer jeden Reject-Fall ist die Logzeile also
// NICHT mehr der Beobachtungspunkt, sondern der Response-Status + der auth_failed-Audit
// (Muster test/am6-oauth-tenant.test.js). Reine Beobachtungs-Faelle (bekannter sub) bleiben
// bei der Logzeile.
//
// Reiner Spawn (startIdp + signiertes JWT mit sub), KEIN pglite in derselben Datei
// (Lehre: NIE mischen). Laeuft offline (startIdp ist ein lokaler HTTP-Server ohne
// Netz nach aussen, wie oauth.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  waitForLog,
  startIdp,
  seedState,
  mcpPost as post,
  MCP_AUDIENCE as AUDIENCE,
} from "./helpers.js";
import { hashEmail } from "../src/util.js";

const TENANT_B = "B";
const SUB_B = "sub-b";
const UNKNOWN_SUB = "sub-unbekannt";
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
// Tenant B aktiv mit idpSubject -> resolveTenant trifft ihn ueber den sub-Claim.
const seedTenantB = () =>
  seedState({ tenants: [{ id: TENANT_B, status: "active", idpSubject: SUB_B }] });
const oauthEnv = (issuer, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: issuer,
  OAUTH_AUDIENCE: AUDIENCE,
  ...extra,
});

test("V1: bekannter sub loest unbedingt auf tenant=B, OHNE MULTI_TENANT gesetzt zu haben", async () => {
  // E4: kein Env-Schalter kurzschliesst mehr auf Owner - ein bekannter sub-Claim loest
  // immer auf seinen echten Tenant auf, auch ohne MULTI_TENANT (BASE_ENV: "false").
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

test("V3: unbekannter sub -> /mcp 403 (E4-Torschluss, NIE Owner)", async () => {
  // E4: TENANT_REJECT wird VOR dem [mcp]-Diagnose-Log abgewiesen (routes/mcp.js) - die
  // Logzeile "tenant=reject" ist fuer diesen Fall kein erreichbarer Zustand mehr. Der
  // Beleg ist jetzt der Response-Status + der auth_failed-Audit (Muster am6-oauth-tenant).
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ sub: UNKNOWN_SUB });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), { error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V4: verifiziertes Token OHNE sub -> /mcp 403 (E4-Torschluss, vorhandenes Token ist eine Identitaet, NIE Owner)", async () => {
  // FAIL-CLOSED-REGRESSION (AM6-Blocker R2): jose erzwingt den sub-Claim nicht. Ein
  // verifiziertes REMOTE-Token mit req.auth, aber ohne sub-Claim, ist eine VORHANDENE
  // Identitaet und darf NIE auf den Owner-/Bootstrap-Tenant kollabieren (sonst laese ein
  // subloser Angreifer Owner-PII und triebe place_call als Owner). Das Owner-Gate haengt
  // an der ABWESENHEIT von req.auth, nicht an einem falsy sub -> hier TENANT_REJECT, seit
  // E4 mit 403 VOR dem [mcp]-Diagnose-Log abgewiesen.
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ email: "nosub@team.test" }, { noSubject: true });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), { error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
    await waitForLog(srv, /\[audit\] auth_failed .*path=\/mcp grund=kein_tenant/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});
