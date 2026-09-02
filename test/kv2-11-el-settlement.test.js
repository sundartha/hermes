// KV2-11 (tasks/kostenv2/spec-kv2-11.md): EL-Settlement freigegeben (Owner-Entscheidung
// OR-1, 2026-09-02). Die Profilsperre in sweepDarfKorrigieren ist entfallen - der
// B6-Schutz lebt strukturell in istVollBelegt + der dataComplete-Asymmetrie der
// applyCostCorrectionCents-Kante. Diese Datei pinnt die fuenf Gruppen des Auftrags:
// buchen (a), erstatten (b), B6-fail-closed (2), bedingungsloses Nachbuchen (3),
// beweisende Herkunft/Deckung (4) und die Legacy-Altzeile (5).
// In-process, netzfrei (Muster test/kv2-8-settlement.test.js).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests) - diese Tests gehoeren in den Regressionslauf.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeCostTruing, SWEEP_TRIGGER, costTruingCoveragePercent } from "../src/billing/cost-truing.js";
import { KOSTENART, KOSTENPROFIL } from "../src/billing/kostenarten.js";
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
// Deutlich hinter der Faelligkeitsfrist: ohne Leg-Referenz laeuft der Fixture-Anruf
// ueber den Faelligkeitslauf (schliesseFaelligeOffene), nicht ueber die Messung.
const NACH_FRIST_MINUTEN_HER = DEADLINE_H * MINUTEN_JE_STUNDE + UEBER_DEADLINE_MARGE_MIN;
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
const VOLL_DECKUNG_PROZENT = 100;
// Belegabruf-Attrappe, die NICHTS liefert (Provider nicht abrufbar).
const POOL_AUS = {
  async fetchCostRecordPool() {
    return { ok: false };
  },
  assignCostRecords(pool) {
    return pool;
  },
};

// ---- Fixture-Bausteine (Muster kv2-8-settlement.test.js) ---------------------------------

function testConfig() {
  return fakeConfig({
    costSettleDeadlineHours: DEADLINE_H,
    providerToBucketRateMicro: NEUTRALE_RATE_MICRO,
  });
}

function seedUsageCents(state, costCents) {
  Object.assign(state.usage, { [BOOTSTRAP_TENANT_ID]: { ...emptyUsage(), costCents } });
}

// Ein beendeter, fuer den Sweep faelliger Anruf. costProfile bleibt UNGESETZT, wenn kein
// Profil mitgegeben wird - genau die Altzeilen-Lage der Gruppe (5).
function beendeterCall(state, { nowMs, profil = null, endedMinutenHer = NACH_FRIST_MINUTEN_HER, legRef = {} }) {
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutenHer + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutenHer);
  if (profil !== null) call.costProfile = profil;
  if (legRef.callControlId) call.callControlId = legRef.callControlId;
  if (legRef.sipCallId) call.sipCallId = legRef.sipCallId;
  call.estimatedCostCents = SCHAETZUNG_CENTS;
  return call;
}

// Eine Belegzeile ueber den ECHTEN Store-Schreibweg (kein vereinfachtes Mock).
function seedBeleg(state, { callId, traeger, mikroCents }) {
  return recordCallCostEvidence(state, {
    callId,
    traeger,
    reife: REIFE.BELEGT,
    betragMikroCents: mikroCents,
    waehrung: "USD",
    quelle: "sweep_kostenbeleg",
  }).evidence;
}

// Das VOLLSTAENDIGE EL-Buch: beide Pflicht-Traeger belegt. Der Betrag haengt am EINEN
// Traeger, der andere traegt 0 (Muster vollerPool in kv2-8: er muss nur ANWESEND sein,
// damit die Pflichtmenge erfuellt ist) - so bleibt die SUMME die gepinnte Groesse.
function seedVollstaendigesElBuch(state, { callId, mikroCents }) {
  seedBeleg(state, { callId, traeger: KOSTENART.ELEVENLABS_CONVAI, mikroCents });
  return seedBeleg(state, { callId, traeger: KOSTENART.TELNYX_SIP, mikroCents: 0 });
}

// EIN Sweep mit Spion auf der Geld-Kante (Muster kv2-8): der Spion delegiert an die
// ECHTE state-ops-Funktion und sammelt die Eingaben - so sind Delta und dataComplete
// GERECHNET gepinnt, nicht nur auf Existenz geprueft.
async function sweepMitSpion({ state, nowMs, config }) {
  const store = makeStubStore(state, { nowMs });
  const echteKorrektur = store.applyCostCorrectionCents.bind(store);
  const korrekturAufrufe = [];
  store.applyCostCorrectionCents = (tenantId, eingabe) => {
    korrekturAufrufe.push(eingabe);
    return echteKorrektur(tenantId, eingabe);
  };
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: POOL_AUS }), audit: () => {}, now: () => nowMs,
  });
  await captureConsole(async () => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  return { korrekturAufrufe };
}

// Der aus der Spy-Eingabe GERECHNETE Delta (kein abgeschriebener Soll-Wert).
function gerechneterDeltaCents(eingabe) {
  const { bucketCents } = convertProviderMicroToBucketCents({
    remMicro: 0,
    actualCostMicroCents: eingabe.actualCostMicroCents,
    providerToBucketRateMicro: NEUTRALE_RATE_MICRO,
  });
  return bucketCents - eingabe.estimatedCostCents;
}

// ---- (1a) EL voll belegt, Ist > Schaetzung: Settlement bucht --------------------------------

test("(1a) EL voll belegt, Ist > Schaetzung: Settlement bucht +20, Herkunft kostenbuch_vollbeleg", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP });
  seedVollstaendigesElBuch(state, { callId: call.id, mikroCents: IST_HOCH_MIKRO });

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, config: testConfig() });

  assert.equal(korrekturAufrufe.length, 1, "genau EIN Aufruf der Geld-Kante");
  const [eingabe] = korrekturAufrufe;
  assert.equal(eingabe.dataComplete, true, "beide Pflicht-Traeger belegt -> vollstaendiges Buch");
  assert.equal(eingabe.actualCostMicroCents, IST_HOCH_MIKRO, "der Betrag IST die Belegsumme");
  assert.equal(gerechneterDeltaCents(eingabe), ERWARTETES_DELTA_HOCH, "Delta (gerechnet, nicht abgeschrieben)");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, "Gate-Achse");
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG, "Herkunft");
  assert.notEqual(call.costTruedAt, null, "der Anruf ist geschlossen");
});

// ---- (1b) EL voll belegt, Ist < Schaetzung: ERSTATTUNG -------------------------------------

test("(1b) EL voll belegt, Ist < Schaetzung: ERSTATTUNG wird gebucht", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP });
  seedVollstaendigesElBuch(state, { callId: call.id, mikroCents: IST_NIEDRIG_MIKRO });

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, config: testConfig() });

  // DER Kern der Freigabe (OR-1): zum ersten Mal seit Bestehen erstattet die EL-Route.
  // Voraussetzung ist der bewiesene Soll-Ist-Vergleich ueber BEIDE Pflicht-Traeger.
  assert.equal(korrekturAufrufe.length, 1, "genau EIN Aufruf der Geld-Kante");
  const [eingabe] = korrekturAufrufe;
  assert.equal(eingabe.dataComplete, true, "vollstaendiges Buch traegt die Erstattung");
  assert.equal(gerechneterDeltaCents(eingabe), ERWARTETES_DELTA_NIEDRIG, "Delta (gerechnet, nicht abgeschrieben)");
  assert.ok(usageFor(state, BOOTSTRAP_TENANT_ID).costCents < VORHER_COST_CENTS, "Vorbedingung: dieser Fall IST eine Erstattung");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS + ERWARTETES_DELTA_NIEDRIG, "Gate-Achse");
});

// ---- (2) B6-Regression: unvollstaendiges Buch erstattet NIE --------------------------------

test("(2) B6-Regression: EL-Zeile fehlt, nur sip belegt, Ist < Schaetzung -> KEINE Erstattung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_SIP, mikroCents: IST_NIEDRIG_MIKRO });

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, config: testConfig() });

  // Der B6-Schutz OHNE Profilsperre: die Kante LAEUFT (Nachbuchung waere erlaubt), aber
  // der negative Delta wird mangels dataComplete VOR jeder Mutation verworfen.
  assert.equal(korrekturAufrufe.length, 1, "die Geld-Kante lief - gesperrt ist nur die Erstattung");
  assert.equal(korrekturAufrufe[0].dataComplete, false, "fehlende EL-Zeile -> unvollstaendiges Buch");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "fail-closed bleibt: kein Cent zurueck");
});

// ---- (3) EL-Zeile fehlt, Ist > Schaetzung: bedingungslos nachbuchen -------------------------

test("(3) EL-Zeile fehlt, Ist > Schaetzung -> bedingungslos nachbuchen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_SIP, mikroCents: IST_HOCH_MIKRO });

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, config: testConfig() });

  assert.equal(korrekturAufrufe.length, 1, "genau EIN Aufruf der Geld-Kante");
  assert.equal(gerechneterDeltaCents(korrekturAufrufe[0]), ERWARTETES_DELTA_HOCH, "Delta (gerechnet, nicht abgeschrieben)");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS + ERWARTETES_DELTA_HOCH, "Nachbuchung bedingungslos");
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG, "final, aber nicht beweisend");
});

// ---- (4) beweisende Herkunft zaehlt in die Deckungsquote -----------------------------------

test("(4) Herkunft kostenbuch_vollbeleg ist beweisend und zaehlt in die Deckungsquote", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  const call = beendeterCall(state, { nowMs, profil: KOSTENPROFIL.EL_CONVAI_SIP });
  seedVollstaendigesElBuch(state, { callId: call.id, mikroCents: IST_HOCH_MIKRO });
  await sweepMitSpion({ state, nowMs, config: testConfig() });

  assert.equal(istBeweisendeHerkunft(call.costTruedSource), true, "vollstaendiges EL-Buch ist beweisend");
  assert.equal(costTruingCoveragePercent(state, nowMs), VOLL_DECKUNG_PROZENT, "ein belegbarer, bewiesener Anruf");
});

// ---- (5) Legacy-EL-Altzeile ohne EL-Zeile wird nie erstattet --------------------------------

test("(5) Legacy-EL-Altzeile ohne EL-Zeile wird nie erstattet", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, VORHER_COST_CENTS);
  // Altzeile: kein costProfile, aber sipCallId gesetzt -> Legacy-Zuordnung auf
  // el_convai_sip (kostenarten.js#legacyKostenprofil) - das Pflicht-SOLL umfasst
  // weiterhin BEIDE Traeger.
  const call = beendeterCall(state, { nowMs, legRef: { sipCallId: "otb_4101m190brwyf4mb9cwvhts7rymk" } });
  seedBeleg(state, { callId: call.id, traeger: KOSTENART.TELNYX_SIP, mikroCents: IST_NIEDRIG_MIKRO });

  const { korrekturAufrufe } = await sweepMitSpion({ state, nowMs, config: testConfig() });

  assert.equal(korrekturAufrufe.length, 1, "die Geld-Kante lief");
  assert.equal(korrekturAufrufe[0].dataComplete, false, "fehlende EL-Zeile -> unvollstaendiges Buch");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, VORHER_COST_CENTS, "die 12 EL-Altanrufe erhalten keine Erstattung");
});
