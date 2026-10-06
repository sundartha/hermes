import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startServer,
  startIdp,
  seedState,
  seedCall,
  mcpPost,
  toolCall,
  readToolResult,
  assertReauthChallenge,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT_A = "t_a",
  TENANT_B = "t_b";
const SUB_A = "sub-a",
  SUB_B = "sub-b",
  SUB_GHOST = "sub-ohne-tenant";
const NUM_A = "+4915110000001",
  NUM_B = "+4915110000002";
const PRIV_A = "+491737252163",
  PRIV_B = "+491737252164";
const HTTP_OK = 200,
  HTTP_UNAUTHORIZED = 401,
  HTTP_NOT_FOUND = 404;
const MIN_ROUTE_FILE_COUNT = 4;

const activeNumber = (id, e164, tenantId) => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

function seedTwoTenants({ calls = [] } = {}) {
  const callA = seedCall({ id: "call_a", twilioSid: "CAa", tenantId: TENANT_A, status: "completed" });
  const callB = seedCall({ id: "call_b", twilioSid: "CAb", tenantId: TENANT_B, status: "completed" });
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: TENANT_A,
        status: "active",
        idpSubject: SUB_A,
        ownerName: "Alice A",
        kycLevel: "card",
        privateNumber: PRIV_A,
      },
      {
        id: TENANT_B,
        status: "active",
        idpSubject: SUB_B,
        ownerName: "Bob B",
        kycLevel: "card",
        privateNumber: PRIV_B,
      },
    ],
    numbers: [activeNumber("num_a", NUM_A, TENANT_A), activeNumber("num_b", NUM_B, TENANT_B)],
    profiles: { [TENANT_A]: { maxCallsPerHour: null }, [TENANT_B]: { maxCallsPerHour: null } },
    calls: [callA, callB, ...calls],
  });
}

async function getAs(srv, idpSub, pfad) {
  const res = await fetch(`${srv.localUrl}${pfad}`, {
    headers: idpSub ? { "X-Internal-Identity": idpSub } : {},
  });
  const body = res.status === HTTP_OK ? await res.json() : await res.json().catch(() => null);
  return { status: res.status, body };
}
const ids = (list) => list.map((item) => item.id);

test("E4-10: /api/state ist tenant-gescoped, OHNE MULTI_TENANT gesetzt zu haben", async () => {
  const srv = await startServer({ seed: seedTwoTenants() });
  try {
    const { body: bodyA } = await getAs(srv, SUB_A, "/api/state");
    const { body: bodyB } = await getAs(srv, SUB_B, "/api/state");
    assert.ok(ids(bodyA.calls).includes("call_a"), "A sieht den eigenen Call");
    assert.ok(!ids(bodyA.calls).includes("call_b"), "A sieht den B-Call NICHT");
    assert.ok(ids(bodyB.calls).includes("call_b"), "B sieht den eigenen Call");
    assert.ok(!ids(bodyB.calls).includes("call_a"), "B sieht den A-Call NICHT");
  } finally {
    await srv.stop();
  }
});

test("E4-11: Legacy-Call ohne tenantId gehoert niemandem", async () => {
  const legacy = seedCall({ id: "call_legacy", twilioSid: "CAlegacy", status: "completed" });
  delete legacy.tenantId;
  const srv = await startServer({ seed: seedTwoTenants({ calls: [legacy] }) });
  try {
    for (const sub of [SUB_A, SUB_B]) {
      const { body } = await getAs(srv, sub, "/api/state");
      assert.ok(!ids(body.calls).includes("call_legacy"), `${sub} sieht den Legacy-Call NICHT`);
    }
    const res = await getAs(srv, SUB_A, "/api/calls/call_legacy");
    assert.equal(res.status, HTTP_NOT_FOUND);
  } finally {
    await srv.stop();
  }
});

test("E4-12: verifizierte, aber unbekannte Identitaet -> 200 mit leeren Listen (A5, gepinnt)", async () => {
  const srv = await startServer({ seed: seedTwoTenants() });
  try {
    const { status, body } = await getAs(srv, SUB_GHOST, "/api/state");
    assert.equal(status, HTTP_OK);
    assert.equal(body.calls.length, 0);
    assert.equal(body.actionItems.length, 0);
    assert.equal(body.notifications.length, 0);
  } finally {
    await srv.stop();
  }
});

test("E4-13: GET /api/calls/:id auf einen fremden Call -> 404 (beide id-Achsen)", async () => {
  const srv = await startServer({ seed: seedTwoTenants() });
  try {
    const byId = await getAs(srv, SUB_A, "/api/calls/call_b");
    assert.equal(byId.status, HTTP_NOT_FOUND);
    const bySid = await getAs(srv, SUB_A, "/api/calls/CAb");
    assert.equal(bySid.status, HTTP_NOT_FOUND);
  } finally {
    await srv.stop();
  }
});

test("E4-14: GET /api/calls/:id/consult auf einen fremden Call -> 404", async () => {
  const srv = await startServer({ seed: seedTwoTenants() });
  try {
    const res = await getAs(srv, SUB_A, "/api/calls/call_b/consult");
    assert.equal(res.status, HTTP_NOT_FOUND);
  } finally {
    await srv.stop();
  }
});

test("E4-15: POST /api/calls/:id/consult/answer auf einen fremden Call -> 404, keine Aenderung", async () => {
  const srv = await startServer({ seed: seedTwoTenants() });
  try {
    const before = srv.readStore().calls.find((call) => call.id === "call_b");
    const res = await fetch(`${srv.localUrl}/api/calls/call_b/consult/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": SUB_A },
      body: JSON.stringify({ event_id: "evt_1", answers: ["x"] }),
    });
    assert.equal(res.status, HTTP_NOT_FOUND);
    const after = srv.readStore().calls.find((call) => call.id === "call_b");
    assert.equal(JSON.stringify(after), JSON.stringify(before), "der B-Call bleibt unveraendert");
  } finally {
    await srv.stop();
  }
});

test("E4-16: POST /api/calls/:id/cancel auf einen fremden Call -> 404, Status bleibt aktiv", async () => {
  const active = seedCall({ id: "call_b_active", tenantId: TENANT_B, status: "active" });
  const srv = await startServer({ seed: seedTwoTenants({ calls: [active] }) });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls/call_b_active/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": SUB_A },
    });
    assert.equal(res.status, HTTP_NOT_FOUND);
    const after = srv.readStore().calls.find((call) => call.id === "call_b_active");
    assert.equal(after.status, "active", "der B-Call laeuft unveraendert weiter");
  } finally {
    await srv.stop();
  }
});

test("E4-19: Request ohne X-Internal-Identity ueber den Loopback -> Betreiber-Kanal unveraendert", async () => {
  const srv = await startServer({ seed: seedTwoTenants() });
  try {
    const { status, body } = await getAs(srv, null, "/api/state");
    assert.equal(status, HTTP_OK);
    assert.ok(!ids(body.calls).includes("call_a"), "der Betreiber-Kanal sieht NICHT den A-Call");
    assert.ok(!ids(body.calls).includes("call_b"), "der Betreiber-Kanal sieht NICHT den B-Call");
  } finally {
    await srv.stop();
  }
});

const oauthEnv = (idp) => ({ MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer });

test("E4-17: /mcp, gueltiges Token OHNE Tenant-Zuordnung -> Tool-Liste sichtbar, Aufruf gesperrt", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const token = await idp.sign({ sub: SUB_GHOST });
    const listRes = await mcpPost(`${srv.localUrl}/mcp`, token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.equal(listRes.status, HTTP_OK);
    const listResult = await readToolResult(listRes);
    assert.ok(Array.isArray(listResult.tools) && listResult.tools.length > 0);
    const callRes = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    assert.equal(callRes.status, HTTP_OK);
    const result = await readToolResult(callRes);
    assertReauthChallenge(result);
    assert.ok(!JSON.stringify(result).includes(NUM_A), "NIE die Nummer eines fremden Mandanten");
    assert.ok(!JSON.stringify(result).includes(NUM_B), "NIE die Nummer eines fremden Mandanten");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("E4-18: /mcp, gueltiges Token MIT Tenant-Zuordnung -> 200, Tool-Liste nicht leer (Positiv-Kontrolle)", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const token = await idp.sign({ sub: SUB_A });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(res.status, HTTP_OK);
    const text = await res.text();
    assert.ok(text.includes("tools"), "die Tool-Liste ist Teil der Antwort");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("E4-18b: /mcp ohne Token -> 401 mit WWW-Authenticate (Torschluss sitzt HINTER mcpAuth)", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    assert.ok(res.headers.get("www-authenticate"), "WWW-Authenticate-Header bleibt gesetzt");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

const CALL_ENV = { FAKE_ORIGINATE: "true", ELEVENLABS_OUTBOUND_ENABLED: "false" };
const ALLOWLIST_A = { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: TENANT_A };

async function placeCallAndRead({ env = {}, identity = null, to }) {
  const srv = await startServer({ env: { ...CALL_ENV, ...env }, seed: seedTwoTenants() });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(identity ? { "X-Internal-Identity": identity } : {}),
      },
      body: JSON.stringify({ to, objective: "Test" }),
    });
    assert.equal(res.status, HTTP_OK);
    const { callId } = await res.json();
    return srv.readStore().calls.find((call) => call.id === callId);
  } finally {
    await srv.stop();
  }
}

test("E4-20: Richtung A - Tenant A ruft die eigene hinterlegte Nummer an -> calleeIsOwner true", async () => {
  const call = await placeCallAndRead({ env: ALLOWLIST_A, identity: SUB_A, to: PRIV_A });
  assert.strictEqual(call.calleeIsOwner, true);
  assert.equal(call.tenantId, TENANT_A, "die ECHTE tenantId wurde aufgeloest, nicht der Bootstrap-Tenant");
});

test("E4-21: Richtung B - Tenant B ruft die eigene hinterlegte Nummer an -> calleeIsOwner false (kein Fremd-Grant)", async () => {
  const call = await placeCallAndRead({ env: ALLOWLIST_A, identity: SUB_B, to: PRIV_B });
  assert.strictEqual(call.calleeIsOwner, false);
  assert.equal(call.tenantId, TENANT_B);
});

test("E4-22: Richtung B - Tenant B ruft die hinterlegte Nummer von A an -> calleeIsOwner false", async () => {
  const call = await placeCallAndRead({ env: ALLOWLIST_A, identity: SUB_B, to: PRIV_A });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("E4-23: Diagnose-Retention folgt der echten Tenant-Achse, nicht der Allowlist", async () => {
  const call = await placeCallAndRead({
    env: { ...ALLOWLIST_A, DIAGNOSTIC_RETENTION_DAYS: "7" },
    identity: SUB_B,
    to: PRIV_B,
  });
  assert.strictEqual(call.diagnostic, true);
  assert.equal(call.tenantId, TENANT_B);
  assert.strictEqual(call.calleeIsOwner, false);
});

test("E4-24: der Bootstrap-Tenant erbt die Ausnahme NICHT (identitaetsloser Anrufer)", async () => {
  const call = await placeCallAndRead({ env: ALLOWLIST_A, identity: null, to: PRIV_A });
  assert.equal(call.tenantId, BOOTSTRAP_TENANT_ID);
  assert.strictEqual(call.calleeIsOwner, false);
});

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "routes");
const FLAG_NEEDLE = "multi" + "Tenant";

function trefferIn(inhalt) {
  return inhalt.split("\n").filter((zeile) => zeile.includes(FLAG_NEEDLE)).length;
}

test("E4-30: keine Route liest mehr das Flag (Bestands-Gegenprobe: Dateien wurden tatsaechlich durchsucht)", () => {
  const dateien = fs.readdirSync(ROUTES_DIR).filter((datei) => datei.endsWith(".js"));
  assert.ok(dateien.length >= MIN_ROUTE_FILE_COUNT, "Positiv-Kontrolle: die Route-Dateien existieren");
  for (const name of ["_tenant.js", "api-read.js", "api-calls.js", "mcp.js"]) {
    assert.ok(dateien.includes(name), `Positiv-Kontrolle: ${name} liegt in src/routes/`);
  }
  const treffer = dateien.reduce(
    (sum, datei) => sum + trefferIn(fs.readFileSync(path.join(ROUTES_DIR, datei), "utf8")),
    0,
  );
  assert.equal(treffer, 0, "kein Vorkommen des Flags mehr in src/routes/");
});

test("E4-31: Positiv-Kontrolle der Suchfunktion selbst (Lehre pruefkommando-ohne-positiv-kontrolle)", () => {
  const zeile = "if (!config.tenancy." + FLAG_NEEDLE + ") return x;";
  assert.equal(trefferIn(zeile), 1);
});
