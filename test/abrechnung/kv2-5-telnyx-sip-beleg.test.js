import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCostTruing, SWEEP_TRIGGER } from "../../src/billing/cost-truing.js";
import { makeDefaultState, createCall, usageFor } from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { emptyUsage } from "../../src/store.js";
import { makeStubStore, fakeConfig, isoMinutesAgo } from "../cost-truing-harness.js";
import {
  KOSTENPROFIL, KOSTENART, KOSTENPROFILE, KOSTENARTEN,
  PFLICHTTYPEN_AUS_ENV, PFLICHTTYPEN_UNGEMESSEN,
  pflichttypenFuerProfil, legacyKostenprofil, kostenprofilFuerAnruf,
} from "../../src/billing/kostenarten.js";
import { sweepTraegerFuerProfil, sweepBelegBetrag, belegVollstaendig, SWEEP_BELEG_ABLEHNUNG } from "../../src/billing/sweep-kostenbeleg.ts";
import { isBelegRef } from "../../src/store/cost-evidence.js";

process.env.TELNYX_API_BASE = process.env.TELNYX_API_BASE || "https://telnyx.test";
process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY || "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = process.env.PROVIDER_CURRENCY || "USD";
const { telnyxVoice, ASSIGNABLE_COST_RECORD_TYPES } = await import("../../src/telephony/adapters/telnyx/voice.js");

const FULL_RECORD_TYPES = ["sip-trunking", "call-control"];
const DEFAULT_ENDED_MINUTES_AGO = 200;
const VORHER_COST_CENTS = 100;
const TELNYX_SIP_MICRO_CENTS = 4_010_000;
const TELNYX_CALL_RECORDS_MICRO_CENTS = 5_000_000;
const ESTIMATE_CENTS_EL = 30;
const ESTIMATE_CENTS_TELNYX = 20;
const NACHHER_COST_CENTS_TELNYX = 85;

function seedUsageCents(state, tenantId, costCents) {
  Object.assign(state.usage, { [tenantId]: { ...emptyUsage(), costCents } });
}

function control(records) {
  return {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords() {
      return { ok: true, records };
    },
  };
}

function voiceControl(impl) {
  return () => impl;
}

function makeDueElCall(state, { nowMs, tenantId = BOOTSTRAP_TENANT_ID, sipCallId = "otb_4101m190brwyf4mb9cwvhts7rymk", endedMinutesAgo = DEFAULT_ENDED_MINUTES_AGO, estimatedCostCents = null }) {
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId, provider: "telnyx" });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  call.sipCallId = sipCallId;
  call.costProfile = KOSTENPROFIL.EL_CONVAI_SIP;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

function makeDueTelnyxCall(state, { nowMs, tenantId = BOOTSTRAP_TENANT_ID, callControlId = "cc_1", endedMinutesAgo = DEFAULT_ENDED_MINUTES_AGO, estimatedCostCents = null, costProfile = null }) {
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId, provider: "telnyx" });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  call.callControlId = callControlId;
  if (costProfile) call.costProfile = costProfile;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

test("(a) el_convai_sip mit ausschliesslich Telnyx-SIP-Beleg bewegt NULL Cent auf der Gate-Achse", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, VORHER_COST_CENTS);
  const call = makeDueElCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_EL });
  const store = makeStubStore(state, { nowMs });
  const remBefore = usageFor(state, BOOTSTRAP_TENANT_ID).costCorrectionMicroCentsRem;
  let korrekturAufrufe = 0;
  const echtApply = store.applyCostCorrectionCents.bind(store);
  store.applyCostCorrectionCents = (...args) => {
    korrekturAufrufe++;
    return echtApply(...args);
  };
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const sipRecord = { recordType: "sip-trunking", costMicroCents: TELNYX_SIP_MICRO_CENTS, currency: "USD", billedSec: 60, legId: call.sipCallId };
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control([sipRecord])), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(korrekturAufrufe, 0, "kein Buchungsaufruf: ohne Abschluss kein Settlement - der zweite Pflicht-Traeger fehlt (seit KV2-11 ohne EL-Riegel)");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "costCents bit-gleich");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCorrectionMicroCentsRem, remBefore, "Rest bit-gleich");

  const zeilen = store.callCostEvidence(call.id);
  assert.equal(zeilen.length, 1, "genau EINE Belegzeile - keine telnyx_call_records-Zeile fuer die EL-Route");
  assert.equal(zeilen[0].traeger, KOSTENART.TELNYX_SIP);
  assert.equal(zeilen[0].reife, "belegt");
  assert.equal(zeilen[0].betragMikroCents, TELNYX_SIP_MICRO_CENTS);
  assert.equal(zeilen[0].waehrung, "USD");
  assert.equal(zeilen[0].belegRef, call.sipCallId);
});

test("(b) Telnyx-Engine-Anruf: dieselbe Korrektur wie im Bestand, PLUS eine telnyx_call_records-Zeile", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, VORHER_COST_CENTS);
  const call = makeDueTelnyxCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_TELNYX, costProfile: KOSTENPROFIL.TELNYX_BUDGET });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const records = FULL_RECORD_TYPES.map((recordType, i) => ({
    recordType, costMicroCents: i === 0 ? TELNYX_CALL_RECORDS_MICRO_CENTS : 0, currency: "USD", billedSec: 120, legId: "cc_1",
  }));
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(records)), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, NACHHER_COST_CENTS_TELNYX, "identische Korrektur wie vor KV2-5");
  assert.equal(call.costTruedSource, "kostenbuch_vollbeleg");

  const zeilen = store.callCostEvidence(call.id);
  assert.equal(zeilen.length, 1, "genau EINE Belegzeile - keine telnyx_sip-Zeile fuer die Telnyx-Route");
  assert.equal(zeilen[0].traeger, KOSTENART.TELNYX_CALL_RECORDS);
  assert.equal(zeilen[0].reife, "belegt");
  assert.equal(zeilen[0].betragMikroCents, TELNYX_CALL_RECORDS_MICRO_CENTS);
});

test("(e) Pool ohne text-to-speech-Records laesst recordRelayTtsCharacters ungerufen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueElCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_EL });
  const store = makeStubStore(state, { nowMs });
  let ttsAufrufe = 0;
  const echtTts = store.recordRelayTtsCharacters.bind(store);
  store.recordRelayTtsCharacters = (...args) => {
    ttsAufrufe++;
    return echtTts(...args);
  };
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const sipRecord = { recordType: "sip-trunking", costMicroCents: TELNYX_SIP_MICRO_CENTS, currency: "USD", billedSec: 60, legId: call.sipCallId };
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control([sipRecord])), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(ttsAufrufe, 0);
});

test("(f) pflichttypenFuerProfil: die Telnyx-Env-Profile liefern DIESELBE Referenz wie der Env-Wert", () => {
  const env = Object.freeze(["sip-trunking", "call-control"]);
  for (const profil of [
    KOSTENPROFIL.TELNYX_BUDGET,
    KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  ]) {
    assert.equal(pflichttypenFuerProfil(profil, env), env, `Profil ${profil} muss dieselbe Referenz liefern (Identitaet)`);
  }
  assert.equal(pflichttypenFuerProfil("unbekanntes_profil", env), PFLICHTTYPEN_UNGEMESSEN);
});

test("(f) el_convai_sip.pflichttypen ist NICHT der Env-Marker (eigene, am Anbieter zu messende Menge)", () => {
  assert.notEqual(KOSTENPROFILE[KOSTENPROFIL.EL_CONVAI_SIP].pflichttypen, PFLICHTTYPEN_AUS_ENV);
});

test("(f) Ableitungs-Riegel: Profil-Pflichttypen sind NICHT gleich KOSTENARTEN[telnyx_call_records].belegtypen", () => {
  const { belegtypen } = KOSTENARTEN[KOSTENART.TELNYX_CALL_RECORDS];
  for (const profil of Object.values(KOSTENPROFIL)) {
    const eintrag = KOSTENPROFILE[profil].pflichttypen;
    if (!Array.isArray(eintrag)) continue;
    assert.notDeepEqual([...eintrag].sort(), [...belegtypen].sort());
  }
});

test("(f) alle gesetzten Profil-Literale sind Teilmenge von ASSIGNABLE_COST_RECORD_TYPES", () => {
  for (const profil of Object.values(KOSTENPROFIL)) {
    const eintrag = KOSTENPROFILE[profil].pflichttypen;
    if (!Array.isArray(eintrag)) continue;
    for (const typ of eintrag) assert.ok(ASSIGNABLE_COST_RECORD_TYPES.includes(typ), `${typ} ist nicht zuordenbar`);
  }
});

test("(f) Richtung 1: telnyx_budget mit NUR call-control -> incomplete, keine Erstattung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, VORHER_COST_CENTS);
  makeDueTelnyxCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_TELNYX, costProfile: KOSTENPROFIL.TELNYX_BUDGET });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const records = [{ recordType: "call-control", costMicroCents: TELNYX_CALL_RECORDS_MICRO_CENTS, currency: "USD", billedSec: 120, legId: "cc_1" }];
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(records)), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "keine Erstattung ohne Vollstaendigkeitsbeweis");
});

test("(g) unvollstaendiger Pool (kein sip-trunking) -> genau eine 'vorlaeufig'-Zeile", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueTelnyxCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_TELNYX, costProfile: KOSTENPROFIL.TELNYX_BUDGET });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const records = [{ recordType: "call-control", costMicroCents: TELNYX_CALL_RECORDS_MICRO_CENTS, currency: "USD", billedSec: 120, legId: "cc_1" }];
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(records)), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const zeilen = store.callCostEvidence(call.id);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].traeger, KOSTENART.TELNYX_CALL_RECORDS);
  assert.equal(zeilen[0].reife, "vorlaeufig");
});

test("(h) Altzeile OHNE costProfile, MIT sipCallId -> null Cent (Legacy-Umlenkung)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, VORHER_COST_CENTS);
  const call = makeDueElCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_EL });
  call.costProfile = null;
  const store = makeStubStore(state, { nowMs });
  let korrekturAufrufe = 0;
  const echtApply = store.applyCostCorrectionCents.bind(store);
  store.applyCostCorrectionCents = (...args) => {
    korrekturAufrufe++;
    return echtApply(...args);
  };
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const sipRecord = { recordType: "sip-trunking", costMicroCents: TELNYX_SIP_MICRO_CENTS, currency: "USD", billedSec: 60, legId: call.sipCallId };
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control([sipRecord])), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(korrekturAufrufe, 0, "Legacy-Umlenkung muss auch profillose EL-Altzeilen schuetzen");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS);
});

test("(h) Gegenprobe: gewoehnliche Altzeile OHNE costProfile und OHNE sipCallId erstattet weiter wie im Bestand", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, VORHER_COST_CENTS);
  makeDueTelnyxCall(state, { nowMs, estimatedCostCents: ESTIMATE_CENTS_TELNYX });
  const store = makeStubStore(state, { nowMs });
  let korrekturAufrufe = 0;
  const echtApply = store.applyCostCorrectionCents.bind(store);
  store.applyCostCorrectionCents = (...args) => {
    korrekturAufrufe++;
    return echtApply(...args);
  };
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const records = FULL_RECORD_TYPES.map((recordType, i) => ({
    recordType, costMicroCents: i === 0 ? TELNYX_CALL_RECORDS_MICRO_CENTS : 0, currency: "USD", billedSec: 120, legId: "cc_1",
  }));
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(records)), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(korrekturAufrufe, 1, "die gewoehnliche Altzeile bleibt buchbar - ohne diese Gegenprobe waere (h) auch bei abgeschalteter Legacy-Umlenkung gruen");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, NACHHER_COST_CENTS_TELNYX);
});

test("legacyKostenprofil: sipCallId gewinnt gegen direction", () => {
  assert.equal(legacyKostenprofil({ sipCallId: "otb_x", direction: "inbound" }), KOSTENPROFIL.EL_CONVAI_SIP);
  assert.equal(legacyKostenprofil({ sipCallId: null, direction: "inbound" }), KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  assert.equal(legacyKostenprofil({ sipCallId: null, direction: "outbound" }), KOSTENPROFIL.TELNYX_BUDGET);
});

test("kostenprofilFuerAnruf: gesetztes, bekanntes costProfile gewinnt gegen die Legacy-Zuordnung", () => {
  assert.equal(
    kostenprofilFuerAnruf({ costProfile: KOSTENPROFIL.TELNYX_BUDGET, sipCallId: "otb_x" }),
    KOSTENPROFIL.TELNYX_BUDGET,
  );
});

test("kostenprofilFuerAnruf: fehlendes costProfile faellt auf die Legacy-Zuordnung zurueck, ein gesetztes unbekanntes NICHT", () => {
  assert.equal(kostenprofilFuerAnruf({ costProfile: null, sipCallId: "otb_x" }), KOSTENPROFIL.EL_CONVAI_SIP);
  assert.equal(kostenprofilFuerAnruf({ costProfile: undefined, sipCallId: "otb_x" }), KOSTENPROFIL.EL_CONVAI_SIP);
  assert.equal(kostenprofilFuerAnruf({ costProfile: "unbekannt", sipCallId: "otb_x" }), "unbekannt");
});

test("sweepTraegerFuerProfil: el_convai_sip -> telnyx_sip, die Telnyx-Profile -> telnyx_call_records, sonst null", () => {
  assert.equal(sweepTraegerFuerProfil(KOSTENPROFIL.EL_CONVAI_SIP), KOSTENART.TELNYX_SIP);
  for (const profil of [
    KOSTENPROFIL.TELNYX_BUDGET,
    KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  ]) {
    assert.equal(sweepTraegerFuerProfil(profil), KOSTENART.TELNYX_CALL_RECORDS);
  }
  assert.equal(sweepTraegerFuerProfil("unbekannt"), null);
});

test("sweepBelegBetrag: Matrix 4.6 (kein Beleg, 0-bei-Menge, 0-ohne-Menge, gueltig)", () => {
  assert.deepEqual(sweepBelegBetrag({ mikroCents: null, mengeAngabe: 0 }), { ablehnung: SWEEP_BELEG_ABLEHNUNG.KEIN_BELEG });
  assert.deepEqual(sweepBelegBetrag({ mikroCents: 0, mengeAngabe: 60 }), { ablehnung: SWEEP_BELEG_ABLEHNUNG.NULL_BEI_MENGE });
  assert.deepEqual(sweepBelegBetrag({ mikroCents: 0, mengeAngabe: 0 }), { mikroCents: 0 });
  assert.deepEqual(sweepBelegBetrag({ mikroCents: 4_010_000, mengeAngabe: 60 }), { mikroCents: 4_010_000 });
  assert.deepEqual(sweepBelegBetrag({ mikroCents: -1, mengeAngabe: 0 }), { ablehnung: SWEEP_BELEG_ABLEHNUNG.BETRAG_UNBRAUCHBAR });
});

test("belegVollstaendig: source+billedSecTotal, isBookableCents gehoert NICHT dazu", () => {
  assert.equal(belegVollstaendig({ source: "telnyx_detail_records", billedSecTotal: 60 }), true);
  assert.equal(belegVollstaendig({ source: "telnyx_detail_records", billedSecTotal: 0 }), false);
  assert.equal(belegVollstaendig({ source: "incomplete", billedSecTotal: 60 }), false);
});

test("beleg_ref-Formregel: 'v3:...'-Anker (Base64url mit '=') wird angenommen", () => {
  assert.equal(isBelegRef("v3:MdI91X4lWFEs7IgbBEOT9M4="), true);
});

test("beleg_ref-Formregel: eine Rufnummer, eine E-Mail und ein Freitext werden weiterhin abgelehnt", () => {
  assert.equal(isBelegRef("+4915799990001"), false);
  assert.equal(isBelegRef("foo@bar.de"), false);
  assert.equal(isBelegRef("ein satz mit leerzeichen"), false);
});

test("assignCostRecords: sip_call_id === legId ordnet OHNE call_control_id zu", () => {
  const legId = "otb_abcdef123456";
  const pool = {
    ok: true,
    raw: [{
      record_type: "sip-trunking", cost: "0.0401", currency: "USD",
      sip_call_id: legId, telnyx_session_id: "sess_1", started_at: "2026-08-01T10:00:00Z",
      finished_at: "2026-08-01T10:01:00Z", billed_sec: 60,
    }],
  };
  const res = telnyxVoice.assignCostRecords(pool, { legId, startedAt: "2026-08-01T09:59:00Z", endedAt: "2026-08-01T10:02:00Z" });
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1);
});

test("assignCostRecords: eine FREMDE sip_call_id wird nicht zugeordnet", () => {
  const legId = "otb_abcdef123456";
  const pool = {
    ok: true,
    raw: [{
      record_type: "sip-trunking", cost: "0.0401", currency: "USD",
      sip_call_id: "otb_ganz_anders", telnyx_session_id: "sess_2", started_at: "2026-08-01T10:00:00Z",
      finished_at: "2026-08-01T10:01:00Z", billed_sec: 60,
    }],
  };
  const res = telnyxVoice.assignCostRecords(pool, { legId, startedAt: "2026-08-01T09:59:00Z", endedAt: "2026-08-01T10:02:00Z" });
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 0);
});

test("assignCostRecords: Bestandsfall call_control_id === legId bleibt unveraendert zugeordnet", () => {
  const legId = "v3:LoD0swXYmiEsyntheticAnchorForTestsOnly0000000000000";
  const pool = {
    ok: true,
    raw: [{
      record_type: "sip-trunking", cost: "0.0401", currency: "USD",
      call_control_id: legId, telnyx_session_id: "sess_3", started_at: "2026-08-01T10:00:00Z",
      finished_at: "2026-08-01T10:01:00Z", billed_sec: 60,
    }],
  };
  const res = telnyxVoice.assignCostRecords(pool, { legId, startedAt: "2026-08-01T09:59:00Z", endedAt: "2026-08-01T10:02:00Z" });
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1);
});

test("assignCostRecords: ein 'v3:'-legId trifft KEIN sip_call_id-Feld und umgekehrt", () => {
  const legId = "v3:AndereWeltAlsSip00000000000000000000000000000000000";
  const pool = {
    ok: true,
    raw: [{
      record_type: "sip-trunking", cost: "0.0401", currency: "USD",
      sip_call_id: "otb_voellig_anders", telnyx_session_id: "sess_4", started_at: "2026-08-01T10:00:00Z",
      finished_at: "2026-08-01T10:01:00Z", billed_sec: 60,
    }],
  };
  const res = telnyxVoice.assignCostRecords(pool, { legId, startedAt: "2026-08-01T09:59:00Z", endedAt: "2026-08-01T10:02:00Z" });
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 0);
});

import { schreibeSweepKostenbeleg, sumMicroCents, SIP_TRUNKING_RECORD_TYPE } from "../../src/billing/sweep-kostenbeleg.ts";

const H5B_SIP_ANRUF = { id: "call_h5b", costProfile: KOSTENPROFIL.EL_CONVAI_SIP, sipCallId: "otb_h5b" };
const H5B_MESSUNG = { source: "detail_records", billedSecTotal: 40, actualCostMicroCents: 3_000_000 };

function h5bSchreibe({ records, schreibFehler }) {
  const belege = [];
  const zeilen = { warn: [], error: [] };
  const store = {
    recordCallCostEvidence(eintrag) {
      if (schreibFehler !== undefined) throw schreibFehler;
      belege.push(eintrag);
    },
  };
  const alt = { warn: console.warn, error: console.error };
  console.warn = (...t) => zeilen.warn.push(t.join(" "));
  console.error = (...t) => zeilen.error.push(t.join(" "));
  try {
    schreibeSweepKostenbeleg({ store, call: H5B_SIP_ANRUF, measured: H5B_MESSUNG, records });
  } finally {
    console.warn = alt.warn;
    console.error = alt.error;
  }
  return { belege, zeilen };
}

test("h5b SIP-Beleg summiert nur Zeiten ganzer positiver Sekunden", () => {
  const { belege } = h5bSchreibe({
    records: [
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 2_000_000, billedSec: 30 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: -5 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 500_000 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 500_000, billedSec: 1.5 },
    ],
  });
  assert.equal(belege.length, 1);
  assert.equal(belege[0].traeger, KOSTENART.TELNYX_SIP);
  assert.equal(belege[0].betragMikroCents, 4_000_000);
  assert.deepEqual(belege[0].detail, { billed_sec: 30 });
});

test("h5b SIP-Satz ohne Betrag: kein Beleg, Ablehnungsgrund im Log", () => {
  const { belege, zeilen } = h5bSchreibe({ records: [{ recordType: SIP_TRUNKING_RECORD_TYPE, billedSec: 30 }] });
  assert.equal(belege.length, 0);
  assert.equal(zeilen.warn.length, 1);
  assert.match(zeilen.warn[0], new RegExp(`grund=${SWEEP_BELEG_ABLEHNUNG.KEIN_BELEG}`));
});

test("h5b sumMicroCents: ein Satz ohne Betrag macht die Summe unbrauchbar", () => {
  assert.equal(sumMicroCents([{ costMicroCents: 1_000_000 }, {}]), null);
  assert.equal(sumMicroCents([{ costMicroCents: 1_000_000 }, { costMicroCents: 2_000_000 }]), 3_000_000);
});

const H5B_SCHREIBFEHLER = [
  ["Error", new Error("kaputt"), "Belegschreibung fehlgeschlagen (call=call_h5b): art=Error"],
  ["TypeError", new TypeError("kaputt"), "Belegschreibung fehlgeschlagen (call=call_h5b): art=TypeError"],
  ["Text", "nur ein Text", "Belegschreibung fehlgeschlagen (call=call_h5b): art=string"],
  ["null", null, "Belegschreibung fehlgeschlagen (call=call_h5b): art=object"],
];

for (const [name, fehler, erwartet] of H5B_SCHREIBFEHLER) {
  test(`h5b Schreibfehler (${name}) wird geloggt und nicht geworfen`, () => {
    const { zeilen } = h5bSchreibe({
      records: [{ recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: 30 }],
      schreibFehler: fehler,
    });
    assert.equal(zeilen.error.length, 1);
    assert.ok(zeilen.error[0].endsWith(erwartet), zeilen.error[0]);
    assert.ok(!zeilen.error[0].includes("kaputt") && !zeilen.error[0].includes("nur ein Text"), zeilen.error[0]);
  });
}

const H5B_UNBRAUCHBARE_BETRAEGE = [["negativ", -1], ["gebrochen", 1.5], ["Text", "7"], ["null", null], ["NaN", Number.NaN]];

for (const [name, betrag] of H5B_UNBRAUCHBARE_BETRAEGE) {
  test(`h5b sumMicroCents: ${name}er Betrag macht die Summe unbrauchbar`, () => {
    assert.equal(sumMicroCents([{ costMicroCents: betrag }]), null);
  });
}

test("h5b sumMicroCents: Betrag 0 zählt, eine Summe über der sicheren Grenze nicht", () => {
  assert.equal(sumMicroCents([{ costMicroCents: 0 }]), 0);
  assert.equal(sumMicroCents([{ costMicroCents: Number.MAX_SAFE_INTEGER }, { costMicroCents: 1 }]), null);
});

test("h5b SIP-Beleg: Satz mit Sekunden 0 und mit Text-Sekunden zählt keine Zeit", () => {
  const { belege } = h5bSchreibe({
    records: [
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: 0 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: "20" },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: 7 },
    ],
  });
  assert.deepEqual(belege[0].detail, { billed_sec: 7 });
});
