import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { runOutbound, assertDisclosureInGather } from "./_outbound-harness.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT_B = "B";
const B_FIRST = "Antonio";
const B_FULL = "Antonio Fotiadis dos Santos Francisco";

let systemPrompt, disclosureSentence;
before(async () => {
  const seed = seedState({
    calls: [],
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active", firstName: "Jonas", ownerName: "Jonas Beispiel" },
      { id: TENANT_B, status: "active", firstName: B_FIRST, ownerName: B_FULL },
    ],
  });
  process.env.DATA_DIR = tempDataDir(seed);
  await import("../src/config.js");
  ({ systemPrompt, disclosureSentence } = await import("../src/claude.js"));
});

const callFor = (tenantId, over = {}) => seedCall({ tenantId, direction: "outbound", ...over });

test("callerName-Override wirkungslos: Disclosure bindet an tenant.ownerName", () => {
  const sentence = disclosureSentence(callFor(TENANT_B, { callerName: "Klaus Spoofer" }));
  assert.ok(sentence.includes(B_FULL), "voller Tenant-Name muss in der Offenlegung stehen");
  assert.ok(!sentence.includes("Klaus"), "callerName darf NICHT eingesetzt werden");
});

test("Persona nennt den Vornamen, Offenlegung den vollen Namen (G1)", () => {
  const call = callFor(TENANT_B, { goal: "Termin" });
  const prompt = systemPrompt(call);
  assert.ok(prompt.includes(B_FIRST), "systemPrompt-Persona muss den Vornamen tragen");
  assert.ok(disclosureSentence(call).includes(B_FULL), "Offenlegung muss den vollen Namen tragen");
});

test("Offenlegung rendert nie '...von .' (kein leerer Name)", () => {
  const sentence = disclosureSentence(callFor(TENANT_B));
  assert.ok(!sentence.includes("im Auftrag von ."), "leerer Name darf nie gerendert werden");
  assert.ok(
    !disclosureSentence(callFor(BOOTSTRAP_TENANT_ID)).includes("im Auftrag von ."),
    "auch nicht fuer den Owner",
  );
});

test("/voice/outbound rendert die Offenlegung mit registriertem ownerName im Gather", async () => {
  const { body, status } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, 200);
  assertDisclosureInGather(body);
  assert.ok(!body.includes("im Auftrag von ."), "Outbound-Body darf keinen leeren Namen tragen");
});
