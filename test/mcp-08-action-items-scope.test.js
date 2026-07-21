// MCP-08 (PLAN-LAUNCH-TESTS.md): list_action_items Tenant-Scoping.
//
// list_action_items (mcp-tools.js) liest s.actionItems aus GET /api/state und
// filtert nur nach !a.done - KEINE eigene Tenant-Filterung im Tool selbst. Die
// Tenant-Scoping-Grenze sitzt bereits eine Ebene tiefer, in routes/api-read.js
// GET /api/state: bei MULTI_TENANT=true liefert store.exportTenantData(tenantId)
// (state-ops.js) NUR die actionItems, deren callId zu einem Call DIESES Tenants
// gehoert (tenantCallScope: call.tenantId === tenantId). list_action_items erbt
// dieses Scoping automatisch ueber den gemeinsamen /api/state-Aufruf (Kommentar
// in api-read.js bestaetigt das explizit: "Die lesenden MCP-Tools ... erben das
// Scoping AUTOMATISCH ueber diese Route").
//
// Test faehrt echten Spawn-Server + echte POST /mcp-Route (Muster i6-write-scope
// .test.js: X-Internal-Identity direkt am Request, vom /mcp-Handler ueber
// requestTenant(req) -> internalIdentity(req) -> store.resolveTenant(idpSubject)
// aufgeloest - trusted NUR fuer echte Loopback-Aufrufer ohne X-Forwarded-For,
// s. routes/_tenant.js isTrustedLocalCaller). KEIN OAuth-IdP noetig, da MCP-08
// die Tenant-SCOPING-Grenze prueft, nicht die Auth-Verifikation selbst (die deckt
// bereits MCP-02/AM6 ab).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, toolCall, readToolResult } from "./helpers.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const SUB_A = "sub-a";
const SUB_B = "sub-b";

function actionItem({ id, callId, text }) {
  return { id, callId, text, type: "todo", done: false, createdAt: new Date().toISOString() };
}

// POST /mcp als eine bestimmte Tenant-Identitaet (oder Owner, wenn identity=null) -
// direkt am Request wie i6-write-scope.test.js, s. Datei-Kommentar oben.
function mcpCallAs(srv, identity, name, args = {}) {
  return fetch(`${srv.localUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify(toolCall(name, args)),
  });
}

function toolText(result) {
  return (result?.content || []).map((c) => c.text).join("\n");
}

test("MCP-08: list_action_items ist tenant-gescopt (Tenant A sieht nur A, Tenant B nur B, Owner keins von beiden)", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({
      tenants: [
        { id: TENANT_A, status: "active", idpSubject: SUB_A },
        { id: TENANT_B, status: "active", idpSubject: SUB_B },
      ],
      calls: [
        seedCall({ id: "call_a", tenantId: TENANT_A }),
        seedCall({ id: "call_b", tenantId: TENANT_B }),
      ],
      actionItems: [
        actionItem({ id: "ai_a1", callId: "call_a", text: "A-Sonderwunsch Kuchen" }),
        actionItem({ id: "ai_b1", callId: "call_b", text: "B-Sonderwunsch Blumen" }),
      ],
    }),
  });
  try {
    const resA = await mcpCallAs(srv, SUB_A, "list_action_items");
    assert.notEqual(resA.status, 401);
    const textA = toolText(await readToolResult(resA));
    assert.match(textA, /A-Sonderwunsch Kuchen/, "Tenant A sieht sein eigenes Item");
    assert.doesNotMatch(textA, /B-Sonderwunsch Blumen/, "Tenant A sieht NICHT Tenant B's Item");

    const resB = await mcpCallAs(srv, SUB_B, "list_action_items");
    const textB = toolText(await readToolResult(resB));
    assert.match(textB, /B-Sonderwunsch Blumen/, "Tenant B sieht sein eigenes Item");
    assert.doesNotMatch(textB, /A-Sonderwunsch Kuchen/, "Tenant B sieht NICHT Tenant A's Item");

    // Owner-Kanal (kein X-Internal-Identity -> requestTenant faellt auf den Bootstrap-
    // Tenant zurueck, s. routes/_tenant.js): hat KEINE eigenen Action Items im Seed ->
    // darf WEDER A's noch B's Item sehen (kein globaler /api/state.actionItems-Leck).
    const resOwner = await mcpCallAs(srv, null, "list_action_items");
    const textOwner = toolText(await readToolResult(resOwner));
    assert.doesNotMatch(textOwner, /A-Sonderwunsch Kuchen/, "Owner sieht NICHT Tenant A's Item");
    assert.doesNotMatch(textOwner, /B-Sonderwunsch Blumen/, "Owner sieht NICHT Tenant B's Item");
    assert.match(textOwner, /Keine offenen Action Items/, "Owner-Bucket bleibt leer");
  } finally {
    await srv.stop();
  }
});
