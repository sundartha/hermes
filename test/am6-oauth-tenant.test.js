// AM6: claude.ai-App-OAuth funktionsfaehig - Identity->Tenant-Mapping (G4).
// Spawn (node:test), offline (Mini-IdP), KEIN pglite in dieser Datei (Lehre: NIE mit
// Server-Spawn mischen). MCP_AUTH=oauth + MULTI_TENANT=true. Beweist die zwei AM6-Wurzeln:
//   G4-a Binding: OWNER_IDP_SUBJECT bindet den Owner-sub an den Bootstrap-Tenant (der die
//        aktive Nummer haelt) -> resolveTenant findet ihn ueber den sub-Claim.
//   G4-b Threading: das /mcp-Gateway loest den Tenant aus sub auf und reicht ihn als
//        X-Internal-Tenant durch -> get_my_number ist NICHT leer, SELBST wenn das Token
//        einen email-Claim traegt (genau die frueher divergierende email/sub-Achse).
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
} from "./helpers.js";
import { hashEmail } from "../src/util.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER_SUB = "owner-sub-1";
const OWNER_NUM = "+18643028341"; // Live-Diskriminator (Owner-Telnyx-DID)

// Env fuer einen Owner-OAuth-Resource-Server: OAUTH_AUDIENCE bleibt leer -> Default
// publicUrl/mcp == idp.sign-Default-aud, also werden Tokens akzeptiert.
const oauthEnv = (idp, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  OWNER_IDP_SUBJECT: OWNER_SUB,
  ...extra,
});

// structuredContent.number aus einem get_my_number tools/call ueber /mcp (echter
// MCP-HTTP-Pfad: Gateway -> registerTools(scopedTenant) -> REST /api/state mit
// X-Internal-Tenant). Das ist der Lesepfad, den AM6 dicht macht.
async function myNumberOver(srv, token) {
  const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_my_number"));
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
    // Token traegt sub UND email: die email-Achse (Profile) divergiert frueher von der
    // sub-Achse (Tenant). Der Gateway-Audit muss trotzdem tenant=owner zeigen.
    const token = await idp.sign({ sub: OWNER_SUB, email: "owner@team.test" });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_my_number"));
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

test("AM6 e2e: Owner-Token MIT email -> get_my_number traegt die aktive Nummer (honest-green)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    // DER Test, der die email/sub-Divergenz als gefixt beweist: trotz email-Claim
    // liefert get_my_number die aktive Bootstrap-Nummer, nicht leer.
    const token = await idp.sign({ sub: OWNER_SUB, email: "owner@team.test" });
    assert.equal(await myNumberOver(srv, token), OWNER_NUM);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 fail-closed: unbekannter sub -> tenant=reject + get_my_number leer (kein Fremd-Tenant)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const token = await idp.sign({ sub: "fremd-sub", email: "fremd@team.test" });
    const number = await myNumberOver(srv, token);
    assert.ok(!number, "unbekannte Identitaet -> keine Nummer (kein Fremd-Tenant)");
    assert.notEqual(number, OWNER_NUM, "NIE die Owner-Nummer");
    await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("fremd@team.test")} tenant=reject`));
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 fail-closed: verifiziertes Token OHNE sub -> tenant=reject + get_my_number leer (NIE Owner)", async () => {
  // FAIL-CLOSED-REGRESSION (AM6-Blocker R2): jose erzwingt den sub-Claim nicht. Ein
  // verifiziertes REMOTE-Token mit email, aber OHNE sub (noSubject) darf NICHT auf den
  // Owner-/Bootstrap-Tenant fallen - sonst laese der Angreifer die Owner-Nummer (PII)
  // und koennte place_call als Owner ausloesen. Erwartet: leere Nummer + tenant=reject.
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    ownerNumber: { e164: OWNER_NUM, provider: "telnyx" },
  });
  try {
    const token = await idp.sign({ email: "evil@attacker.test" }, { noSubject: true });
    const number = await myNumberOver(srv, token);
    assert.ok(!number, "subloses Token -> keine Nummer (kein Owner-Tenant)");
    assert.notEqual(number, OWNER_NUM, "NIE die Owner-Nummer");
    await waitForLog(srv, new RegExp(`\\[mcp\\] ${hashEmail("evil@attacker.test")} tenant=reject`));
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("AM6 set-if-absent: bestehende idpSubject-Bindung gewinnt gegen OWNER_IDP_SUBJECT", async () => {
  const idp = await startIdp();
  // Owner-Tenant traegt schon eine Bindung (bound-sub); OWNER_IDP_SUBJECT weicht ab.
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
    assert.ok(
      !(await myNumberOver(srv, envTok)),
      "abweichendes OWNER_IDP_SUBJECT wurde NICHT gebunden (set-if-absent No-Op)",
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});
