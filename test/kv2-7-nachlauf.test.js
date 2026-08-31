// KV2-7 (tasks/kostenv2/spec-kv2-7.md, Abnahme (g)): der Phasenschnitt-Nachlauf. In-
// process, netzfrei (Muster test/kv2-4-el-kosten-beleg.test.js Ebene 1). Testname traegt
// bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NACHLAUF_SKIP,
  istImPhasenschnittGelatcht,
  oeffneGelatchteElAnrufe,
} from "../src/billing/nachlauf-phasenschnitt.js";
import {
  makeDefaultState,
  createCall,
  recordCallCostEvidence,
  callCostEvidence,
  schliesseKostenAbgleich,
  oeffneKostenAbgleichErneut,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, REIFE } from "../src/store/defaults.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";

// Store-Naht (Muster test/kv2-4-el-kosten-beleg.test.js#seedCall): nur die Methoden, die
// der Nachlauf tatsaechlich braucht.
function makeStore(state) {
  return {
    load: () => state,
    callCostEvidence: (callId) => callCostEvidence(state, callId),
    oeffneKostenAbgleichErneut: (callId) => oeffneKostenAbgleichErneut(state, callId),
  };
}

function seedCall(state, { costProfile, costTruedAtIso }) {
  const call = createCall(state, {
    direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx",
  });
  call.status = "completed";
  call.endedAt = new Date().toISOString();
  if (costProfile !== undefined) call.costProfile = costProfile;
  // KV2-8: Optionsobjekt statt drittem Positionsargument (Signaturwechsel, F1).
  if (costTruedAtIso !== undefined) schliesseKostenAbgleich(state, call.id, { closedAt: costTruedAtIso });
  return call;
}

function seedSipBeleg(state, callId) {
  recordCallCostEvidence(state, {
    callId, traeger: "telnyx_sip", reife: REIFE.BELEGT, betragMikroCents: 40_100, waehrung: "USD", quelle: "sweep_kostenbeleg",
  });
}

const JETZT_ISO = () => new Date().toISOString();
const ZWEI_TREFFER = 2; // G25: benannt statt nackter Zahl im assert

// ---- (g) Treffer: gelatchte Altzeile wird wieder geoeffnet -----------------------------

test("(g) Treffer: el_convai_sip, costTruedAt gesetzt, telnyx_sip-Beleg, KEINE elevenlabs_convai-Zeile -> wird wieder geoeffnet", () => {
  const state = makeDefaultState();
  const call = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, costTruedAtIso: JETZT_ISO() });
  seedSipBeleg(state, call.id);
  const store = makeStore(state);

  const { treffer, grund } = istImPhasenschnittGelatcht({ call, belege: store.callCostEvidence(call.id) });
  assert.equal(treffer, true);
  assert.equal(grund, undefined);

  const dryRun = oeffneGelatchteElAnrufe({ store, apply: false });
  assert.equal(dryRun.treffer.length, 1);
  assert.equal(dryRun.treffer[0].id, call.id);
  assert.notEqual(call.costTruedAt, null, "Dry-Run mutiert nichts");

  const applyRun = oeffneGelatchteElAnrufe({ store, apply: true });
  assert.equal(applyRun.treffer.length, 1);
  assert.equal(call.costTruedAt, null, "nach dem Nachlauf ist der Anruf wieder offen");
});

test("(g) zweiter Lauf auf demselben Datensatz ist ein No-Op (bereits null)", () => {
  const state = makeDefaultState();
  const call = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, costTruedAtIso: JETZT_ISO() });
  seedSipBeleg(state, call.id);
  const store = makeStore(state);

  oeffneGelatchteElAnrufe({ store, apply: true });
  assert.equal(call.costTruedAt, null);

  const zweiterLauf = oeffneGelatchteElAnrufe({ store, apply: true });
  assert.equal(zweiterLauf.treffer.length, 0, "kein Treffer mehr");
  assert.equal(
    zweiterLauf.skipped.find((eintrag) => eintrag.id === call.id)?.reason,
    NACHLAUF_SKIP.NICHT_GELATCHT,
  );
});

// ---- Gegenprobe: Altzeile OHNE jede Belegzeile bleibt unveraendert ---------------------

test("Gegenprobe: el_convai_sip mit costTruedAt, aber OHNE jede call_cost_evidence-Zeile, bleibt unveraendert", () => {
  const state = makeDefaultState();
  const call = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, costTruedAtIso: JETZT_ISO() });
  const store = makeStore(state);
  const gesetztCostTruedAt = call.costTruedAt;

  const { treffer, grund } = istImPhasenschnittGelatcht({ call, belege: store.callCostEvidence(call.id) });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_SKIP.KEIN_SIP_BELEG);

  const report = oeffneGelatchteElAnrufe({ store, apply: true });
  assert.equal(report.treffer.length, 0);
  assert.equal(call.costTruedAt, gesetztCostTruedAt, "unveraendert");
});

// ---- Gegenprobe: Dry-Run mutiert nichts ------------------------------------------------

test("Gegenprobe: Dry-Run (apply=false) mutiert keinen Datensatz, auch bei mehreren Treffern", () => {
  const state = makeDefaultState();
  const callA = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, costTruedAtIso: JETZT_ISO() });
  seedSipBeleg(state, callA.id);
  const callB = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, costTruedAtIso: JETZT_ISO() });
  seedSipBeleg(state, callB.id);
  const store = makeStore(state);

  const report = oeffneGelatchteElAnrufe({ store, apply: false });
  assert.equal(report.treffer.length, ZWEI_TREFFER);
  assert.notEqual(callA.costTruedAt, null);
  assert.notEqual(callB.costTruedAt, null);
});

// ---- Gegenprobe: eine vorhandene elevenlabs_convai-Zeile (vorlaeufig|belegt) verhindert den Treffer ----

test("Gegenprobe: eine vorhandene elevenlabs_convai-Zeile (vorlaeufig) verhindert den Treffer", () => {
  const state = makeDefaultState();
  const call = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, costTruedAtIso: JETZT_ISO() });
  seedSipBeleg(state, call.id);
  recordCallCostEvidence(state, {
    callId: call.id, traeger: "elevenlabs_convai", reife: REIFE.VORLAEUFIG,
    betragMikroCents: 10_000_000, waehrung: "USD", quelle: "el_kosten_beleg",
  });
  const store = makeStore(state);

  const { treffer, grund } = istImPhasenschnittGelatcht({ call, belege: store.callCostEvidence(call.id) });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_SKIP.EL_BELEG_VORHANDEN);

  const report = oeffneGelatchteElAnrufe({ store, apply: true });
  assert.equal(report.treffer.length, 0);
  assert.notEqual(call.costTruedAt, null, "bleibt geschlossen");
});

// ---- Weitere Skip-Gruende (rein) --------------------------------------------------------

test("rein: kein el_convai_sip-Profil -> KEIN_EL_PROFIL", () => {
  const state = makeDefaultState();
  const call = seedCall(state, { costProfile: KOSTENPROFIL.TELNYX_BUDGET, costTruedAtIso: JETZT_ISO() });
  const { treffer, grund } = istImPhasenschnittGelatcht({ call, belege: [] });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_SKIP.KEIN_EL_PROFIL);
});

test("rein: costTruedAt bereits null -> NICHT_GELATCHT", () => {
  const state = makeDefaultState();
  const call = seedCall(state, { costProfile: KOSTENPROFIL.EL_CONVAI_SIP });
  const { treffer, grund } = istImPhasenschnittGelatcht({ call, belege: [] });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_SKIP.NICHT_GELATCHT);
});
