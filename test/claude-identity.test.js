// I1: Identitaets-Funktionen (systemPrompt/disclosureSentence) ziehen ihren Namen
// ueber tenantContext(call.tenantId), NICHT mehr global. Rein-Unit: beide Funktionen
// tragen call -> kein Spawn noetig.
// DATA_DIR im before vor dem ersten config-Import (Repo-Regel, wie tenant-context.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT_B = "B";
const B_OWNER = "Maria"; // tenant.ownerName von B
const B_NUMBER = "+4915255555555";
// P2b: Owner-Identitaet lebt im Store (kein config.ownerName mehr) -> Owner-Tenant
// explizit mit ownerName seeden.
const OWNER_NAME = "Jonas Beispiel";

let store, systemPrompt, disclosureSentence;
before(async () => {
  // Store mit aktivem Tenant B (eigener ownerName) UND Owner-Tenant (eigener ownerName)
  // ueber tempDataDir seeden, dann DATA_DIR setzen, DANN dynamisch importieren
  // (config/json.js binden dataDir beim Laden).
  const seed = seedState({
    calls: [],
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER_NAME },
      { id: TENANT_B, status: "active", ownerName: B_OWNER },
    ],
    numbers: [
      {
        id: "num_b",
        e164: B_NUMBER,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
  process.env.DATA_DIR = tempDataDir(seed);
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt, disclosureSentence } = await import("../src/claude.js"));
});

const callFor = (tenantId, over = {}) =>
  seedCall({ tenantId, direction: "outbound", callerName: null, ...over });

test("seedState-Erweiterung ist route-faehig: B's Nummer loest auf Tenant B auf", () => {
  assert.equal(store.findTenantByNumber(B_NUMBER), TENANT_B);
});

test("systemPrompt zieht B's ownerName ueber tenantContext", () => {
  assert.ok(systemPrompt(callFor(TENANT_B)).includes(B_OWNER));
});

test("Owner-Call-Persona nennt den Vornamen (G1: systemPrompt = firstName)", () => {
  assert.ok(systemPrompt(callFor(BOOTSTRAP_TENANT_ID)).includes(OWNER_NAME.split(" ")[0]));
});

test("disclosureSentence ohne callerName folgt B's ownerName (Fallback bleibt)", () => {
  assert.ok(disclosureSentence(callFor(TENANT_B)).includes(B_OWNER));
});

test("disclosureSentence Owner-Call nennt den geseedeten Owner-ownerName (voll)", () => {
  assert.ok(disclosureSentence(callFor(BOOTSTRAP_TENANT_ID)).includes(OWNER_NAME));
});

test("callerName wird ignoriert - Tenant-ownerName bindet (G1)", () => {
  assert.ok(disclosureSentence(callFor(TENANT_B, { callerName: "Klaus" })).includes(B_OWNER));
  assert.ok(!disclosureSentence(callFor(TENANT_B, { callerName: "Klaus" })).includes("Klaus"));
});
