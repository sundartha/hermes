// I4: requestTenant-Flag-Gating ueber die /mcp-Audit-Logzeile beobachtet. Da in
// I4 noch KEIN Endpunkt filtert, ist die Logzeile (`tenant=<id|reject|owner>`) der
// einzige Konsument von requestTenant - sie macht den aufgeloesten Tenant in Tests
// beobachtbar, ohne Verhalten am Request-Pfad zu aendern.
//
// Reiner Spawn (startIdp + signiertes JWT mit sub), KEIN pglite in derselben Datei
// (Lehre: NIE mischen). Laeuft offline (startIdp ist ein lokaler HTTP-Server ohne
// Netz nach aussen, wie oauth.test.js).
//
// Die Audit-Logzeile ist `if (req.auth)`-gated (nur OAuth setzt req.auth). Darum
// tragen ALLE Vektoren ein verifiziertes Token: nur so feuert die Zeile und ist der
// aufgeloeste Tenant beobachtbar. V4 (FEHLENDE Identitaet -> Owner) wird ueber ein
// verifiziertes Token OHNE sub-Claim getestet - das ist genau der !sub-&&-!internal-
// Zweig von requestTenant (localhost/stdio ohne req.auth erzeugt KEINE Logzeile und
// ist damit am Audit-Log nicht beobachtbar; die Semantik ist dieselbe).
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
// Tenant B aktiv mit idpSubject -> resolveTenant trifft ihn ueber den sub-Claim.
const seedTenantB = () =>
  seedState({ tenants: [{ id: TENANT_B, status: "active", idpSubject: SUB_B }] });
const oauthEnv = (issuer, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: issuer,
  OAUTH_AUDIENCE: AUDIENCE,
  ...extra,
});

test("V1 Flag aus + verifiziertes Token -> tenant=owner (byte-identisch)", async () => {
  const idp = await startIdp();
  // MULTI_TENANT NICHT gesetzt (BASE_ENV: "false") -> requestTenant kurzschliesst auf Owner.
  const srv = await startServer({ env: oauthEnv(idp.issuer), seed: seedTenantB() });
  try {
    const token = await idp.sign({ sub: SUB_B, email: "alice@team.test" });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.notEqual(res.status, 401);
    await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("alice@team.test")} tenant=owner`));
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V2 Flag an + bekannter sub -> tenant=B", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ sub: SUB_B });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.notEqual(res.status, 401);
    await waitForLog(srv, /\[mcp\].*tenant=B/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V3 Flag an + unbekannter sub -> tenant=reject (NIE Owner)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    const token = await idp.sign({ sub: UNKNOWN_SUB });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.notEqual(res.status, 401);
    await waitForLog(srv, /tenant=reject/);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("V4 Flag an + verifiziertes Token OHNE sub -> tenant=owner (fehlende Identitaet bleibt Owner)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp.issuer, { MULTI_TENANT: "true" }),
    seed: seedTenantB(),
  });
  try {
    // noSubject: kein sub-Claim -> req.auth.sub undefined -> !sub && !internal -> Owner.
    const token = await idp.sign({ email: "nosub@team.test" }, { noSubject: true });
    const res = await post(`${srv.localUrl}/mcp`, token);
    assert.notEqual(res.status, 401);
    await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("nosub@team.test")} tenant=owner`));
  } finally {
    await srv.stop();
    await idp.close();
  }
});
