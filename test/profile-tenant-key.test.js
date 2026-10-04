// Phase S: Profil-Rechte-Achse email-keyed -> tenantId-keyed (Go-live Call-Block-Fix).
// Beweist (deterministisch ueber Audit-Log-Gruende, nicht nur "gruen"), dass das
// Rechteprofil seit Phase S auf die tenantId keyt - der Go-live-Bug war, dass ein
// Subscriber-Token ohne email-Claim (nur sub) am email-keyed DEFAULT_PROFILE(0)-User-Hour-
// Gate haengen blieb. MCP_AUTH=oauth + MULTI_TENANT=true (Production-Pfad; Live-Log zeigt
// tenant=t_user_...). Spawn + Mini-IdP, KEIN pglite in dieser Datei (Lehre p6a: pglite +
// Server-Spawn NIE mischen; pure Unit (d) + Spawn ist erlaubt, vgl. a4-default-profile-zero).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, startIdp, mcpPost, toolCall, waitForLog } from "./helpers.js";
import { maskNumber } from "../src/util.js";
import { makeDefaultState, setProfile, resolveProfile } from "../src/store/state-ops.js";
import { KYC_LEVEL } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

// Offline-Diskriminator: 500 = alle Gates passiert (originateCall wirft ohne
// TELNYX_API_KEY, s. BASE_ENV in helpers.js), 403/429/400 = ein Gate hat gesperrt.

// T2-13 (N-10): CALL_CONFIRMATION_SECRET testweise gesetzt - ohne bestaetigten
// confirmation_code wuerde place_call gar nicht mehr bis zum jeweils geprueften Profil-/
// Nummern-Gate kommen.
const TEST_CONFIRMATION_SECRET = "profile-tenant-key-test-secret-mind-32-zeichen";
const sternImMuster = (text) => text.replace(/\*/g, "\\*");
const oauthEnv = (idp, extra = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  ALLOWED_COUNTRY_CODES: "*",
  CALL_CONFIRMATION_SECRET: TEST_CONFIRMATION_SECRET,
  ...extra,
});

// Holt den Bestaetigungs-Code direkt an der Route (derselbe Loopback-Aufrufer wie der
// MCP-Handler); tenantHeader bindet ihn - wie das echte /mcp-Gateway per
// X-Internal-Tenant - an den Mandanten, dessen Gate der jeweilige Testfall pruefen will.
async function confirmedPlaceCallArgs(localUrl, args, tenantHeader) {
  const res = await fetch(`${localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": tenantHeader },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  return { ...args, confirmation_code: json.confirmation?.code };
}

// Ein telefonbarer Nicht-Owner-Tenant: aktiv, CARD-verifiziert, mit ownerName (passiert
// KYC- + Identitaets-Gate). idpSubject macht ihn ueber resolveTenant auffindbar.
function subscriberTenant(id, idpSubject) {
  return {
    id,
    status: "active",
    idpSubject,
    ownerName: `${id} Tester`,
    kycLevel: KYC_LEVEL.CARD,
  };
}

// (a) Subscriber sub-only passiert das Profil-Gate. Token traegt NUR sub (kein email-Claim,
// genau der Go-live-Bug-Fall). Profil unter der tenantId -> place_call laeuft bis zum
// SPAETEREN Nummern-Gate (keine_tenant_nummer), NICHT zum frueheren stundenlimit.
test("(a) Subscriber sub-only passiert das Profil-Gate -> keine_tenant_nummer, NICHT stundenlimit", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    seed: seedState({
      tenants: [subscriberTenant("t_sub", "sub-sub")],
      profiles: { t_sub: planProfileFor("business") }, // Profil unter der tenantId (Phase S)
    }),
  });
  try {
    const token = await idp.sign({ sub: "sub-sub" }); // kein email-Claim
    const placeCallArgs = await confirmedPlaceCallArgs(
      srv.localUrl,
      { to: "+4915123123201", objective: "Termin" },
      "t_sub",
    );
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
    assert.notEqual(res.status, 401);
    // Block erst am Nummern-Gate (t_sub hat keine aktive Nummer) -> das Profil-Gate ist passiert.
    // tenant=t_sub im keine_tenant_nummer-Audit belegt die korrekte Tenant-Aufloesung.
    await waitForLog(
      srv,
      new RegExp(
        `\\[audit\\] place_call_denied ip=\\S+ to=${sternImMuster(maskNumber("+4915123123201"))} grund=keine_tenant_nummer tenant=t_sub`,
      ),
    );
    assert.equal(srv.stdout.includes("4915123123201"), false);
    assert.ok(
      !/grund=stundenlimit/.test(srv.stdout),
      "Profil-Gate darf NICHT am stundenlimit blocken (Go-live-Bug)",
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// (b) Owner sub-only nicht gesperrt (R2). Der harte Regressionsriegel fuer den Go-live-Bug:
// frueher kollabierte resolveProfile(sub) auf DEFAULT_PROFILE(0) -> 429. Jetzt mappt
// resolveProfile(BOOTSTRAP) auf OWNER_PROFILE -> place_call passiert (bis Originate/500).
test("(b) Owner sub-only nicht per Stundenlimit gesperrt (R2-Regressionsriegel)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp, { OWNER_IDP_SUBJECT: "owner-sub" }),
  });
  try {
    const token = await idp.sign({ sub: "owner-sub" }); // kein email-Claim
    const placeCallArgs = await confirmedPlaceCallArgs(
      srv.localUrl,
      { to: "+4915123123202", objective: "Termin" },
      "owner",
    );
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
    assert.notEqual(res.status, 401);
    await waitForLog(
      srv,
      new RegExp(
        `\\[audit\\] place_call ip=\\S+ to=${sternImMuster(maskNumber("+4915123123202"))} call=\\S+ provider=\\S+ requestedBy=owner-sub`,
      ),
    );
    assert.equal(srv.stdout.includes("4915123123202"), false);
    assert.ok(
      !/grund=stundenlimit/.test(srv.stdout),
      "Owner darf NIE per Stundenlimit gesperrt werden (R2)",
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// (c) Profilloser Tenant bleibt 429 (kein Leck, Sec1). t_np ist aktiv+CARD+ownerName (passiert
// KYC/Identitaet), hat aber KEIN Profil -> DEFAULT_PROFILE(0) greift -> stundenlimit.
// Isoliert das Profil-Gate: BOOTSTRAP-Gleichheit, KEIN Falsy-Kollaps auf Owner.
test("(c) Profilloser Tenant -> stundenlimit (DEFAULT_PROFILE greift, kein Leck)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    seed: seedState({
      tenants: [subscriberTenant("t_np", "sub-np")], // KEIN Profil unter t_np
    }),
  });
  try {
    const token = await idp.sign({ sub: "sub-np" });
    const placeCallArgs = await confirmedPlaceCallArgs(
      srv.localUrl,
      { to: "+4915123123203", objective: "Termin" },
      "t_np",
    );
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
    assert.notEqual(res.status, 401);
    // Der numberGateError-Audit traegt grund + requestedBy (kein tenant=); das [mcp]-Log
    // zeigt tenant=t_np, requestedBy=sub-np bindet die Ablehnung an das Token.
    await waitForLog(
      srv,
      new RegExp(
        `\\[audit\\] place_call_denied ip=\\S+ to=${sternImMuster(maskNumber("+4915123123203"))} grund=stundenlimit requestedBy=sub-np`,
      ),
    );
    assert.equal(srv.stdout.includes("4915123123203"), false);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// (d) Map-Trennung (Unit, state-ops): zwei tenantId-Keys halten unabhaengige Profile;
// resolveProfile keyt key-agnostisch auf die tenantId (kein Cross-Key-Leck).
test("(d) setProfile/resolveProfile trennen per tenantId (Map-Trennung)", () => {
  const s = makeDefaultState();
  setProfile(s, "t_a", { unrestricted: true });
  setProfile(s, "t_b", { maxCallsPerHour: 1 });
  assert.equal(resolveProfile(s, "t_a").unrestricted, true);
  assert.equal(resolveProfile(s, "t_b").unrestricted, false, "t_b erbt DEFAULT (kein t_a-Leck)");
  assert.notEqual(resolveProfile(s, "t_a").maxCallsPerHour, 1, "t_a traegt nicht t_b's Limit");
});
