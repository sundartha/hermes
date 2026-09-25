// OUTBOUND-E5 (F3): die BUCHFUEHRUNG - der Store schreibt die TATSAECHLICH gesendete
// Absendernummer, oder ehrlich NICHTS (null), nie geraten. Getestet wird der EINZIGE
// Schreibweg (recordActualSender, store/state-ops.js) direkt mit REALEN bzw. ausdruecklich
// als konstruiert markierten Anbieter-Nutzlasten - kein Netz, kein echter Anruf.
//
// DATA_DIR VOR den store-Imports binden (Muster test/el-sip-call-id-join.test.js): json.js
// bindet seinen Dateipfad beim Import.
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

// T1: die MASKIERTE Bestands-Fixture (echt, s. Fixture-Modulkopf) traegt kein E.164 -
// die Formpruefung im Mutator greift, das Feld bleibt ehrlich NULL statt geraten.
test("T1: maskierte Anbieter-Nutzlast (kein E.164) -> fromActualE164 bleibt null", () => {
  const call = neuerOutboundAnruf();
  const geliefert = CONVERSATION_DONE_WITH_ANALYSIS.metadata.phone_call.agent_number;
  assert.match(geliefert, /^\*\*\*/, "Vorbedingung: die Fixture ist maskiert, kein E.164");
  jsonStore.recordActualSender(call.id, { e164: geliefert, source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null, "kein Schreibweg hat einen Wert hinterlassen - ehrlich unbekannt");
});

// T2: eine GETRENNTE, ausdruecklich als KONSTRUIERT markierte E.164-Nutzlast (kein
// gemessener Fund traegt hier ein ungemasktes E.164) - UND AUCH beim gescheiterten Anruf
// (status failed) wird sie geschrieben, weil metadata.phone_call laut Befund 27.08.
// befuellt ist, unabhaengig vom Ausgang.
test("T2: konstruierte E.164-Nutzlast, AUCH beim gescheiterten Anruf -> geschrieben", () => {
  const call = neuerOutboundAnruf();
  // KONSTRUIERT: kein gemessener Fund traegt hier ein ungemasktes E.164 (s. Testkopf).
  const KONSTRUIERTES_E164 = "+18643028341";
  assert.equal(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.status, "failed", "Vorbedingung: gescheiterter Anruf");
  jsonStore.recordActualSender(call.id, { e164: KONSTRUIERTES_E164, source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, KONSTRUIERTES_E164);
  assert.equal(gespeichert.fromSource, FROM_SOURCE.PROVIDER_MEASURED);
});

// T3: die EL-Fixture OHNE metadata.phone_call (CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
// s. deren Modulkommentar) -> kein E.164 lesbar, das Feld bleibt null.
test("T3: EL-Fixture ohne metadata.phone_call -> fromActualE164/fromSource bleiben null", () => {
  const call = neuerOutboundAnruf();
  assert.equal(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.phone_call, undefined, "Vorbedingung");
  const geliefert = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata?.phone_call?.agent_number;
  jsonStore.recordActualSender(call.id, { e164: geliefert, source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null);
});

// T4-b: der TeXML-Zweig - die BENANNTE Auslassung. Auf diesem Weg schreibt NICHTS das
// Feld - es bleibt exakt der createCall-Default: ehrlich unbekannt, NIE geraten. Diese
// Auslassung ist eine Entscheidung (Plan §3.6), kein Vergessen - dieser Test naegelt sie fest.
test("T4-b: TeXML-Zweig (benannte Auslassung) -> fromSource bleibt unangetastet (unknown)", () => {
  const call = neuerOutboundAnruf();
  // Bewusst: KEIN Aufruf von recordActualSender hier - der TeXML-Zweig in
  // routes/api-calls.js ruft ihn nicht (anders als elevenlabs/outbound.js).
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, null);
  assert.equal(gespeichert.fromSource, null);
});

// T5: Set-once - ein zweiter Ergebnisabruf mit ANDEREM Wert ueberschreibt den ersten NICHT.
test("T5: set-once - ein zweiter Schreibversuch mit anderem Wert bleibt wirkungslos", () => {
  const call = neuerOutboundAnruf();
  jsonStore.recordActualSender(call.id, { e164: "+18643028341", source: FROM_SOURCE.PROVIDER_MEASURED });
  jsonStore.recordActualSender(call.id, { e164: "+15005550001", source: FROM_SOURCE.TENANT_DID });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.fromActualE164, "+18643028341", "der ERSTE Wert zaehlt");
  assert.equal(gespeichert.fromSource, FROM_SOURCE.PROVIDER_MEASURED);
});

// T6: Inbound schreibt NIE - direction !== 'outbound' ist ein No-op, unabhaengig vom Wert.
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

// T7: Bestandsschutz - from_e164 (die SOLL-Nummer) bleibt unveraendert, egal was
// recordActualSender schreibt - Routing-/Tarif-/Geo-Pfade lesen weiterhin call.from.
test("T7: Bestandsschutz - call.from (from_e164) bleibt von recordActualSender unberuehrt", () => {
  const call = neuerOutboundAnruf("+18643028341");
  jsonStore.recordActualSender(call.id, { e164: "+15005550001", source: FROM_SOURCE.PROVIDER_MEASURED });
  const gespeichert = jsonStore.getCall(call.id);
  assert.equal(gespeichert.from, "+18643028341", "from_e164 unveraendert trotz abweichender Messung");
  assert.notEqual(gespeichert.fromActualE164, gespeichert.from, "Messung und Soll-Nummer duerfen auseinanderlaufen");
});
