import { test } from "node:test";
import assert from "node:assert/strict";

import { makeCostTruing, SWEEP_TRIGGER, ohneBeweiskraft } from "../src/billing/cost-truing.js";
import { istVollBelegt, settlementProjektion } from "../src/billing/kosten-projektion.js";
import { KOSTENART, KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { KOSTEN_BEFUND } from "../src/billing/kosten-deckung.js";
import { ENDZUSTAND } from "../src/billing/kosten-abschluss.js";
import { measuredCentsPerMinByPrefix } from "../src/billing/cost-calibration.js";
import {
  makeDefaultState,
  createCall,
  usageFor,
  recordCallCostEvidence,
  convertProviderMicroToBucketCents,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, COST_TRUING_SOURCE, REIFE, emptyUsage, istBeweisendeHerkunft } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, fakeVoiceControl, isoMinutesAgo } from "./cost-truing-harness.js";
import { captureConsole } from "./helpers.js";

const MINUTEN_JE_STUNDE = 60;
const DEADLINE_H = 48;
const UEBER_DEADLINE_MARGE_MIN = 10;
const IN_FRIST_MINUTEN_HER = 200;
const NACH_FRIST_MINUTEN_HER = DEADLINE_H * MINUTEN_JE_STUNDE + UEBER_DEADLINE_MARGE_MIN;
const HERZSCHLAG_TREFFER_STUNDEN = 5;
const IM_HERZSCHLAG_FENSTER_MINUTEN_HER = HERZSCHLAG_TREFFER_STUNDEN * MINUTEN_JE_STUNDE;

const NEUTRALE_RATE_MICRO = 1_000_000;
const MIKRO_JE_CENT = 1_000_000;
const SCHAETZUNG_CENTS = 30;
const IST_HOCH_CENTS = 50;
const IST_NIEDRIG_CENTS = 10;
const IST_HOCH_MIKRO = IST_HOCH_CENTS * MIKRO_JE_CENT;
const IST_NIEDRIG_MIKRO = IST_NIEDRIG_CENTS * MIKRO_JE_CENT;
const ERWARTETES_DELTA_HOCH = IST_HOCH_CENTS - SCHAETZUNG_CENTS;
const ERWARTETES_DELTA_NIEDRIG = IST_NIEDRIG_CENTS - SCHAETZUNG_CENTS;
const VORHER_COST_CENTS = 100;
const PFLICHT_RECORD_TYPES = ["sip-trunking", "call-control"];
const BILLED_SEC = 60;
const KEINE_SEKUNDEN = 0;
const UNBEKANNTES_PROFIL = "kv2_profil_entfernt_oder_zukuenftig";

function testConfig(overrides = {}) {
  return fakeConfig({
    costSettleDeadlineHours: DEADLINE_H,
    costTruingRequiredRecordTypes: PFLICHT_RECORD_TYPES,
    providerToBucketRateMicro: NEUTRALE_RATE_MICRO,
    ...overrides,
  });
}

function seedUsageCents(state, costCents) {
  Object.assign(state.usage, { [BOOTSTRAP_TENANT_ID]: { ...emptyUsage(), costCents } });
}

function beendeterCall(state, { nowMs, profil = null, endedMinutenHer = IN_FRIST_MINUTEN_HER, legRef = {}, direction = "outbound", schaetzung = SCHAETZUNG_CENTS }) {
  const call = createCall(state, { direction, from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutenHer + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutenHer);
  if (profil !== null) call.costProfile = profil;
  if (legRef.callControlId) call.callControlId = legRef.callControlId;
  if (legRef.sipCallId) call.sipCallId = legRef.sipCallId;
  if (schaetzung !== null) call.estimatedCostCents = schaetzung;
  return call;
}

function seedBeleg(state, { callId, traeger, reife, mikroCents, nachreifbar }) {
  return recordCallCostEvidence(state, {
    callId,
    traeger,
    reife,
    betragMikroCents: reife === REIFE.ERWARTET ? undefined : mikroCents,
    waehrung: reife === REIFE.ERWARTET ? undefined : "USD",
    quelle: "sweep_kostenbeleg",
    nachreifbar,
  }).evidence;
}

function poolMit(records) {
  return {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords() {
      return { ok: true, records };
    },
  };
}

const POOL_AUS = {
  async fetchCostRecordPool() {
    return { ok: false };
  },
  assignCostRecords(pool) {
    return pool;
  },
};

function vollerPool({ mikroCents, billedSec = BILLED_SEC }) {
  return PFLICHT_RECORD_TYPES.map((recordType, index) => ({
    recordType,
    costMicroCents: index === 0 ? mikroCents : 0,
    currency: "USD",
    billedSec,
    legId: "cc_1",
  }));
}

async function sweepMitSpion({ state, nowMs, control, config }) {
  const store = makeStubStore(state, { nowMs });
  const echteKorrektur = store.applyCostCorrectionCents.bind(store);
  const korrekturAufrufe = [];
  store.applyCostCorrectionCents = (tenantId, eingabe) => {
    korrekturAufrufe.push(eingabe);
    return echteKorrektur(tenantId, eingabe);
  };
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  const ergebnis = await captureConsole(async () => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  return { store, korrekturAufrufe, logs: ergebnis };
}

const MATRIX_ZEILEN_ERWARTET = 10;

const MATRIX = [
  {
    nr: 1,
    name: "alle Pflicht-Traeger belegt",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents })),
    }),
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, endzustand: ENDZUSTAND.VOLLSTAENDIG },
    niedrig: { gebucht: true, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_NIEDRIG, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, endzustand: ENDZUSTAND.VOLLSTAENDIG },
  },
  {
    nr: 2,
    name: "ein Traeger fehlt, Frist laeuft noch",
    aufbau: ({ state, nowMs }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: POOL_AUS,
    }),
    hoch: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.UNAVAILABLE, endzustand: null },
    niedrig: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.UNAVAILABLE, endzustand: null },
  },
  {
    nr: 3,
    name: "ein Traeger nur vorlaeufig, Frist abgelaufen, in diesem Lauf NICHT messbar",
    aufbau: ({ state, nowMs, mikroCents }) => {
      const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
      seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.VORLAEUFIG, mikroCents });
      return { call, control: POOL_AUS };
    },
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
    niedrig: { gebucht: false, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
  },
  {
    nr: 4,
    name: "Traeger nur vorlaeufig (billed_sec 0), Frist laeuft noch",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents, billedSec: KEINE_SEKUNDEN })),
    }),
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
    niedrig: { gebucht: false, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
  },
  {
    nr: 5,
    name: "Pflicht-Traeger strukturell unbeschaffbar, ein anderer Traeger traegt einen Betrag",
    aufbau: ({ state, nowMs, mikroCents }) => {
      const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
      seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, mikroCents: 0, nachreifbar: false });
      seedBeleg(state, { callId: call.id, traeger: KOSTENART.AI_TOKEN, reife: REIFE.VORLAEUFIG, mikroCents });
      return { call, control: POOL_AUS };
    },
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, endzustand: ENDZUSTAND.UNBESCHAFFBAR },
    niedrig: { gebucht: false, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, endzustand: ENDZUSTAND.UNBESCHAFFBAR },
  },
  {
    nr: 6,
    name: "Altzeile OHNE costProfile, sipCallId LEER (Legacy telnyx_budget)",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents })),
    }),
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, endzustand: ENDZUSTAND.PROFIL_FEHLT },
    niedrig: { gebucht: true, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_NIEDRIG, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, endzustand: ENDZUSTAND.PROFIL_FEHLT },
  },
  {
    nr: 7,
    name: "Altzeile OHNE costProfile, sipCallId GESETZT (Legacy el_convai_sip)",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, legRef: { sipCallId: "otb_4101m190brwyf4mb9cwvhts7rymk" } }),
      control: poolMit([{ recordType: "sip-trunking", costMicroCents: mikroCents, currency: "USD", billedSec: BILLED_SEC, legId: "otb_4101m190brwyf4mb9cwvhts7rymk" }]),
    }),
    hoch: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: null },
    niedrig: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: null },
  },
  {
    nr: 8,
    name: "Profil unbekannt (Anruf NACH der Kette entstanden)",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, profil: UNBEKANNTES_PROFIL, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents })),
    }),
    hoch: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.PROFIL_FEHLT },
    niedrig: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.PROFIL_FEHLT },
  },
  {
    nr: 9,
    name: "Betrag 0 bei Menge > 0 (kein Beleg, Summe null)",
    aufbau: ({ state, nowMs }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents: 0 })),
    }),
    hoch: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
    niedrig: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
  },
  {
    nr: 10,
    name: "Betrag 0 bei Menge 0 (gueltige 0-Zeile, Delta = -Schaetzung)",
    aufbau: ({ state, nowMs }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents: 0, billedSec: KEINE_SEKUNDEN })),
    }),
    hoch: { gebucht: false, deltaCents: -SCHAETZUNG_CENTS, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
    niedrig: { gebucht: false, deltaCents: -SCHAETZUNG_CENTS, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
  },
];

test("(a) die Matrix aus Plan 4.6 ist vollstaendig gefuehrt", () => {
  assert.equal(MATRIX.length, MATRIX_ZEILEN_ERWARTET);
});

for (const zeile of MATRIX) {
  for (const [richtung, mikroCents] of [["Ist > Schaetzung", IST_HOCH_MIKRO], ["Ist < Schaetzung", IST_NIEDRIG_MIKRO]]) {
    const erwartet = richtung === "Ist > Schaetzung" ? zeile.hoch : zeile.niedrig;
    test(`(a) Matrix ${zeile.nr}: ${zeile.name} | ${richtung}`, async () => {
      const nowMs = Date.now();
      const state = makeDefaultState();
      seedUsageCents(state, VORHER_COST_CENTS);
      const { call, control } = zeile.aufbau({ state, nowMs, mikroCents });
      const { korrekturAufrufe, logs } = await sweepMitSpion({ state, nowMs, control, config: testConfig() });

      const gebucht = korrekturAufrufe.length > 0 && usageFor(state, BOOTSTRAP_TENANT_ID).costCents !== VORHER_COST_CENTS;
      assert.equal(gebucht, erwartet.gebucht, "gebucht");
      assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, erwartet.costCentsNachher, "Gate-Achse");
      assert.equal(call.costTruedSource, erwartet.herkunft, "Herkunft");
      if (erwartet.deltaCents === null) {
        assert.equal(korrekturAufrufe.length, 0, "die Geld-Kante darf gar nicht gerufen werden");
      } else {
        assert.equal(korrekturAufrufe.length, 1, "genau EIN Aufruf der Geld-Kante");
        const [eingabe] = korrekturAufrufe;
        const { bucketCents } = convertProviderMicroToBucketCents({
          remMicro: 0,
          actualCostMicroCents: eingabe.actualCostMicroCents,
          providerToBucketRateMicro: NEUTRALE_RATE_MICRO,
        });
        assert.equal(bucketCents - eingabe.estimatedCostCents, erwartet.deltaCents, "Delta (gerechnet, nicht abgeschrieben)");
      }
      const abschlussZeile = logs.find((eintrag) => eintrag.startsWith(`[cost-truing] abschluss call=${call.id} `));
      if (erwartet.endzustand === null) {
        assert.equal(abschlussZeile, undefined, `der Anruf darf nicht geschlossen werden: ${abschlussZeile}`);
        assert.equal(call.costTruedAt, null, "costTruedAt bleibt offen");
      } else {
        assert.ok(abschlussZeile?.includes(`zustand=${erwartet.endzustand}`), `Endzustand: ${abschlussZeile}`);
        assert.notEqual(call.costTruedAt, null, "ein geschlossener Anruf traegt costTruedAt");
      }
    });
  }
}

test("(b) istVollBelegt ist ueber der leeren Pflichtmenge FALSCH - in beiden Auspraegungen", () => {
  assert.equal(istVollBelegt({ profil: "gibt_es_nicht", pflichtTraeger: [], fehlend: [] }), false);
  assert.equal(istVollBelegt({ profil: KOSTENPROFIL.TELNYX_BUDGET, pflichtTraeger: [], fehlend: [] }), false);
  assert.equal(
    istVollBelegt({ profil: KOSTENPROFIL.TELNYX_BUDGET, pflichtTraeger: [KOSTENART.TELNYX_CALL_RECORDS], fehlend: [] }),
    true,
  );
});

test("(b) profilloser Anruf ohne jeden Beleg: kein Cent bewegt sich, und das Buch meldet profil-fehlt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, endedMinutenHer: IM_HERZSCHLAG_FENSTER_MINUTEN_HER });
  const { korrekturAufrufe, logs } = await sweepMitSpion({ state, nowMs, control: POOL_AUS, config: testConfig() });

  assert.equal(korrekturAufrufe.length, 0, "ohne Belegsumme wird die Geld-Kante nie gerufen");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "die Gate-Achse bleibt bit-gleich");
  assert.equal(settlementProjektion({ call, belege: [] }).vollBelegt, false);
  assert.ok(
    logs.some((eintrag) => eintrag.includes(`grund=${KOSTEN_BEFUND.PROFIL_FEHLT}`)),
    `das Kosten-Buch muss profil-fehlt melden: ${logs.join("\n")}`,
  );
});

test("(c) zwei Sweeps hintereinander: das Settlement laeuft genau einmal", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  const store = makeStubStore(state, { nowMs });
  const echteKorrektur = store.applyCostCorrectionCents.bind(store);
  let korrekturAufrufe = 0;
  store.applyCostCorrectionCents = (tenantId, eingabe) => {
    korrekturAufrufe++;
    return echteKorrektur(tenantId, eingabe);
  };
  const { runCostTruingSweep } = makeCostTruing({
    store,
    config: testConfig(),
    voiceControl: fakeVoiceControl({ telnyx: poolMit(vollerPool({ mikroCents: IST_HOCH_MIKRO })) }),
    audit: () => {},
    now: () => nowMs,
  });

  await captureConsole(async () => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const nachErstem = usageFor(state, BOOTSTRAP_TENANT_ID).costCents;
  const truedAtNachErstem = call.costTruedAt;
  await captureConsole(async () => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));

  assert.equal(korrekturAufrufe, 1, "genau EIN Settlement");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, nachErstem, "die Gate-Achse ist bit-gleich zum Stand nach dem ersten Sweep");
  assert.equal(call.costTruedAt, truedAtNachErstem, "costTruedAt ist set-once");
});

test("(d) nicht-neutrale Rate: der Rest-Uebertrag entspricht exakt der Umrechnung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const RATE_MICRO = 920_000;
  const IST_MIT_REST_MIKRO = 4_010_000;
  beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  const config = testConfig({ providerToBucketRateMicro: RATE_MICRO });
  await sweepMitSpion({ state, nowMs, control: poolMit(vollerPool({ mikroCents: IST_MIT_REST_MIKRO })), config });

  const erwartet = convertProviderMicroToBucketCents({
    remMicro: 0,
    actualCostMicroCents: IST_MIT_REST_MIKRO,
    providerToBucketRateMicro: RATE_MICRO,
  });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCorrectionMicroCentsRem, erwartet.remMicro);
  assert.notEqual(erwartet.remMicro, 0, "Vorbedingung: die Fixtur muss ueberhaupt einen Rest erzeugen");
  assert.equal(
    usageFor(state, BOOTSTRAP_TENANT_ID).costCents,
    VORHER_COST_CENTS + (erwartet.bucketCents - SCHAETZUNG_CENTS),
    "die Gate-Achse traegt genau den gerechneten Delta",
  );
});

const HERKUNFT_BEWEISEND = Object.freeze({
  [COST_TRUING_SOURCE.DETAIL_RECORDS]: true,
  [COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG]: true,
  [COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG]: false,
  [COST_TRUING_SOURCE.INCOMPLETE]: false,
  [COST_TRUING_SOURCE.NO_ESTIMATE]: false,
  [COST_TRUING_SOURCE.UNAVAILABLE]: false,
});

test("(e) jeder Enum-Wert ist ausdruecklich als beweisend oder nicht-beweisend eingeordnet", () => {
  const werte = Object.values(COST_TRUING_SOURCE);
  assert.equal(werte.length, Object.keys(HERKUNFT_BEWEISEND).length, "wer einen Wert ergaenzt, ordnet ihn hier ein");
  for (const wert of werte) {
    assert.equal(istBeweisendeHerkunft(wert), HERKUNFT_BEWEISEND[wert], `Herkunft ${wert}`);
  }
  assert.equal(istBeweisendeHerkunft(null), false);
  assert.equal(istBeweisendeHerkunft("erfundener_wert"), false);
});

test("(e) die Drift-Stichprobe nimmt nur beweisende Herkunft - kostenbuch_teilbeleg bleibt draussen", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const belegt = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET });
  belegt.costTruedSource = COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG;
  belegt.actualCostMicroCents = IST_HOCH_MIKRO;
  belegt.billedSeconds = MINUTEN_JE_STUNDE;
  const teilbeleg = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET });
  teilbeleg.costTruedSource = COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG;
  teilbeleg.actualCostMicroCents = IST_NIEDRIG_MIKRO;
  teilbeleg.billedSeconds = MINUTEN_JE_STUNDE;

  const nurVollbeleg = measuredCentsPerMinByPrefix(state.calls, "+49");
  assert.equal(nurVollbeleg.samples, 1, "genau der kostenbuch_vollbeleg-Anruf ist Stichprobe");
});

test("(e) ein el_convai_sip-Settlement schreibt NIE 'telnyx_detail_records'", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: NACH_FRIST_MINUTEN_HER,
  });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG, mikroCents: IST_HOCH_MIKRO });
  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, control: POOL_AUS, config: testConfig() });

  assert.notEqual(call.costTruedSource, COST_TRUING_SOURCE.DETAIL_RECORDS);
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG);
  assert.equal(korrekturAufrufe.length, 1, "nach Fristablauf settelt die EL-Route (OR-1)");
  assert.equal(korrekturAufrufe[0].dataComplete, false, "das Buch ist unvollstaendig");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH);
});

test("(g) Belegsumme ausserhalb des sicheren Ganzzahlbereichs: die Geld-Kante bleibt ungerufen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
  const HAELFTE = 2;
  const HALB_MAX = Math.floor(Number.MAX_SAFE_INTEGER / HAELFTE) + 1;
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.VORLAEUFIG, mikroCents: HALB_MAX });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.AI_TOKEN, reife: REIFE.VORLAEUFIG, mikroCents: HALB_MAX });
  assert.equal(settlementProjektion({ call, belege: state.callCostEvidence }).summeMikroCents, null, "Vorbedingung: die Summe ist unbrauchbar");

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, control: POOL_AUS, config: testConfig() });
  assert.equal(korrekturAufrufe.length, 0);
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS);
});

test("(g) kein summierbarer Beleg: Summe ist null (nicht 0) und die Geld-Kante bleibt ungerufen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.ERWARTET });
  assert.equal(settlementProjektion({ call, belege: state.callCostEvidence }).summeMikroCents, null);

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, control: POOL_AUS, config: testConfig() });
  assert.equal(korrekturAufrufe.length, 0);
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS);
});

test("(g) Gegenprobe: gueltige Summe -> genau EIN Aufruf mit einem Betrag >= 0", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  const { korrekturAufrufe } = await sweepMitSpion({
    state, nowMs, control: poolMit(vollerPool({ mikroCents: IST_HOCH_MIKRO })), config: testConfig(),
  });

  assert.equal(korrekturAufrufe.length, 1);
  assert.equal(korrekturAufrufe[0].actualCostMicroCents, IST_HOCH_MIKRO, "der Betrag IST die Belegsumme");
  assert.ok(korrekturAufrufe[0].actualCostMicroCents >= 0);
  assert.equal(korrekturAufrufe[0].dataComplete, true);
});

test("(i) vergleichend: neuer Sweep und nachgebauter Bestandspfad buchen bit-gleich", async () => {
  const nowMs = Date.now();
  const IST_MIKRO = 4_010_000;
  const stateA = makeDefaultState();
  seedUsageCents(stateA, VORHER_COST_CENTS);
  beendeterCall(stateA, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  await sweepMitSpion({ state: stateA, nowMs, control: poolMit(vollerPool({ mikroCents: IST_MIKRO })), config: testConfig() });

  const stateB = makeDefaultState();
  seedUsageCents(stateB, VORHER_COST_CENTS);
  const callB = beendeterCall(stateB, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  const { applyCostCorrectionCents } = await import("../src/store/state-ops.js");
  const { belegVollstaendig } = await import("../src/billing/sweep-kostenbeleg.js");
  const measured = { source: COST_TRUING_SOURCE.DETAIL_RECORDS, billedSecTotal: BILLED_SEC, actualCostMicroCents: IST_MIKRO };
  applyCostCorrectionCents(
    stateB,
    BOOTSTRAP_TENANT_ID,
    {
      actualCostMicroCents: measured.actualCostMicroCents,
      estimatedCostCents: callB.estimatedCostCents,
      providerToBucketRateMicro: NEUTRALE_RATE_MICRO,
      dataComplete: belegVollstaendig(measured),
    },
    new Date(nowMs).toISOString(),
  );

  const usageA = usageFor(stateA, BOOTSTRAP_TENANT_ID);
  const usageB = usageFor(stateB, BOOTSTRAP_TENANT_ID);
  assert.equal(usageA.costCents, usageB.costCents, "dieselbe Gate-Achse");
  assert.equal(usageA.costCorrectionMicroCentsRem, usageB.costCorrectionMicroCentsRem, "derselbe Rest-Uebertrag");
  assert.ok(usageA.costCents < VORHER_COST_CENTS, "Vorbedingung: dieser Fall IST eine Erstattung");
});

test("(i) Gegenprobe 1: Pool nur mit call-control (Pflichtmenge unerfuellt) -> keine Erstattung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  const records = [{ recordType: "call-control", costMicroCents: IST_NIEDRIG_MIKRO, currency: "USD", billedSec: BILLED_SEC, legId: "cc_1" }];
  await sweepMitSpion({ state, nowMs, control: poolMit(records), config: testConfig() });

  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "unvollstaendige Pflichtmenge erstattet nicht");
});

test("(i) Gegenprobe 2: billed_sec 0 -> keine Erstattung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  await sweepMitSpion({
    state, nowMs, config: testConfig(),
    control: poolMit(vollerPool({ mikroCents: IST_NIEDRIG_MIKRO, billedSec: KEINE_SEKUNDEN })),
  });

  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "ohne abgerechnete Sekunden wird nichts erstattet");
});

test("(i) Gegenprobe 3: kein buchbarer Schaetzbetrag -> null Cent und Herkunft no_estimate", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" }, schaetzung: null,
  });
  const { korrekturAufrufe } = await sweepMitSpion({
    state, nowMs, control: poolMit(vollerPool({ mikroCents: IST_NIEDRIG_MIKRO })), config: testConfig(),
  });

  assert.equal(korrekturAufrufe.length, 0, "ohne Schaetzbetrag gibt es nichts zu korrigieren");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS);
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.NO_ESTIMATE);
});

test("(e) ohneBeweiskraft: JEDER Enum-Wert - beweisende Herkunft wird zu incomplete, jede andere bleibt", () => {
  const werte = Object.values(COST_TRUING_SOURCE);
  assert.ok(werte.length > 0, "Enum ist nicht leer (sonst waere die Tabelle vakuos wahr)");

  let beweisendeGesehen = 0;
  for (const source of werte) {
    const ergebnis = ohneBeweiskraft(source);
    assert.equal(
      istBeweisendeHerkunft(ergebnis), false,
      `ohneBeweiskraft('${source}') ergab '${ergebnis}' - das ist weiterhin beweisend`,
    );
    if (istBeweisendeHerkunft(source)) {
      beweisendeGesehen++;
      assert.equal(ergebnis, COST_TRUING_SOURCE.INCOMPLETE, `'${source}' muss auf incomplete fallen`);
    } else {
      assert.equal(ergebnis, source, `'${source}' ist nicht beweisend und muss unveraendert bleiben`);
    }
  }
  assert.ok(beweisendeGesehen > 0, "mindestens eine beweisende Herkunft muss im Enum stehen");
});

test("(e) B1-Regression: kein Schaetzbetrag UND unvollstaendiges Buch ergibt NIE eine beweisende Herkunft", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" }, schaetzung: null,
  });
  const { korrekturAufrufe } = await sweepMitSpion({
    state, nowMs, config: testConfig(),
    control: poolMit(vollerPool({ mikroCents: IST_NIEDRIG_MIKRO, billedSec: KEINE_SEKUNDEN })),
  });

  assert.equal(
    istBeweisendeHerkunft(call.costTruedSource), false,
    `Herkunft '${call.costTruedSource}' ist beweisend, obwohl das Buch unvollstaendig ist - ` +
    "der Drift-Waechter naehme den Anruf als Stichprobe mit einem Teilbetrag (Regression B1)",
  );
  assert.equal(korrekturAufrufe.length, 0, "ohne Schaetzbetrag wird nichts korrigiert");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS);
});
