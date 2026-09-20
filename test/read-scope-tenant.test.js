// I5: Tenant-Scope auf alle daten-beruehrenden REST/MCP-Lesepfade (fail-closed).
// DAS GATE ist die ausfuehrbare Per-Lesepfad-Tabelle (positiv + negativ): jeder
// lesende Pfad sieht NUR die Daten des eigenen Tenants, NIE die eines fremden.
//
// Rein-Spawn (node:test), offline, KEIN pglite in derselben Datei (Lehre: NIE
// mischen -> Server-Spawn-Stall). Zwei aktive Tenants (Owner + "Maria") mit je
// eigener aktiver Nummer + eigenem idpSubject + eigenem ownerName + je eigenen
// calls/actionItems/notifications. Server-Kindprozess mit MULTI_TENANT=true.
//
// Identitaets-Threading: die lesenden MCP-Tools rufen intern die localhost-REST-API
// mit X-Internal-Identity. Der Test treibt GENAU diesen Pfad direkt (GET mit
// X-Internal-Identity = idpSubject ueber den localhost-Socket) -> exakt der
// requestTenant-REST-Pfad, den list_calls/get_transcript/... intern nutzen. Die
// MCP-Tabellen-Eintraege (8-11) sind ueber ihren REST-Pfad abgedeckt, nicht ueber
// einen echten MCP-Roundtrip (mcp-tools keyt heute auf email|sub, nicht idpSubject
// -> echte MCP-Tenant-Reads sind ein deferter Follow-up, fail-CLOSED, kein Leak).
//
// DOKU-INVENTAR (NICHT das Gate, aber Pflicht-Checkliste): jeder daten-beruehrende
// Lesepfad MUSS einen Tabellen-Eintrag bekommen. Heute:
//   GET /api/state    -> calls, actionItems, notifications, agent.{number,owner,
//                        ownerNumber}, usage, settings, calendar
//   GET /api/calls/:id -> get_call_status / get_transcript (Einzel-Call, id+twilioSid)
// Plattform-Service-Config (model, voiceEngine) + globales Safety-Gate
// (allowedNumbers) bleiben global (kein Tenant-Daten-Leck).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const SUB_OWNER = "sub-owner",
  SUB_B = "sub-b";
const TENANT_B = "B";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const OWNER_NUM = "+4915200000001",
  B_NUM = "+4915200000002";
const OWNER_NAME = "Jonas Beispiel"; // P2b: vom Harness in den Store geseedet (ensureOwnerNumber), G1
const B_NAME = "Maria";

// Zwei aktive Tenants, je eine aktive Nummer + je 1 call+actionItem+notification.
// Owner-Call traegt tenantId=BOOTSTRAP_TENANT_ID, B-Call tenantId=B; actionItems/
// notifications haengen ueber callId an "ihrem" Call (kein eigenes tenantId).
function seedTwoTenants() {
  const ownerCall = seedCall({
    id: "call_owner",
    twilioSid: "CAowner",
    tenantId: BOOTSTRAP_TENANT_ID,
    status: "completed",
  });
  const bCall = seedCall({ id: "call_b", twilioSid: "CAb", tenantId: TENANT_B, status: "completed" });
  return seedState({
    calls: [ownerCall, bCall],
    actionItems: [
      {
        id: "ai_owner",
        callId: "call_owner",
        text: "Owner-Item",
        type: "todo",
        done: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "ai_b",
        callId: "call_b",
        text: "B-Item",
        type: "todo",
        done: false,
        createdAt: new Date().toISOString(),
      },
    ],
    notifications: [
      {
        id: "nt_owner",
        title: "Owner-Notif",
        body: "owner",
        callId: "call_owner",
        at: new Date().toISOString(),
      },
      { id: "nt_b", title: "B-Notif", body: "b", callId: "call_b", at: new Date().toISOString() },
    ],
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active", idpSubject: SUB_OWNER },
      { id: TENANT_B, status: "active", idpSubject: SUB_B, ownerName: B_NAME },
    ],
    numbers: [
      {
        id: "num_owner",
        e164: OWNER_NUM,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
      {
        id: "num_b",
        e164: B_NUM,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
}

// GET mit X-Internal-Identity (= idpSubject) ueber den localhost-Socket.
const getJsonAs = async (srv, idpSub, path) => {
  const res = await fetch(`${srv.localUrl}${path}`, { headers: { "X-Internal-Identity": idpSub } });
  return { status: res.status, body: res.status === HTTP_OK ? await res.json() : null };
};
const ids = (list) => list.map((item) => item.id);

// ----- DAS GATE: GET /api/state, je Identitaet -> nur eigene Daten -----
test("I5 /api/state ist tenant-gescoped: jede Identitaet sieht NUR ihre eigenen Daten", async () => {
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedTwoTenants() });
  try {
    const { body: owner } = await getJsonAs(srv, SUB_OWNER, "/api/state");
    const { body: bodyB } = await getJsonAs(srv, SUB_B, "/api/state");

    // calls: Positiv (sieht eigenen) + Negativ (sieht fremden NICHT)
    assert.ok(ids(owner.calls).includes("call_owner"), "Owner sieht eigenen Call");
    assert.ok(!ids(owner.calls).includes("call_b"), "Owner sieht B-Call NICHT");
    assert.ok(ids(bodyB.calls).includes("call_b"), "B sieht eigenen Call");
    assert.ok(!ids(bodyB.calls).includes("call_owner"), "B sieht Owner-Call NICHT");

    // actionItems
    assert.ok(ids(owner.actionItems).includes("ai_owner"), "Owner sieht eigenes Action Item");
    assert.ok(!ids(owner.actionItems).includes("ai_b"), "Owner sieht B-Action-Item NICHT");
    assert.ok(ids(bodyB.actionItems).includes("ai_b"), "B sieht eigenes Action Item");
    assert.ok(!ids(bodyB.actionItems).includes("ai_owner"), "B sieht Owner-Action-Item NICHT");

    // notifications
    assert.ok(ids(owner.notifications).includes("nt_owner"), "Owner sieht eigene Notification");
    assert.ok(!ids(owner.notifications).includes("nt_b"), "Owner sieht B-Notification NICHT");
    assert.ok(ids(bodyB.notifications).includes("nt_b"), "B sieht eigene Notification");
    assert.ok(!ids(bodyB.notifications).includes("nt_owner"), "B sieht Owner-Notification NICHT");
  } finally {
    await srv.stop();
  }
});

// ----- DAS GATE: agent-Block fail-closed (Beweis gegen Owner-only-Schein) -----
test("I5 /api/state agent-Block ist tenant-gescoped + fail-closed (Nummer/Owner/ownerNumber)", async () => {
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedTwoTenants() });
  try {
    const { body: owner } = await getJsonAs(srv, SUB_OWNER, "/api/state");
    const { body: bodyB } = await getJsonAs(srv, SUB_B, "/api/state");

    // agent.number: aktive Tenant-Nummer, NIE die fremde
    assert.equal(owner.agent.number, OWNER_NUM, "Owner sieht eigene Nummer");
    assert.equal(bodyB.agent.number, B_NUM, "B sieht eigene Nummer");
    assert.notEqual(bodyB.agent.number, OWNER_NUM, "B sieht NICHT die Owner-Nummer");
    assert.notEqual(owner.agent.number, B_NUM, "Owner sieht NICHT die B-Nummer");

    // agent.owner: pro-Tenant ownerName (echt, nicht global)
    assert.equal(owner.agent.owner, OWNER_NAME, "Owner-Sicht traegt Owner-Fallback-Namen");
    assert.equal(bodyB.agent.owner, B_NAME, "B sieht 'Maria'");
    assert.notEqual(owner.agent.owner, B_NAME, "Owner sieht NICHT 'Maria'");

    // agent.ownerNumber: Feld seit P4 ganz entfernt (war seit P2b immer "") -> keine
    // Sicht traegt es, ein fail-OPEN-Leak der Owner-Privatnummer ist strukturell
    // unmoeglich.
    assert.ok(!("ownerNumber" in bodyB.agent), "ownerNumber-Feld ist entfernt (P4)");
    assert.ok(!("ownerNumber" in owner.agent), "ownerNumber-Feld ist entfernt (P4)");

    // Plattform-Service-Config bleibt global (kein Daten-Leck). Das frueher hier gepruefte
    // agent.allowedNumbers entfaellt seit outbound-p3 (Feld aus der Agent-Flaeche entfernt).
    assert.equal(owner.agent.voiceEngine, bodyB.agent.voiceEngine, "voiceEngine bleibt global");
  } finally {
    await srv.stop();
  }
});

// ----- DAS GATE: GET /api/calls/:id (get_call_status / get_transcript) -----
test("I5 /api/calls/:id ist tenant-gescoped: fremder Call -> 404 (nicht 403), beide id-Achsen", async () => {
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedTwoTenants() });
  try {
    // Positiv: jeder auf seinen eigenen Call -> 200
    assert.equal(
      (await getJsonAs(srv, SUB_OWNER, "/api/calls/call_owner")).status,
      HTTP_OK,
      "Owner -> eigener Call 200",
    );
    assert.equal(
      (await getJsonAs(srv, SUB_B, "/api/calls/call_b")).status,
      HTTP_OK,
      "B -> eigener Call 200",
    );

    // Negativ: fremder Call_id -> 404 (kein Existenz-Leck, NICHT 403)
    const foreignById = await getJsonAs(srv, SUB_OWNER, "/api/calls/call_b");
    assert.equal(foreignById.status, HTTP_NOT_FOUND, "Owner -> B-Call_id 404");
    // Negativ: getCall matcht AUCH twilioSid -> auch die zweite id-Achse muss 404 sein
    const foreignBySid = await getJsonAs(srv, SUB_OWNER, "/api/calls/CAb");
    assert.equal(foreignBySid.status, HTTP_NOT_FOUND, "Owner -> B-twilioSid 404 (getCall matcht twilioSid)");
  } finally {
    await srv.stop();
  }
});

// ----- E4-Bestand: die Mandantengrenze gilt OHNE gesetztes MULTI_TENANT -----
test("E4-Bestand: Legacy-Call OHNE tenantId ist fuer niemanden sichtbar (/api/state) und nicht abrufbar (404)", async () => {
  // MULTI_TENANT NICHT gesetzt (BASE_ENV: "false"). Seit E4 unbedingt: ein Legacy-Call
  // ohne tenantId gehoert niemandem, ein B-Call gehoert nicht dem Owner - beide bleiben
  // fuer den Owner unsichtbar.
  const legacy = seedCall({ id: "call_legacy", twilioSid: "CAlegacy", status: "completed" });
  delete legacy.tenantId; // Altbestand kennt kein tenantId
  const bCall = seedCall({ id: "call_b2", tenantId: TENANT_B, status: "completed" });
  const seed = seedState({ calls: [legacy, bCall] });

  const srv = await startServer({ seed });
  try {
    const { body } = await getJsonAs(srv, SUB_OWNER, "/api/state");
    assert.ok(!ids(body.calls).includes("call_legacy"), "Legacy-Call ohne tenantId gehoert niemandem");
    assert.ok(!ids(body.calls).includes("call_b2"), "B-Call ist fuer den Owner unsichtbar");
    // Unbedingter Guard (E4) -> auch bei ungesetztem Flag 404
    assert.equal(
      (await getJsonAs(srv, SUB_OWNER, "/api/calls/call_legacy")).status,
      HTTP_NOT_FOUND,
      "Legacy-Call /api/calls/:id = 404",
    );
    // usage darf NIE undefined sein (Owner-Bucket ueber usageOf)
    assert.ok(body.usage, "usage-Bucket vorhanden (kein undefined)");
  } finally {
    await srv.stop();
  }
});
