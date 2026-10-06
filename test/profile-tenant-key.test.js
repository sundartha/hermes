import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, startIdp, mcpPost, toolCall, waitForLog } from "./helpers.js";
import { maskNumber } from "../src/util.js";
import { makeDefaultState, setProfile, resolveProfile } from "../src/store/state-ops.js";
import { KYC_LEVEL } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

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

async function confirmedPlaceCallArgs(localUrl, args, tenantHeader) {
  const res = await fetch(`${localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": tenantHeader },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  return { ...args, confirmation_code: json.confirmation?.code };
}

function subscriberTenant(id, idpSubject) {
  return {
    id,
    status: "active",
    idpSubject,
    ownerName: `${id} Tester`,
    kycLevel: KYC_LEVEL.CARD,
  };
}

test("(a) Subscriber sub-only passiert das Profil-Gate -> keine_tenant_nummer, NICHT stundenlimit", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    seed: seedState({
      tenants: [subscriberTenant("t_sub", "sub-sub")],
      profiles: { t_sub: planProfileFor("business") },
    }),
  });
  try {
    const token = await idp.sign({ sub: "sub-sub" });
    const placeCallArgs = await confirmedPlaceCallArgs(
      srv.localUrl,
      { to: "+4915123123201", objective: "Termin" },
      "t_sub",
    );
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("place_call", placeCallArgs));
    assert.notEqual(res.status, 401);
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

test("(b) Owner sub-only nicht per Stundenlimit gesperrt (R2-Regressionsriegel)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp, { OWNER_IDP_SUBJECT: "owner-sub" }),
  });
  try {
    const token = await idp.sign({ sub: "owner-sub" });
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

test("(c) Profilloser Tenant -> stundenlimit (DEFAULT_PROFILE greift, kein Leck)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: oauthEnv(idp),
    seed: seedState({
      tenants: [subscriberTenant("t_np", "sub-np")],
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

test("(d) setProfile/resolveProfile trennen per tenantId (Map-Trennung)", () => {
  const s = makeDefaultState();
  setProfile(s, "t_a", { unrestricted: true });
  setProfile(s, "t_b", { maxCallsPerHour: 1 });
  assert.equal(resolveProfile(s, "t_a").unrestricted, true);
  assert.equal(resolveProfile(s, "t_b").unrestricted, false, "t_b erbt DEFAULT (kein t_a-Leck)");
  assert.notEqual(resolveProfile(s, "t_a").maxCallsPerHour, 1, "t_a traegt nicht t_b's Limit");
});
