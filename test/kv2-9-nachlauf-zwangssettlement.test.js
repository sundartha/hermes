import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NACHLAUF_KV2_9_SKIP,
  istZwangsGesetteltImKv2_8Fenster,
  oeffneZwangsGesettelteElAnrufe,
} from "../src/billing/nachlauf-phasenschnitt.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { faelligkeitsfensterMs } from "../src/billing/kosten-abschluss.js";
import {
  makeDefaultState,
  createCall,
  recordCallCostEvidence,
  callCostEvidence,
  schliesseKostenAbgleich,
  oeffneKostenAbgleichErneut,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, REIFE } from "../src/store/defaults.js";
import { KOSTENART, KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { fakeConfig, fakeVoiceControl, isoMinutesAgo, makeStubStore } from "./cost-truing-harness.js";
import { captureConsole } from "./helpers.js";

const DEADLINE_H = 48;
const MINUTEN_JE_STUNDE = 60;
const NACH_FRIST_MARGE_MIN = 10;
const NACH_FRIST_MINUTEN_HER = DEADLINE_H * MINUTEN_JE_STUNDE + NACH_FRIST_MARGE_MIN;
const SCHAETZUNG_CENTS = 30;
const UNTER_SCHAETZUNG_MIKRO = 5_000_000;
const UEBER_SCHAETZUNG_MIKRO = 40_000_000;
const GLEICH_SCHAETZUNG_MIKRO = 30_000_000;

function testConfig() {
  return fakeConfig({ costSettleDeadlineHours: DEADLINE_H, providerToBucketRateMicro: 1_000_000 });
}

const DEADLINE_MS = () => faelligkeitsfensterMs(testConfig().billing);

function makeStore(state) {
  return {
    load: () => state,
    callCostEvidence: (callId) => callCostEvidence(state, callId),
    oeffneKostenAbgleichErneut: (callId) => oeffneKostenAbgleichErneut(state, callId),
  };
}

function seedZwangsGesettelt(state, { nowMs, elBetragMikroCents, elReife = REIFE.VORLAEUFIG, schaetzung = SCHAETZUNG_CENTS }) {
  const call = createCall(state, {
    direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx",
  });
  call.status = "completed";
  call.endedAt = isoMinutesAgo(nowMs, NACH_FRIST_MINUTEN_HER);
  call.costProfile = KOSTENPROFIL.EL_CONVAI_SIP;
  call.elevenlabsConversationId = "conv_kv2_9_nachlauf_0000000001";
  call.estimatedCostCents = schaetzung;
  if (elBetragMikroCents !== null) {
    recordCallCostEvidence(state, {
      callId: call.id,
      traeger: KOSTENART.ELEVENLABS_CONVAI,
      reife: elReife,
      betragMikroCents: elReife === REIFE.ERWARTET ? undefined : elBetragMikroCents,
      waehrung: elReife === REIFE.ERWARTET ? undefined : "USD",
      quelle: "el_kosten_beleg",
    });
  }
  schliesseKostenAbgleich(state, call.id, {
    closedAt: isoMinutesAgo(nowMs, 0),
    source: "kostenbuch_teilbeleg",
    actualCostMicroCents: elBetragMikroCents ?? 0,
  });
  return call;
}

test("(g) Treffer: el_convai_sip, zwangs-gesettelt, EINE vorlaeufige EL-Zeile, Belegsumme < Schaetzung -> wird wieder geoeffnet", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: UNTER_SCHAETZUNG_MIKRO });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({ call, belege: store.callCostEvidence(call.id), ...args });
  assert.equal(treffer, true);
  assert.equal(grund, undefined);

  const dryRun = oeffneZwangsGesettelteElAnrufe({ store, apply: false, ...args });
  assert.equal(dryRun.treffer.length, 1);
  assert.equal(dryRun.treffer[0].id, call.id);
  assert.notEqual(call.costTruedAt, null, "Dry-Run mutiert nichts");

  const applyRun = oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(applyRun.treffer.length, 1);
  assert.equal(call.costTruedAt, null, "nach dem Nachlauf ist der Anruf wieder offen");
});

test("(g) zweiter Lauf auf demselben Datensatz ist ein No-Op (bereits geoeffnet -> NICHT_GESCHLOSSEN)", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: UNTER_SCHAETZUNG_MIKRO });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(call.costTruedAt, null);

  const zweiterLauf = oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(zweiterLauf.treffer.length, 0);
  assert.equal(
    zweiterLauf.skipped.find((eintrag) => eintrag.id === call.id)?.reason,
    NACHLAUF_KV2_9_SKIP.NICHT_GESCHLOSSEN,
  );
});

test("(g) nach dem Oeffnen ist der Anruf im naechsten Sweep wieder Kandidat", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: UNTER_SCHAETZUNG_MIKRO });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };
  oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });

  const sweepStore = makeStubStore(state, { nowMs });
  const { runCostTruingSweep } = makeCostTruing({
    store: sweepStore, config: testConfig(), voiceControl: fakeVoiceControl({}), audit: () => {}, now: () => nowMs,
  });
  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = lines.filter((zeile) => zeile.startsWith("[cost-truing] sweep "));
  assert.match(line, /kandidaten=1\b/, `der wieder geoeffnete Anruf muss Kandidat sein: ${line}`);
});

test("(g) Gegenprobe 1: Endzustand beleg_strukturell_unbeschaffbar (nachreifbar:false) -> NICHT angefasst", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  call.status = "completed";
  call.endedAt = isoMinutesAgo(nowMs, NACH_FRIST_MINUTEN_HER);
  call.costProfile = KOSTENPROFIL.EL_CONVAI_SIP;
  call.elevenlabsConversationId = "conv_kv2_9_gegen1_00000001";
  call.estimatedCostCents = SCHAETZUNG_CENTS;
  recordCallCostEvidence(state, {
    callId: call.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG,
    betragMikroCents: UNTER_SCHAETZUNG_MIKRO, waehrung: "USD", quelle: "el_kosten_beleg", nachreifbar: false,
  });
  recordCallCostEvidence(state, {
    callId: call.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT,
    betragMikroCents: 40_100, waehrung: "USD", quelle: "sweep_kostenbeleg",
  });
  schliesseKostenAbgleich(state, call.id, { closedAt: isoMinutesAgo(nowMs, 0), source: "kostenbuch_teilbeleg", actualCostMicroCents: UNTER_SCHAETZUNG_MIKRO });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({ call, belege: store.callCostEvidence(call.id), ...args });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_KV2_9_SKIP.ANDERER_ENDZUSTAND);
  const gesetztCostTruedAt = call.costTruedAt;
  oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(call.costTruedAt, gesetztCostTruedAt, "unveraendert");
});

test("(g) Gegenprobe 2: EL-Zeile bereits belegt -> NICHT angefasst", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: UNTER_SCHAETZUNG_MIKRO, elReife: REIFE.BELEGT });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({ call, belege: store.callCostEvidence(call.id), ...args });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_KV2_9_SKIP.KEINE_VORLAEUFIGE_EL_ZEILE, "die EL-Zeile ist 'belegt', nicht 'vorlaeufig' - Bedingung 4 verlangt genau eine vorlaeufige Zeile");
  const report = oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(report.treffer.length, 0);
});

test("(g) Gegenprobe 3: gar keine elevenlabs_convai-Zeile (die Altzeile) -> NICHT angefasst, UND ist ein Treffer des KV2-7-Nachlaufs (disjunkte Mengen)", async () => {
  const { istImPhasenschnittGelatcht } = await import("../src/billing/nachlauf-phasenschnitt.js");
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: null });
  recordCallCostEvidence(state, {
    callId: call.id, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.BELEGT,
    betragMikroCents: 40_100, waehrung: "USD", quelle: "sweep_kostenbeleg",
  });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  const kv29 = istZwangsGesetteltImKv2_8Fenster({ call, belege: store.callCostEvidence(call.id), ...args });
  assert.equal(kv29.treffer, false);
  assert.equal(kv29.grund, NACHLAUF_KV2_9_SKIP.KEINE_VORLAEUFIGE_EL_ZEILE);

  const kv27 = istImPhasenschnittGelatcht({ call, belege: store.callCostEvidence(call.id) });
  assert.equal(kv27.treffer, true, "derselbe Datensatz ist ein Treffer des KV2-7-Nachlaufs - die Mengen sind disjunkt");

  const report = oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(report.treffer.length, 0);
});

test("(g) Gegenprobe 4: Belegsumme UEBER der Schaetzung -> NICHT angefasst (Riegel gegen doppelte Buchung)", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: UEBER_SCHAETZUNG_MIKRO });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({ call, belege: store.callCostEvidence(call.id), ...args });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_KV2_9_SKIP.BELEGSUMME_NICHT_UNTER_SCHAETZUNG);
  const report = oeffneZwangsGesettelteElAnrufe({ store, apply: true, ...args });
  assert.equal(report.treffer.length, 0);
});

test("Grenzfall: Belegsumme EXAKT gleich der Schaetzung (Delta 0) -> NICHT angefasst (< nicht <=)", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedZwangsGesettelt(state, { nowMs, elBetragMikroCents: GLEICH_SCHAETZUNG_MIKRO });
  const store = makeStore(state);
  const args = { nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000 };

  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({ call, belege: store.callCostEvidence(call.id), ...args });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_KV2_9_SKIP.BELEGSUMME_NICHT_UNTER_SCHAETZUNG);
});

test("rein: kein el_convai_sip-Profil -> KEIN_EL_PROFIL", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  call.costProfile = KOSTENPROFIL.TELNYX_BUDGET;
  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({
    call, belege: [], nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000,
  });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_KV2_9_SKIP.KEIN_EL_PROFIL);
});

test("rein: costTruedAt noch null (nie geschlossen) -> NICHT_GESCHLOSSEN", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  call.costProfile = KOSTENPROFIL.EL_CONVAI_SIP;
  const { treffer, grund } = istZwangsGesetteltImKv2_8Fenster({
    call, belege: [], nowMs, deadlineMs: DEADLINE_MS(), providerToBucketRateMicro: 1_000_000,
  });
  assert.equal(treffer, false);
  assert.equal(grund, NACHLAUF_KV2_9_SKIP.NICHT_GESCHLOSSEN);
});
