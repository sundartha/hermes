// I1: Identitaets-Funktionen (systemPrompt/disclosureSentence) ziehen ihren Namen
// ueber tenantContext(call.tenantId), NICHT mehr global. Deckt den Realtime-Pfad,
// den der curl-Greeting nicht erreicht (server.js returnt im realtime-Pfad VOR dem
// Greeting-Bau). Rein-Unit: beide Funktionen tragen call -> kein Spawn noetig.
// DATA_DIR im before vor dem ersten config-Import (Repo-Regel, wie tenant-context.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

const TENANT_B = "B";
const B_OWNER = "Maria"; // tenant.ownerName von B
const B_NUMBER = "+4915255555555";

let config, store, systemPrompt, disclosureSentence;
before(async () => {
  // Store mit aktivem Tenant B (eigener ownerName) ueber tempDataDir seeden, dann
  // DATA_DIR setzen, DANN dynamisch importieren (config/json.js binden dataDir beim Laden).
  const seed = seedState({
    calls: [],
    tenants: [{ id: TENANT_B, status: "active", ownerName: B_OWNER }],
    numbers: [
      {
        id: "num_b",
        e164: B_NUMBER,
        tenantId: TENANT_B,
        provider: "twilio",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
  process.env.DATA_DIR = tempDataDir(seed);
  config = (await import("../src/config.js")).config;
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
  assert.ok(systemPrompt(callFor(OWNER_TENANT_ID)).includes(config.ownerName.split(" ")[0]));
});

test("disclosureSentence ohne callerName folgt B's ownerName (Fallback bleibt)", () => {
  assert.ok(disclosureSentence(callFor(TENANT_B)).includes(B_OWNER));
});

test("disclosureSentence Owner-Call nennt weiter config.ownerName (voll)", () => {
  assert.ok(disclosureSentence(callFor(OWNER_TENANT_ID)).includes(config.ownerName));
});

test("callerName wird ignoriert - Tenant-ownerName bindet (G1)", () => {
  assert.ok(disclosureSentence(callFor(TENANT_B, { callerName: "Klaus" })).includes(B_OWNER));
  assert.ok(!disclosureSentence(callFor(TENANT_B, { callerName: "Klaus" })).includes("Klaus"));
});
