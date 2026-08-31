// KV2-8 (tasks/kostenv2/spec-kv2-8.md): das Settlement - der Geld-Umschalter. Gebucht
// wird ab dieser Phase aus der BELEGSUMME des Kosten-Buchs (alle Traeger) statt aus EINER
// Telnyx-Messung. In-process, netzfrei (Muster test/kv2-7-schliessregel.test.js: ECHTER
// state-ops-Shape ueber test/cost-truing-harness.js).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests) - diese Tests gehoeren in den Regressionslauf.
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

// ---- Konstanten (G25) -------------------------------------------------------------------

const MINUTEN_JE_STUNDE = 60;
const DEADLINE_H = 48;
const UEBER_DEADLINE_MARGE_MIN = 10;
// Faellig fuer den Sweep (> COST_TRUING_DELAY_MINUTES), aber INNERHALB der Frist.
const IN_FRIST_MINUTEN_HER = 200;
// Deutlich hinter der Faelligkeitsfrist.
const NACH_FRIST_MINUTEN_HER = DEADLINE_H * MINUTEN_JE_STUNDE + UEBER_DEADLINE_MARGE_MIN;
// Im HERZSCHLAG-Fenster des Kosten-Buchs: [now - kostenHeartbeatFensterH, now - karenz],
// karenz = costTruingDelayMinutes + costTruingSweepIntervalMs (kosten-deckung.js). Mit den
// Prod-Fallbacks der Harness sind das 6 h bzw. 4 h - 5 h liegt sicher dazwischen.
const HERZSCHLAG_TREFFER_STUNDEN = 5;
const IM_HERZSCHLAG_FENSTER_MINUTEN_HER = HERZSCHLAG_TREFFER_STUNDEN * MINUTEN_JE_STUNDE;

// Neutrale Rate: 1.000.000 Mikro-Cent = 1 Bucket-Cent (CORRECTION_DIVISOR = 1e12).
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
// Matrix 4.6, "Profil unbekannt (Anruf NACH der Kette entstanden)": ein GESETZTER, aber
// nicht registrierter Wert - z.B. ein spaeter entferntes/umbenanntes Profil. KEINE
// Altzeile (die hat gar kein costProfile, s. Zeile 6/7) und deshalb NICHT ueber die
// Legacy-Zuordnung aufloesbar (kostenprofilFuerAnruf, KV2-8-Verschaerfung).
const UNBEKANNTES_PROFIL = "kv2_profil_entfernt_oder_zukuenftig";

// ---- Fixture-Bausteine -------------------------------------------------------------------

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

// Ein beendeter, fuer den Sweep faelliger Anruf. costProfile bleibt UNGESETZT, wenn kein
// Profil mitgegeben wird - genau die Altzeilen-Lage der Matrixzeilen 6/7/8.
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

// Eine Belegzeile ueber den ECHTEN Store-Schreibweg (kein vereinfachtes Mock).
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

// Belegabruf-Attrappe: ein vollstaendiger Pool, der genau diese Records zuordnet.
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

// Belegabruf-Attrappe, die NICHTS liefert (Provider nicht abrufbar).
const POOL_AUS = {
  async fetchCostRecordPool() {
    return { ok: false };
  },
  assignCostRecords(pool) {
    return pool;
  },
};

// Records eines vollstaendigen Telnyx-Pools: der Betrag haengt am ERSTEN Typ, der zweite
// traegt 0 (er muss nur ANWESEND sein, damit die Pflicht-Typmenge erfuellt ist).
function vollerPool({ mikroCents, billedSec = BILLED_SEC }) {
  return PFLICHT_RECORD_TYPES.map((recordType, index) => ({
    recordType,
    costMicroCents: index === 0 ? mikroCents : 0,
    currency: "USD",
    billedSec,
    legId: "cc_1",
  }));
}

// EIN Sweep mit Spion auf der Geld-Kante. Der Spion delegiert an die ECHTE
// state-ops-Funktion (kein zweites Buchungsverhalten) und zaehlt die Aufrufe -
// "ungerufen" ist in mehreren Abnahmen die eigentliche Zusage.
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

// ---- (a) Die Matrix aus Plan 4.6: zehn Lagen, je zwei Richtungen -------------------------

// Plan 4.6, alle zehn Lagen. Wer eine Matrixzeile ergaenzt, zieht diese Zahl mit -
// dieselbe Regel und derselbe Grund wie die Katalog-Zeilenmenge in KV2-2(d). Die zehnte
// Zeile (Altzeile mit GESETZTEM sipCallId) ist der Riegel gegen die ungewollte Erstattung
// an den 12 EL-Altanrufen; ein Test, der auf 9 stehen bleibt, laesst genau sie ungeprueft.
const MATRIX_ZEILEN_ERWARTET = 10;

// Jede Zeile: aufbau() legt Anruf UND (falls noetig) Vorbelege an und liefert den Anruf +
// die Belegabruf-Attrappe; hoch/niedrig nennen das ERWARTETE Ergebnis je Richtung.
//   gebucht          - lief applyCostCorrectionCents und hat es gebucht?
//   deltaCents       - der erwartete Delta (null = Kante gar nicht gerufen)
//   costCentsNachher - die Gate-Achse NACH dem Sweep
//   herkunft         - der persistierte costTruedSource (null = unveraendert)
//   endzustand       - der gemeldete Endzustand (null = nicht geschlossen)
const MATRIX = [
  {
    nr: 1,
    name: "alle Pflicht-Traeger belegt",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents })),
    }),
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, endzustand: ENDZUSTAND.VOLLSTAENDIG },
    // DIE Erstattung: vollstaendiges Buch -> dataComplete -> der negative Delta wird gebucht.
    niedrig: { gebucht: true, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_NIEDRIG, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, endzustand: ENDZUSTAND.VOLLSTAENDIG },
  },
  {
    nr: 2,
    name: "ein Traeger fehlt, Frist laeuft noch",
    aufbau: ({ state, nowMs }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: POOL_AUS,
    }),
    // Kein Beleg, keine Frist -> der Anruf bleibt offen und bewegt keinen Cent.
    hoch: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.UNAVAILABLE, endzustand: null },
    niedrig: { gebucht: false, deltaCents: null, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.UNAVAILABLE, endzustand: null },
  },
  {
    nr: 3,
    name: "ein Traeger nur vorlaeufig, Frist abgelaufen, in diesem Lauf NICHT messbar",
    // Ohne Leg-Referenz ist der Anruf nicht abrufbar - er laeuft ueber den
    // Faelligkeitslauf (schliesseFaelligeOffene), nicht ueber die Messung.
    aufbau: ({ state, nowMs, mikroCents }) => {
      const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
      seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.VORLAEUFIG, mikroCents });
      return { call, control: POOL_AUS };
    },
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
    // Teilbeleg ist systematisch ZU NIEDRIG -> kein dataComplete -> die Erstattung wird
    // VOR jeder Mutation verworfen.
    niedrig: { gebucht: false, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
  },
  {
    nr: 4,
    name: "Traeger nur vorlaeufig (billed_sec 0), Frist laeuft noch",
    aufbau: ({ state, nowMs, mikroCents }) => ({
      call: beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } }),
      control: poolMit(vollerPool({ mikroCents, billedSec: KEINE_SEKUNDEN })),
    }),
    // Der Sweep-Traeger ist fertig -> der Anruf schliesst ueber die Belegsammlung, die
    // Zeile bleibt aber vorlaeufig (billed_sec 0 beweist nichts) -> kein dataComplete.
    hoch: { gebucht: true, deltaCents: ERWARTETES_DELTA_HOCH, costCentsNachher: VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
    niedrig: { gebucht: false, deltaCents: ERWARTETES_DELTA_NIEDRIG, costCentsNachher: VORHER_COST_CENTS, herkunft: COST_TRUING_SOURCE.INCOMPLETE, endzustand: ENDZUSTAND.UNVOLLSTAENDIG_FINAL },
  },
  {
    nr: 5,
    name: "Pflicht-Traeger strukturell unbeschaffbar, ein anderer Traeger traegt einen Betrag",
    aufbau: ({ state, nowMs, mikroCents }) => {
      const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
      seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, mikroCents: 0, nachreifbar: false });
      // "nachbuchen mit dem, was da ist": ein NICHT-pflichtiger Traeger traegt den Betrag.
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
    // Wie heute: die Legacy-Zuordnung liefert telnyx_budget, das Buch ist vollstaendig -
    // die Erstattung ist eingeschlossen. Der Endzustand meldet trotzdem das fehlende
    // Profil (KV2-7-Regel: "kein costProfile" ist NIE Vollstaendigkeit).
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
    // DER EL-Riegel: null Cent, applyCostCorrectionCents bleibt UNGERUFEN (Owner-
    // Entscheidung 7, KV2-5(h)). Geschlossen wird der Anruf nicht - die elevenlabs_convai-
    // Zeile fehlt und die Frist laeuft noch. Die Herkunft ist 'incomplete' und NIEMALS
    // 'telnyx_detail_records': der Telnyx-Pool ist zwar vollstaendig, der ANRUF aber nicht.
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
    // Kein Riegel wie bei sipCallId GESETZT (Zeile 7) - hier gibt es keine Legacy-
    // Zuordnung, die greifen koennte: die Pflichtmenge ist strukturell leer
    // (pflichtTraegerFuerProfil eines unbekannten Profils), sweepTraegerFuerProfil
    // liefert null, also schreibt der Sweep gar keine Belegzeile - "gar nichts" in
    // BEIDE Richtungen (4.6), trotz eines vollstaendigen Telnyx-Pools.
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
    // Matrix 4.6: eine 0 bei abgerechneten Sekunden waere eine erfundene Messung -> KEINE
    // Belegzeile -> Summe null -> die Geld-Kante bleibt UNGERUFEN, in BEIDE Richtungen.
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
    // Gueltige 0-Zeile -> Summe 0 (NICHT null) -> die Kante LAEUFT, der Delta ist die
    // volle Schaetzung ins Minus und wird mangels dataComplete verworfen.
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

// ---- (b) Vakuositaet: die LEERE Pflichtmenge ist NIEMALS Vollstaendigkeit ----------------

test("(b) istVollBelegt ist ueber der leeren Pflichtmenge FALSCH - in beiden Auspraegungen", () => {
  // Unbekanntes Profil: keine Pflichtmenge, kein Freispruch.
  assert.equal(istVollBelegt({ profil: "gibt_es_nicht", pflichtTraeger: [], fehlend: [] }), false);
  // Bekanntes Profil, aber (hypothetisch) leere Pflichtmenge: der Allquantor waere WAHR -
  // genau das darf ein Praedikat, das ueber Geldrueckgabe entscheidet, nie werden.
  assert.equal(istVollBelegt({ profil: KOSTENPROFIL.TELNYX_BUDGET, pflichtTraeger: [], fehlend: [] }), false);
  // Positiv-Kontrolle: mit nicht-leerer Pflichtmenge und ohne Fehlstelle ist es WAHR -
  // sonst pruefte der Test eine Funktion, die immer false liefert.
  assert.equal(
    istVollBelegt({ profil: KOSTENPROFIL.TELNYX_BUDGET, pflichtTraeger: [KOSTENART.TELNYX_CALL_RECORDS], fehlend: [] }),
    true,
  );
});

test("(b) profilloser Anruf ohne jeden Beleg: kein Cent bewegt sich, und das Buch meldet profil-fehlt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  // Kein Profil, keine Leg-Referenz, kein Beleg - und trotzdem im Herzschlag-Fenster.
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

// ---- (c) Ein Anruf wird genau EINMAL gesettelt -------------------------------------------

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

// ---- (d) Rundung: der Sub-Cent-Rest wandert mit, gerechnet statt abgeschrieben -----------

test("(d) nicht-neutrale Rate: der Rest-Uebertrag entspricht exakt der Umrechnung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const RATE_MICRO = 920_000; // 0,92 EUR je USD - eine neutrale Rate verdeckte den Rest
  const IST_MIT_REST_MIKRO = 4_010_000; // gemessener SIP-Satz, erzeugt einen echten Rest
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

// ---- (e) Kein Herkunftswert faellt unentschieden durch ------------------------------------

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
  // Ein unbekannter Wert (Altzeile, Datenfehler) ist NIE beweisend - fail-closed.
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
  // Ohne Leg-Referenz laeuft der Anruf ueber den Faelligkeitslauf - dort entsteht die
  // Herkunft aus dem BUCH (herkunftOhneMessung), nicht aus einer Messung.
  const call = beendeterCall(state, {
    nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP, endedMinutenHer: NACH_FRIST_MINUTEN_HER,
  });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.VORLAEUFIG, mikroCents: IST_HOCH_MIKRO });
  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, control: POOL_AUS, config: testConfig() });

  assert.notEqual(call.costTruedSource, COST_TRUING_SOURCE.DETAIL_RECORDS);
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG);
  assert.equal(korrekturAufrufe.length, 0, "der EL-Riegel: kein Cent, auch nach Fristablauf");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS);
});

// ---- (g) Vorzeichen und Typ: was die Geld-Kante zu sehen bekommt --------------------------

test("(g) Belegsumme ausserhalb des sicheren Ganzzahlbereichs: die Geld-Kante bleibt ungerufen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, endedMinutenHer: NACH_FRIST_MINUTEN_HER });
  // Zwei Zeilen, deren SUMME den sicheren Ganzzahlbereich verlaesst - jede einzelne ist
  // fuer sich ein gueltiger Anbieter-Mikro-Cent-Betrag.
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
  // 'erwartet' traegt per Regel keinen Betrag und ist nicht summierbar.
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

// ---- (i) Erstattungs-Regression: der Bestandsweg und der neue Weg buchen dasselbe --------

test("(i) vergleichend: neuer Sweep und nachgebauter Bestandspfad buchen bit-gleich", async () => {
  const nowMs = Date.now();
  const IST_MIKRO = 4_010_000;
  // Arm A: der neue Sweep.
  const stateA = makeDefaultState();
  seedUsageCents(stateA, VORHER_COST_CENTS);
  beendeterCall(stateA, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET, legRef: { callControlId: "cc_1" } });
  await sweepMitSpion({ state: stateA, nowMs, control: poolMit(vollerPool({ mikroCents: IST_MIKRO })), config: testConfig() });

  // Arm B: der HEUTIGE Pfad, aus den echten Bausteinen nachgebaut - belegVollstaendig
  // (source vollstaendig UND billedSec > 0) als dataComplete, die Telnyx-Messung als Betrag.
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

// ---------------------------------------------------------------------------------
// KV2-8B: die Luecke, durch die Regression B1 gerutscht ist.
//
// Abnahme (e) verlangt woertlich, JEDEN Wert von COST_TRUING_SOURCE einmal durch die
// Herkunftsregel zu schicken. Geprueft wurde bisher nur istBeweisendeHerkunft ueber den
// Enum plus zwei Einzelfaelle - die Regel SELBST lief nie ueber ihren Eingaberaum. Genau
// deshalb blieb unbemerkt, dass der Riegel im no-estimate-Zweig fehlte.
//
// Zwei Tests, weil es zwei Aussagen sind: der Riegel als Funktion (Tabelle ueber den
// vollen Enum) und seine Verdrahtung im Sweep (der konkrete Regressionspfad).
// ---------------------------------------------------------------------------------

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
  // Positiv-Kontrolle: haette der Enum keinen einzigen beweisenden Wert, waere die
  // Schleife oben allquantifiziert wahr, ohne je den Riegel auszuloesen.
  assert.ok(beweisendeGesehen > 0, "mindestens eine beweisende Herkunft muss im Enum stehen");
});

test("(e) B1-Regression: kein Schaetzbetrag UND unvollstaendiges Buch ergibt NIE eine beweisende Herkunft", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  // Vollstaendiger Telnyx-Pool (measured.source waere 'telnyx_detail_records'), aber
  // billedSec 0 haelt die Belegzeile vorlaeufig -> das Kosten-Buch ist NICHT vollbelegt.
  // Dazu kein Schaetzbetrag: exakt die Kombination, die vor dem Fix am Riegel vorbeilief.
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
