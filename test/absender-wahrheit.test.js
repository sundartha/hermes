import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
} from "./fixtures/elevenlabs-conversations.js";

let jsonStore, BOOTSTRAP, FROM_SOURCE;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-absender-wahrheit-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
  ({ FROM_SOURCE } = await import("../src/store/state-ops.js"));
});

function neuerOutboundAnruf(from = "+18643028341") {
  return jsonStore.createCall({
    direction: "outbound",
    from,
    to: "+4915005550002",
    goal: "Absender-Wahrheit sichern",
    tenantId: BOOTSTRAP,
  });
}

test("T1: maskierte Anbieter-Nutzlast (kein E.164) -> fromActualE164 bleibt null", () => {
  const call = neuerOutboundAnruf();
  const geliefert = CONVERSATION_DONE_WITH_ANALYSIS.metadata.phone_call.agent_number;
  assert.match(geliefert, /^\*\*\*/, "Vorbedingung: die Fixture ist maskiert, kein E.164");
  jsonStore.recordActualSender(call.id, { e164: geliefert, source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null, "kein Schreibweg hat einen Wert hinterlassen - ehrlich unbekannt");
});

test("T2: konstruierte E.164-Nutzlast, AUCH beim gescheiterten Anruf -> geschrieben", () => {
  const call = neuerOutboundAnruf();
  const KONSTRUIERTES_E164 = "+18643028341";
  assert.equal(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.status, "failed", "Vorbedingung: gescheiterter Anruf");
  jsonStore.recordActualSender(call.id, { e164: KONSTRUIERTES_E164, source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, KONSTRUIERTES_E164);
  assert.equal(gespeichert.fromSource, FROM_SOURCE.PROVIDER_MEASURED);
});

test("T3: EL-Fixture ohne metadata.phone_call -> fromActualE164/fromSource bleiben null", () => {
  const call = neuerOutboundAnruf();
  assert.equal(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.phone_call, undefined, "Vorbedingung");
  const geliefert = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata?.phone_call?.agent_number;
  jsonStore.recordActualSender(call.id, { e164: geliefert, source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null);
});

test("T4-b: TeXML-Zweig (benannte Auslassung) -> fromSource bleibt unangetastet (unknown)", () => {
  const call = neuerOutboundAnruf();
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null);
});

test("T5: set-once - ein zweiter Schreibversuch mit anderem Wert bleibt wirkungslos", () => {
  const call = neuerOutboundAnruf();
  jsonStore.recordActualSender(call.id, { e164: "+18643028341", source: FROM_SOURCE.PROVIDER_MEASURED });
  jsonStore.recordActualSender(call.id, { e164: "+15005550001", source: FROM_SOURCE.TENANT_DID });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, "+18643028341", "der ERSTE Wert zaehlt");
  assert.equal(gespeichert.fromSource, FROM_SOURCE.PROVIDER_MEASURED);
});

test("T6: Inbound-Anruf -> recordActualSender bleibt No-op, fromActualE164 bleibt null", () => {
  const call = jsonStore.createCall({
    direction: "inbound",
    from: "+4915005550002",
    to: "+18643028341",
    tenantId: BOOTSTRAP,
  });
  jsonStore.recordActualSender(call.id, { e164: "+18643028341", source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null);
});

test("T7: Bestandsschutz - call.from (from_e164) bleibt von recordActualSender unberuehrt", () => {
  const call = neuerOutboundAnruf("+18643028341");
  jsonStore.recordActualSender(call.id, { e164: "+15005550001", source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.from, "+18643028341", "from_e164 unveraendert trotz abweichender Messung");
  assert.notEqual(gespeichert.fromActualE164, gespeichert.from, "Messung und Soll-Nummer duerfen auseinanderlaufen");
});
