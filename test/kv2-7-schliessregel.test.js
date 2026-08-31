// KV2-7 (tasks/kostenv2/spec-kv2-7.md): Schliessregel, Faelligkeit, Verfall,
// Endzustaende. In-process, netzfrei (Muster test/kv2-6-deckung-herzschlag.test.js).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests) - diese Tests gehoeren in den Regressionslauf.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { kostenBuchBericht } from "../src/billing/kosten-deckung.js";
import { KOSTENPROFIL, pflichtTraegerFuerProfil } from "../src/billing/kostenarten.js";
import {
  ENDZUSTAND,
  ABSCHLUSS_GRUND,
  abschlussFuerAnruf,
  belegUnbeschaffbarAmAnruf,
  offeneTraeger,
  nichtNachreifbar,
  faelligkeitsfensterMs,
  fristAbgelaufen,
  zaehlListe,
  LEERE_LISTE,
} from "../src/billing/kosten-abschluss.js";
import { makeDefaultState, createCall, recordCallCostEvidence } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, REIFE } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, fakeVoiceControl } from "./cost-truing-harness.js";
import { captureConsole } from "./helpers.js";

const MINUTE_MS = 60_000;
const MINUTEN_JE_STUNDE = 60;
const STUNDEN_JE_TAG = 24;
const ZWEI_STUNDEN = 2;
const SIEBEN_TAGE = 7;
const HOUR_MS = MINUTEN_JE_STUNDE * MINUTE_MS;
const ZWEI_STUNDEN_MS = ZWEI_STUNDEN * HOUR_MS;
const SIEBEN_TAGE_MS = SIEBEN_TAGE * STUNDEN_JE_TAG * HOUR_MS;
const DEADLINE_H = 48;
const NACH_FRIST_MS = DEADLINE_H * HOUR_MS + MINUTE_MS; // 48h + 1min drueber
const VOR_FRIST_MS = HOUR_MS; // deutlich unter 48h
// Minuten seit Ende bei bereits abgelaufener Frist, deutlich ueber der Deadline (10 min
// Marge) - EINE Quelle statt in jedem (e)/(h)-Fixture wiederholter Arithmetik (G5/G25).
const UEBER_DEADLINE_MARGE_MIN = 10;
const ABGELAUFEN_MINUTEN_HER = DEADLINE_H * MINUTEN_JE_STUNDE + UEBER_DEADLINE_MARGE_MIN;
const MAX_ATTEMPTS = 5;
const DREI_SWEEPS = 3;
const STANDARD_BELEG_MIKRO_CENTS = 100_000;

function testConfig(overrides = {}) {
  return fakeConfig({ costSettleDeadlineHours: DEADLINE_H, costTruingMaxAttempts: 5, ...overrides });
}

// Ein bereits beendeter Anruf mit gesetztem Profil, IN-MEMORY (Muster kv2-6-Test
// beendeterAnruf), aber ohne Abgleich-Ergebnis - der Sweep soll ihn erst behandeln.
function beendeterCall(state, { nowMs, profil, endedMinutenHer, tenantId = BOOTSTRAP_TENANT_ID, legRef = {} }) {
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId, provider: "telnyx" });
  call.status = "completed";
  call.costProfile = profil;
  call.answeredAt = new Date(nowMs - (endedMinutenHer + 1) * MINUTE_MS).toISOString();
  call.endedAt = new Date(nowMs - endedMinutenHer * MINUTE_MS).toISOString();
  call.estimatedCostCents = 30;
  if (legRef.callControlId) call.callControlId = legRef.callControlId;
  if (legRef.sipCallId) call.sipCallId = legRef.sipCallId;
  return call;
}

function seedBeleg(state, { callId, traeger, reife, nachreifbar }) {
  return recordCallCostEvidence(state, {
    callId,
    traeger,
    reife,
    betragMikroCents: reife === REIFE.ERWARTET ? undefined : STANDARD_BELEG_MIKRO_CENTS,
    waehrung: reife === REIFE.ERWARTET ? undefined : "USD",
    quelle: "sweep_kostenbeleg",
    nachreifbar,
  }).evidence;
}

// ---- (a) Regressionsschutz: telnyx_budget verhaelt sich byte-identisch zum Bestand ----

test("(a) telnyx_budget, vollstaendiger Pool: ein Sweep schliesst, ein zweiter sieht 0 Kandidaten", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: 200, legRef: { callControlId: "cc_a" },
  });
  const store = makeStubStore(state);
  const control = {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords(pool, { legId }) {
      return pool.ok
        ? { ok: true, records: [{ recordType: "call-control", costMicroCents: 500_000, currency: "USD", billedSec: 60, legId }] }
        : pool;
    },
  };
  const config = testConfig({ costTruingRequiredRecordTypes: ["call-control"] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.candidates, 1);
  assert.equal(call.costTruingAttempts, 1, "genau EIN Versuch");
  assert.equal(call.costTruedAt, new Date(nowMs).toISOString());
  assert.equal(call.costTruedSource, "telnyx_detail_records");

  const result2 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result2.candidates, 0, "geschlossener Anruf ist kein Kandidat mehr");
});

// ---- (b) el_convai_sip, Telnyx-SIP-Beleg zuerst: bleibt Kandidat ----

test("(b) el_convai_sip mit Telnyx-SIP-Beleg zuerst bleibt Kandidat, wird nicht geschlossen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: 200, legRef: { sipCallId: "otb_b" },
  });
  const store = makeStubStore(state);
  const control = {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords(pool, { legId }) {
      return pool.ok
        ? { ok: true, records: [{ recordType: "sip-trunking", costMicroCents: 40_100, currency: "USD", billedSec: 60, legId }] }
        : pool;
    },
  };
  const config = testConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.candidates, 1);
  assert.equal(call.costTruedAt, null, "der Telnyx-SIP-Beleg allein schliesst el_convai_sip nicht");

  const belege = store.callCostEvidence(call.id);
  assert.equal(belege.find((zeile) => zeile.traeger === "telnyx_sip")?.reife, REIFE.BELEGT);

  const result2 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result2.candidates, 1, "bleibt Kandidat im naechsten Sweep");
  return call;
});

// ---- (c) nach Fristablauf: geschlossen, unvollstaendig_final, fehlend benannt ----

test("(c) nach Ablauf der Frist: geschlossen, unvollstaendig_final, fehlend=elevenlabs_convai, danach kein Kandidat mehr", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: 200, legRef: { sipCallId: "otb_c" },
  });
  seedBeleg(state, { callId: call.id, traeger: "telnyx_sip", reife: REIFE.BELEGT });
  const store = makeStubStore(state);
  const control = {
    async fetchCostRecordPool() {
      return { ok: false };
    },
    assignCostRecords(pool) {
      return pool;
    },
  };
  const nowMsSpaeter = nowMs + NACH_FRIST_MS;
  const config = testConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMsSpaeter,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  assert.ok(
    lines.some((zeile) => zeile.includes(`abschluss call=${call.id}`) && zeile.includes(`zustand=${ENDZUSTAND.UNVOLLSTAENDIG_FINAL}`)
      && zeile.includes(`grund=${ABSCHLUSS_GRUND.FRIST}`) && zeile.includes("fehlend=elevenlabs_convai")),
    "abschluss-Log-Zeile mit Endzustand/Grund/fehlend",
  );
  assert.ok(lines.some((zeile) => zeile.includes("abschluesse=unvollstaendig_final(1)")));
  assert.notEqual(call.costTruedAt, null, "der Anruf ist geschlossen");

  const result2 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result2.candidates, 0, "kein Kandidat mehr - er bleibt nicht ewig offen");
});

// ---- (d) Versuche je Traeger: ein erschoepfter Telnyx-Zaehler beendet nicht die EL-Nachreifung ----

test("(d) Versuche je Traeger: nach 5 erfolglosen Telnyx-Versuchen NICHT geschlossen; Versuch 6 ruft den Adapter nicht mehr; EL-Zeile unangetastet", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: 200, legRef: { sipCallId: "otb_d" },
  });
  seedBeleg(state, { callId: call.id, traeger: "elevenlabs_convai", reife: REIFE.VORLAEUFIG });
  const store = makeStubStore(state);
  let fetchCount = 0;
  const control = {
    async fetchCostRecordPool() {
      fetchCount++;
      return { ok: false, reason: "provider_error" };
    },
    assignCostRecords(pool) {
      return pool;
    },
  };
  const config = testConfig({ costTruingMaxAttempts: MAX_ATTEMPTS });
  const sweepOnFreshInstance = () =>
    makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
    }).runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  for (let versuch = 1; versuch <= MAX_ATTEMPTS; versuch++) {
    await sweepOnFreshInstance();
    assert.equal(call.costTruingAttempts, versuch);
    assert.equal(call.costTruedAt, null, `nach Versuch ${versuch}: bleibt offen`);
  }
  assert.equal(fetchCount, MAX_ATTEMPTS);

  const result6 = await sweepOnFreshInstance();
  assert.equal(result6.candidates, 1, "der Anruf bleibt Kandidat");
  assert.equal(fetchCount, MAX_ATTEMPTS, "Versuch 6 loest KEINEN Abruf mehr aus (erschoepft)");
  assert.equal(call.costTruingAttempts, MAX_ATTEMPTS, "kein sechster Versuch verbraucht");

  const elZeile = store.callCostEvidence(call.id).find((zeile) => zeile.traeger === "elevenlabs_convai");
  assert.equal(elZeile.versuche, 0, "die EL-Zeile bleibt unangetastet");
  assert.equal(elZeile.reife, REIFE.VORLAEUFIG);
});

// ---- (e) Abbruchweg: beleg_strukturell_unbeschaffbar, kein Deckungs-Alarm ----

test("(e) Abbruchweg (nachreifbar=false) nach Fristablauf: beleg_strukturell_unbeschaffbar, kein Deckungs-Alarm", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: ABGELAUFEN_MINUTEN_HER, legRef: { sipCallId: "otb_e" },
  });
  call.elevenlabsConversationId = "conv_e";
  seedBeleg(state, { callId: call.id, traeger: "telnyx_sip", reife: REIFE.BELEGT });
  seedBeleg(state, { callId: call.id, traeger: "elevenlabs_convai", reife: REIFE.VORLAEUFIG });
  // Abbruchweg: zweite Fortschreibung derselben Reife setzt nachreifbar=false (Muster
  // KV2-4 "nachreifbar ist eine Einbahnstrasse").
  recordCallCostEvidence(state, {
    callId: call.id, traeger: "elevenlabs_convai", reife: REIFE.VORLAEUFIG, nachreifbar: false,
  });

  const belege = state.callCostEvidence.filter((zeile) => zeile.callId === call.id);
  const deadlineMs = faelligkeitsfensterMs(config_());
  const abschluss = abschlussFuerAnruf({ call, belege, nowMs, deadlineMs, sweepTraegerErledigt: false });
  assert.equal(abschluss.geschlossen, true);
  assert.equal(abschluss.endzustand, ENDZUSTAND.UNBESCHAFFBAR);

  const buch = kostenBuchBericht({
    state, billing: config_(), nowMs, deckungFensterMs: SIEBEN_TAGE_MS,
  });
  const eintrag = buch.deckung.find((zeile) => zeile.traeger === "elevenlabs_convai");
  assert.ok(eintrag);
  assert.equal(eintrag.unbeschaffbar, 1);
  assert.ok(
    !buch.befunde.some((befund) => befund.code === "deckung-unter-schwelle:elevenlabs_convai"),
    "kein Deckungs-Alarm fuer den Abbruchweg",
  );
});

// lokale Config-Bruecke fuer die reinen (nicht-Sweep-)Tests dieser Datei.
function config_() {
  return testConfig().billing;
}

// ---- (f) usage.costCents unveraendert, keine Doppelbuchung ----

test("(f) usage.costCents bleibt unveraendert; bei drei Sweeps eines offenen el_convai_sip-Anrufs hoechstens EIN Buchungsaufruf", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: 200, legRef: { sipCallId: "otb_f" },
  });
  const store = makeStubStore(state);
  let bookings = 0;
  const originalApply = store.applyCostCorrectionCents.bind(store);
  store.applyCostCorrectionCents = (...args) => {
    bookings++;
    return originalApply(...args);
  };
  const control = {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords(pool, { legId }) {
      return pool.ok
        ? { ok: true, records: [{ recordType: "sip-trunking", costMicroCents: 40_100, currency: "USD", billedSec: 60, legId }] }
        : pool;
    },
  };
  const config = testConfig();
  const usageVorher = structuredClone(state.usage);

  for (let sweep = 1; sweep <= DREI_SWEEPS; sweep++) {
    const { runCostTruingSweep } = makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
    });
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  }

  assert.deepStrictEqual(state.usage, usageVorher, "usage.costCents unveraendert");
  assert.equal(bookings, 0, "die EL-Route bucht in dieser Kette NIE (sweepDarfKorrigieren)");
  assert.equal(call.costTruedAt, null, "der Anruf bleibt offen (kein zweiter Traeger belegt)");
});

// ---- (h) 6.10-Fall: beleg_strukturell_unbeschaffbar am Anruf, Gegenproben ----

test("(h) alle fuenf Bedingungen + abgelaufene Frist -> beleg_strukturell_unbeschaffbar, kein Deckungs-Alarm, nicht im Herzschlag", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: ABGELAUFEN_MINUTEN_HER,
  });
  call.elevenlabsConversationId = "conv_h";
  call.sipCallId = null;
  const billing = config_();
  const deadlineMs = faelligkeitsfensterMs(billing);

  assert.equal(belegUnbeschaffbarAmAnruf({ call, belege: [] }), true);
  const abschluss = abschlussFuerAnruf({ call, belege: [], nowMs, deadlineMs, sweepTraegerErledigt: false });
  assert.equal(abschluss.geschlossen, true);
  assert.equal(abschluss.endzustand, ENDZUSTAND.UNBESCHAFFBAR);

  const buch = kostenBuchBericht({ state, billing, nowMs, deckungFensterMs: SIEBEN_TAGE_MS });
  assert.ok(!buch.befunde.some((befund) => befund.code.startsWith("deckung-unter-schwelle:elevenlabs_convai")));
  const herzschlagEintrag = buch.herzschlag.find((zeile) => zeile.traeger === "elevenlabs_convai");
  assert.equal(herzschlagEintrag, undefined, "der 6.10-Fall haelt sich aus dem Herzschlag heraus");

  // (i) Gegenprobe: ein nie angenommener Anruf hat NIE ein ElevenLabs-Gespraech
  // begonnen (elevenlabsConversationId bleibt null) - Bedingung 3 schlaegt fehl, das
  // Praedikat greift nicht. Er ist kein unbeschaffbarer Beleg, sondern ein Anruf ohne
  // Kosten (Matrix 4.6: gueltiger 0-Beleg).
  const nieAngenommen = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: ABGELAUFEN_MINUTEN_HER });
  nieAngenommen.estimatedCostCents = null;
  nieAngenommen.answeredAt = null;
  assert.equal(belegUnbeschaffbarAmAnruf({ call: nieAngenommen, belege: [] }), false);

  // (ii) Gegenprobe: derselbe Fixture MIT gesetztem sipCallId bleibt regulaerer Kandidat.
  const mitSipCallId = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: ABGELAUFEN_MINUTEN_HER, legRef: { sipCallId: "otb_h_ii" },
  });
  mitSipCallId.elevenlabsConversationId = "conv_h_ii";
  assert.equal(belegUnbeschaffbarAmAnruf({ call: mitSipCallId, belege: [] }), false);

  // (iii) Gegenprobe: waehrend laufender Frist greift die Regel nicht (frist=false).
  const nochOffen = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: 10 });
  nochOffen.elevenlabsConversationId = "conv_h_iii";
  nochOffen.sipCallId = null;
  const abschlussOffen = abschlussFuerAnruf({ call: nochOffen, belege: [], nowMs, deadlineMs, sweepTraegerErledigt: false });
  assert.equal(abschlussOffen.geschlossen, false, "waehrend laufender Frist bleibt der Anruf offen");
});

// ---- rein: abschlussFuerAnruf/belegUnbeschaffbarAmAnruf/offeneTraeger ueber alle Profile ----

test("rein: offeneTraeger liefert je Profil genau die noch nicht belegten Pflicht-Traeger", () => {
  const state = makeDefaultState();
  for (const profil of Object.values(KOSTENPROFIL)) {
    const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
    call.costProfile = profil;
    call.endedAt = new Date().toISOString();
    const pflicht = pflichtTraegerFuerProfil(profil);
    assert.deepEqual(offeneTraeger({ call, belege: [] }), [...pflicht].sort(), `Profil ${profil}: alles offen ohne Belege`);
    for (const traeger of pflicht) seedBeleg(state, { callId: call.id, traeger, reife: REIFE.BELEGT });
    assert.deepEqual(offeneTraeger({ call, belege: state.callCostEvidence.filter((zeile) => zeile.callId === call.id) }), []);
  }
});

test("rein: nichtNachreifbar erkennt nur nachreifbar=false UND nicht-belegt; ein fehlender Traeger ist NICHT nichtNachreifbar", () => {
  assert.equal(nichtNachreifbar(undefined), false);
  assert.equal(nichtNachreifbar({ nachreifbar: false, reife: REIFE.VORLAEUFIG }), true);
  assert.equal(nichtNachreifbar({ nachreifbar: false, reife: REIFE.BELEGT }), false, "belegt ist fertig, egal was nachreifbar sagt");
  assert.equal(nichtNachreifbar({ nachreifbar: true, reife: REIFE.VORLAEUFIG }), false);
});

test("rein: fristAbgelaufen ist fail-closed bei fehlendem/unbrauchbarem endedAt", () => {
  assert.equal(fristAbgelaufen({ call: {}, nowMs: Date.now(), deadlineMs: HOUR_MS }), false);
  assert.equal(fristAbgelaufen({ call: { endedAt: "nicht-ein-datum" }, nowMs: Date.now(), deadlineMs: HOUR_MS }), false);
  const nowMs = Date.now();
  assert.equal(
    fristAbgelaufen({ call: { endedAt: new Date(nowMs - VOR_FRIST_MS).toISOString() }, nowMs, deadlineMs: ZWEI_STUNDEN_MS }),
    false,
  );
  assert.equal(
    fristAbgelaufen({ call: { endedAt: new Date(nowMs - NACH_FRIST_MS).toISOString() }, nowMs, deadlineMs: DEADLINE_H * HOUR_MS }),
    true,
  );
});

test("rein: zaehlListe verdichtet, sortiert alphabetisch, LEERE_LISTE bei leerer Eingabe", () => {
  assert.equal(zaehlListe([]), LEERE_LISTE);
  assert.equal(zaehlListe(["b", "a", "b"]), "a(1),b(2)");
});

test("rein: PROFIL_FEHLT, wenn call.costProfile nicht gesetzt ist - unabhaengig von der Legacy-Zuordnung", () => {
  const nowMs = Date.now();
  const call = { costProfile: null, direction: "outbound", endedAt: new Date(nowMs - VOR_FRIST_MS).toISOString(), sipCallId: null };
  const abschluss = abschlussFuerAnruf({
    call, belege: [{ traeger: "telnyx_call_records", reife: REIFE.BELEGT }],
    nowMs, deadlineMs: DEADLINE_H * HOUR_MS, sweepTraegerErledigt: true,
  });
  assert.equal(abschluss.geschlossen, true);
  assert.equal(abschluss.endzustand, ENDZUSTAND.PROFIL_FEHLT);
});
