// G1: Identitaets-Bindung. Der offengelegte Auftraggeber ist fest an die registrierte
// Tenant-Identitaet gebunden (tenant.ownerName, voll), die LLM-Persona an den Vornamen
// (tenant.firstName). callerName ist KEIN Call-Parameter mehr (nicht spoofbar). Die
// Offenlegung rendert NIE einen leeren Namen ("...von ."). Rein-Unit gegen die
// exportierten claude.js-Funktionen + der Outbound-Renderer via G0-Harness (offline,
// LLM-frei). DATA_DIR im before vor dem ersten config-Import (Repo-Regel).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { runOutbound, assertDisclosureInGather } from "./_outbound-harness.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Tenant B mit getrenntem Vorname + vollem (mehrteiligem) Nachnamen: belegt, dass die
// Persona NUR den Vornamen nennt, die Offenlegung den VOLLEN Namen.
const TENANT_B = "B";
const B_FIRST = "Antonio";
const B_FULL = "Antonio Fotiadis dos Santos Francisco";

let systemPrompt, disclosureSentence;
before(async () => {
  const seed = seedState({
    calls: [],
    // P2b: Owner-Identitaet lebt im Store (kein config-Seed mehr). Beide Tenants tragen
    // ihren ownerName direkt -> der Owner-Disclosure-Pfad (Test 3/4) rendert keinen
    // leeren Namen.
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

// (1) callerName-Override ist wirkungslos: die Offenlegung bindet an tenant.ownerName.
test("callerName-Override wirkungslos: Disclosure bindet an tenant.ownerName", () => {
  const sentence = disclosureSentence(callFor(TENANT_B, { callerName: "Klaus Spoofer" }));
  assert.ok(sentence.includes(B_FULL), "voller Tenant-Name muss in der Offenlegung stehen");
  assert.ok(!sentence.includes("Klaus"), "callerName darf NICHT eingesetzt werden");
});

// (2) Persona = Vorname, Offenlegung = voller Name (Owner-Entscheidung #1).
test("Persona nennt den Vornamen, Offenlegung den vollen Namen (G1)", () => {
  const call = callFor(TENANT_B, { goal: "Termin" });
  const prompt = systemPrompt(call);
  assert.ok(prompt.includes(B_FIRST), "systemPrompt-Persona muss den Vornamen tragen");
  assert.ok(disclosureSentence(call).includes(B_FULL), "Offenlegung muss den vollen Namen tragen");
});

// (3) NEGATIV (Pre-Mortem a): die Offenlegung rendert NIE einen leeren Namen. Bei
// gebundener Identitaet kann "...von ." nicht entstehen (Wurzel des Gate-Risikos).
test("Offenlegung rendert nie '...von .' (kein leerer Name)", () => {
  const sentence = disclosureSentence(callFor(TENANT_B));
  assert.ok(!sentence.includes("im Auftrag von ."), "leerer Name darf nie gerendert werden");
  assert.ok(
    !disclosureSentence(callFor(BOOTSTRAP_TENANT_ID)).includes("im Auftrag von ."),
    "auch nicht fuer den Owner",
  );
});

// (4) /voice/outbound (LLM-frei) offenlegt mit dem registrierten Owner-Namen (voll),
// als Say IM Gather (G2). Beweis am echten Renderer (TwiML), nicht nur am Prompt.
test("/voice/outbound rendert die Offenlegung mit registriertem ownerName im Gather", async () => {
  const { body, status } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, 200);
  assertDisclosureInGather(body);
  assert.ok(!body.includes("im Auftrag von ."), "Outbound-Body darf keinen leeren Namen tragen");
});
