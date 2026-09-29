// KV-M4 (tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): monatliche Gegenprobe Provider-Rechnung
// gegen abgerufene Ist-Kosten gegen gebuchte Gate-Betraege. REINE BEOBACHTUNG - keiner
// dieser Tests behauptet etwas ueber die Gate-Achse oder den Ledger selbst (die werden nur
// gelesen). In-process, netzfrei (P12/R): der Telnyx-Provider wird ausschliesslich ueber
// fakeVoiceControl gestellt, kein echter fetch.
//
// Muster kv-m3-coverage-denominator.test.js + cost-truing-harness.js (G5: kein zweiter
// Stub-Store, keine zweite fakeConfig/fakeVoiceControl-Kopie).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  createCall,
  recordUsageEvent,
  recordCallCostEvidence,
  crossCheckDueMonthKey,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, REIFE, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { KOSTENART } from "../src/billing/kostenarten.js";
import { makeCostCrossCheck } from "../src/billing/cost-cross-check.js";
import { runSweepTick } from "../src/boot.js";
import { makeStubStore, fakeConfig, fakeVoiceControl } from "./cost-truing-harness.js";
import { captureConsole } from "./helpers.js";

// Feste Uhr: der faellige Monat ist IMMER der zuletzt VOLLSTAENDIG abgeschlossene
// UTC-Kalendermonat relativ zu NOW_ISO - 2026-08-15 -> faellig ist 2026-07.
// Ein Provider-Wert, den die Registry NICHT kennt. Bewusst 'twilio' statt eines
// Phantasienamens: genau dieser String kann als ALTZEILE in einer Bestands-DB stehen
// (`provider TEXT` ohne CHECK-Constraint) - der Filter muss ihn dort aussortieren.
const NON_TELNYX_PROVIDER = "twilio";

const NOW_ISO = "2026-08-15T12:00:00.000Z";
const DUE_MONTH_KEY = "2026-07";
const OTHER_MONTH_KEY = "2026-06";

// Ein bereits abgeglichener Telnyx-Call mit bekanntem actual_cost_micro_cents, verankert
// auf monthKey (estimatedCostSpendMonthKey - DERSELBE Anker wie reconcileVoiceBudget/
// bookCents, KS-P5). provider/costTruedAt ueberschreibbar, um die drei Filter von
// actualCostMicroCentsForMonth einzeln als Rauschen zu pruefen (Provider, Monat, Abgleich-
// Status).
function makeTruedCall(state, { monthKey, actualCostMicroCents, provider = PROVIDER.TELNYX, costTruedAt = "2026-07-20T00:00:00.000Z" }) {
  const call = createCall(state, {
    direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider,
  });
  call.estimatedCostSpendMonthKey = monthKey;
  call.costTruedAt = costTruedAt;
  call.actualCostMicroCents = actualCostMicroCents;
  return call;
}

// KV2-8 (f): drei unterscheidbare Betraege - jede Zahl steht fuer genau einen Sachverhalt,
// damit eine Verwechslung im Test sichtbar wird statt sich wegzukuerzen.
const TELNYX_BUCH_MICRO_CENTS = 40_100;
const EL_BUCH_MICRO_CENTS = 560_000;
const RAUSCHEN_MICRO_CENTS = 999_999;

// Eine Belegzeile im Kosten-Buch (echter state-ops-Schreibweg, kein vereinfachtes Mock).
function seedBuchzeile(state, { callId, traeger, mikroCents }) {
  return recordCallCostEvidence(state, {
    callId, traeger, reife: REIFE.BELEGT, betragMikroCents: mikroCents, waehrung: "USD", quelle: "sweep_kostenbeleg",
  }).evidence;
}

function makeLedgerEvent(state, { kind, costCents, occurredAt }) {
  return recordUsageEvent(state, {
    tenantId: BOOTSTRAP_TENANT_ID, kind, quantity: 1, costCents, occurredAt,
  });
}

test("KV-M4-1 Rechnungstest mit gestellten Zahlen: drei Rohwerte und zwei Differenzen exakt, inkl. Waehrungs-Umrechnung mit NICHT-neutraler Rate", async () => {
  const state = makeDefaultState();

  // Zwei belegbare Telnyx-Calls im faelligen Monat -> Summe 1.198.000.000 USD-Mikro-Cent.
  makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 600_000_000 });
  makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 598_000_000 });
  // Rauschen: falscher Monat, falscher Provider, nicht abgeglichen - jedes wuerde die
  // Summe verfaelschen, wenn der jeweilige Filter fehlte.
  makeTruedCall(state, { monthKey: OTHER_MONTH_KEY, actualCostMicroCents: 999_000_000 });
  // C-P4: der Gegenstand dieser Zeile IST "nicht Telnyx" (Provider-Filter). Der Wert steht
  // deshalb als Literal da, nicht als Enum-Verweis - PROVIDER.TWILIO waere nach dem Ausbau
  // still zu `undefined` geworden und haette den Filter gegen etwas anderes geprueft.
  makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 777_000_000, provider: NON_TELNYX_PROVIDER });
  makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 555_000_000, costTruedAt: null });

  // Zwei VOICE_MINUTE-Belege im faelligen Monat -> Summe 920 EUR-Cent (Gate-Ledger-Proxy).
  makeLedgerEvent(state, { kind: USAGE_EVENT_KIND.VOICE_MINUTE, costCents: 400, occurredAt: "2026-07-05T00:00:00.000Z" });
  makeLedgerEvent(state, { kind: USAGE_EVENT_KIND.VOICE_MINUTE, costCents: 520, occurredAt: "2026-07-25T00:00:00.000Z" });
  // Rauschen: falscher Monat (VOICE_MINUTE) UND falsche Kosten-Art (AI_TOKEN, DERSELBE
  // Monat, ANDERER Betrag) - das ist die Mutationsprobe-Zielgroesse (LIEFERE 4): vertauscht
  // die Implementierung carrierGateCostCentsForMonth gegen eine Summe ueber AI_TOKEN, liefert
  // sie 999 statt 920 und dieser exakte Assert wird rot.
  makeLedgerEvent(state, { kind: USAGE_EVENT_KIND.VOICE_MINUTE, costCents: 300, occurredAt: "2026-06-10T00:00:00.000Z" });
  makeLedgerEvent(state, { kind: USAGE_EVENT_KIND.AI_TOKEN, costCents: 999, occurredAt: "2026-07-10T00:00:00.000Z" });

  const store = makeStubStore(state);
  // NICHT-neutrale Rate (0,92 EUR/USD, wie im Kickoff-Beispiel) - eine neutrale Rate
  // (1.000.000) wuerde einen Richtungs-/Rundungsfehler der Umrechnung verdecken.
  const RATE_MICRO = 920_000;
  const config = fakeConfig({ providerToBucketRateMicro: RATE_MICRO });
  const invoiceTotalMicroCents = 1_245_000_000;
  const voiceControl = fakeVoiceControl({
    telnyx: {
      async fetchMonthlyInvoiceTotal({ month }) {
        assert.equal(month, DUE_MONTH_KEY, "die Gegenprobe fragt exakt den faelligen Monat ab");
        return { ok: true, totalMicroCents: invoiceTotalMicroCents, currency: "USD" };
      },
    },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  let result;
  const logs = await captureConsole(async () => {
    result = await runMonthlyCrossCheck(NOW_ISO);
  });

  assert.deepEqual(result, { skipped: false, monthKey: DUE_MONTH_KEY });

  // Von Hand gerechnet (keine Naeherung, kein Aufruf derselben Produktionsfunktion):
  //   konvertiert = ceil(1.198.000.000 * 920.000 / 1e12) = ceil(1102,16) = 1103
  //   diff_ist_minus_gate = 1103 - 920 = 183
  // KV2-8: dieser Monat traegt KEINE Kosten-Buch-Zeile (die Calls sind reine
  // call-Ebene-Fixturen) -> ist_je_traeger=keine und die RECHNUNGS-Differenz ist
  // ausdruecklich nicht verfuegbar statt einer erfundenen 0.
  const expectedLine =
    "[cost-cross-check] monat=2026-07 telnyx_rechnung_usd_micro_cent=1245000000 " +
    "ist_telnyx_usd_micro_cent=null diff_rechnung_minus_ist=nicht_verfuegbar(reason=kein_kostenbuch) " +
    "ist_je_traeger=keine " +
    "ist_gesamt_usd_micro_cent=1198000000 gate_carrier_eur_cent=920 " +
    "ist_konvertiert_eur_cent(rate=920000)=1103 " +
    "diff_ist_minus_gate_eur_cent=183";
  assert.ok(logs.includes(expectedLine), `Log-Zeile weicht ab.\nErwartet: ${expectedLine}\nErhalten: ${logs.join("\n")}`);
});

// ---- KV2-8 (f): Traeger-Trennung - die Rechnungs-Differenz sieht NUR Telnyx-Traeger ----

test("KV2-8 (f) zwei Traeger im Kosten-Buch: die Rechnungs-Differenz enthaelt den EL-Betrag NICHT", async () => {
  const state = makeDefaultState();
  const telnyxCall = makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 0 });
  const elCall = makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 0 });
  // Ein Anruf ausserhalb des faelligen Monats - seine Buchzeile darf NICHT mitzaehlen.
  const fremderMonat = makeTruedCall(state, { monthKey: OTHER_MONTH_KEY, actualCostMicroCents: 0 });
  // Ein noch NICHT abgeglichener Anruf des faelligen Monats - dito.
  const offen = makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 0, costTruedAt: null });

  seedBuchzeile(state, { callId: telnyxCall.id, traeger: KOSTENART.TELNYX_CALL_RECORDS, mikroCents: TELNYX_BUCH_MICRO_CENTS });
  seedBuchzeile(state, { callId: elCall.id, traeger: KOSTENART.ELEVENLABS_CONVAI, mikroCents: EL_BUCH_MICRO_CENTS });
  seedBuchzeile(state, { callId: fremderMonat.id, traeger: KOSTENART.TELNYX_SIP, mikroCents: RAUSCHEN_MICRO_CENTS });
  seedBuchzeile(state, { callId: offen.id, traeger: KOSTENART.TELNYX_SIP, mikroCents: RAUSCHEN_MICRO_CENTS });

  // Die call-Ebene traegt fuer diesen Test 0 - so ist ist_gesamt nachweislich eine ANDERE
  // Groesse als ist_telnyx und der Test kann nicht zufaellig gruen sein.
  const store = makeStubStore(state);
  const config = fakeConfig({ providerToBucketRateMicro: 1_000_000 });
  const invoiceTotalMicroCents = 900_000;
  const voiceControl = fakeVoiceControl({
    telnyx: { async fetchMonthlyInvoiceTotal() { return { ok: true, totalMicroCents: invoiceTotalMicroCents, currency: "USD" }; } },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  const logs = await captureConsole(async () => {
    await runMonthlyCrossCheck(NOW_ISO);
  });

  const zeile = logs.find((eintrag) => eintrag.startsWith("[cost-cross-check] monat="));
  assert.ok(zeile, `keine Gegenprobe-Zeile: ${logs.join("\n")}`);
  // GERECHNET, nicht abgeschrieben: die Rechnungs-Differenz bezieht sich AUSSCHLIESSLICH
  // auf den Telnyx-Traeger - der EL-Betrag steckt NICHT darin.
  const erwarteteDiff = invoiceTotalMicroCents - TELNYX_BUCH_MICRO_CENTS;
  assert.ok(zeile.includes(`ist_telnyx_usd_micro_cent=${TELNYX_BUCH_MICRO_CENTS}`), zeile);
  assert.ok(zeile.includes(`diff_rechnung_minus_ist_usd_micro_cent=${erwarteteDiff}`), zeile);
  assert.ok(
    !zeile.includes(`diff_rechnung_minus_ist_usd_micro_cent=${invoiceTotalMicroCents - (TELNYX_BUCH_MICRO_CENTS + EL_BUCH_MICRO_CENTS)}`),
    `die Mischdifferenz (Telnyx-Rechnung gegen Telnyx+EL) darf NICHT in der Zeile stehen: ${zeile}`,
  );
  // Beide Traeger sind sichtbar, alphabetisch, mit ihrem eigenen Betrag.
  assert.ok(
    zeile.includes(`ist_je_traeger=${KOSTENART.ELEVENLABS_CONVAI}(${EL_BUCH_MICRO_CENTS}),${KOSTENART.TELNYX_CALL_RECORDS}(${TELNYX_BUCH_MICRO_CENTS})`),
    zeile,
  );
  // ist_gesamt kommt weiterhin von der call-Ebene und ist hier nachweislich eine andere Zahl.
  assert.ok(zeile.includes("ist_gesamt_usd_micro_cent=0"), zeile);
  assert.notEqual(TELNYX_BUCH_MICRO_CENTS, 0, "Vorbedingung: ist_telnyx !== ist_gesamt");
});

test("KV2-8 (f) leeres Kosten-Buch: ist_je_traeger=keine und KEINE erfundene Rechnungs-Differenz", async () => {
  const state = makeDefaultState();
  makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 4_010_000 });
  const store = makeStubStore(state);
  const config = fakeConfig();
  const voiceControl = fakeVoiceControl({
    telnyx: { async fetchMonthlyInvoiceTotal() { return { ok: true, totalMicroCents: 5_000_000, currency: "USD" }; } },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  const logs = await captureConsole(async () => {
    await runMonthlyCrossCheck(NOW_ISO);
  });

  const zeile = logs.find((eintrag) => eintrag.startsWith("[cost-cross-check] monat="));
  assert.ok(zeile.includes("ist_je_traeger=keine"), zeile);
  assert.ok(zeile.includes("diff_rechnung_minus_ist=nicht_verfuegbar(reason=kein_kostenbuch)"), zeile);
  assert.ok(!zeile.includes("diff_rechnung_minus_ist_usd_micro_cent="), `keine erfundene Differenz: ${zeile}`);
  assert.ok(zeile.includes("ist_gesamt_usd_micro_cent=4010000"), `ist_gesamt kommt weiterhin von der call-Ebene: ${zeile}`);
});

test("KV-M4-2 Idempotenz: zwei Sweeps im selben Kalendermonat loesen genau EINEN Provider-Aufruf aus", async () => {
  const state = makeDefaultState();
  const store = makeStubStore(state);
  const config = fakeConfig();
  let invoiceCalls = 0;
  const voiceControl = fakeVoiceControl({
    telnyx: {
      async fetchMonthlyInvoiceTotal() {
        invoiceCalls++;
        return { ok: false, reason: "amount_not_exposed_by_provider" };
      },
    },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  const first = await runMonthlyCrossCheck(NOW_ISO);
  const second = await runMonthlyCrossCheck(NOW_ISO);

  assert.deepEqual(first, { skipped: false, monthKey: DUE_MONTH_KEY });
  assert.deepEqual(second, { skipped: true });
  assert.equal(invoiceCalls, 1, "der zweite Sweep im selben Monat loest KEINEN weiteren Provider-Aufruf aus");
});

test("KV-M4-3 Idempotenz ueberlebt einen Neustart (JSON-Serialisierungs-Roundtrip, nicht nur In-Memory)", async () => {
  const stateBeforeRestart = makeDefaultState();
  const storeBeforeRestart = makeStubStore(stateBeforeRestart);
  const config = fakeConfig();
  let invoiceCalls = 0;
  const countingVoiceControl = fakeVoiceControl({
    telnyx: {
      async fetchMonthlyInvoiceTotal() {
        invoiceCalls++;
        return { ok: false, reason: "amount_not_exposed_by_provider" };
      },
    },
  });

  const run1 = makeCostCrossCheck({ store: storeBeforeRestart, config, voiceControl: countingVoiceControl });
  const firstResult = await run1.runMonthlyCrossCheck(NOW_ISO);
  assert.deepEqual(firstResult, { skipped: false, monthKey: DUE_MONTH_KEY });
  assert.equal(invoiceCalls, 1);

  // Simulierter Prozess-Neustart: state.json.stringify/parse-Roundtrip (Muster
  // kv-p6-json-durchstich.test.js) statt eines zweiten Aufrufs auf DEMSELBEN In-Memory-
  // Objekt - genau das ist der Unterschied zu einem reinen In-Memory-Test (KV-M4-2 allein
  // wuerde die Persistenz NICHT belegen).
  const stateAfterRestart = JSON.parse(JSON.stringify(stateBeforeRestart));
  assert.equal(
    stateAfterRestart.costCrossCheck.lastCheckedMonthKey,
    DUE_MONTH_KEY,
    "der Riegel muss den Serialisierungs-Roundtrip tragen",
  );

  const storeAfterRestart = makeStubStore(stateAfterRestart);
  const run2 = makeCostCrossCheck({ store: storeAfterRestart, config, voiceControl: countingVoiceControl });
  const secondResult = await run2.runMonthlyCrossCheck(NOW_ISO);

  assert.deepEqual(secondResult, { skipped: true });
  assert.equal(invoiceCalls, 1, "nach dem simulierten Neustart loest derselbe Monat KEINEN weiteren Provider-Aufruf aus");
});

test("KV-M4-4 Provider antwortet mit Fehler: kein Wurf, Log zeigt nicht_verfuegbar, Monat gilt als geprueft", async () => {
  const state = makeDefaultState();
  makeTruedCall(state, { monthKey: DUE_MONTH_KEY, actualCostMicroCents: 100 });
  const store = makeStubStore(state);
  const config = fakeConfig();
  let invoiceCalls = 0;
  const voiceControl = fakeVoiceControl({
    telnyx: {
      async fetchMonthlyInvoiceTotal() {
        invoiceCalls++;
        throw new Error("kv-m4-4-netzfehler"); // Netzfehler-Stub liefert throw (Kickoff-Vorgabe)
      },
    },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  let result;
  const logs = await captureConsole(async () => {
    result = await runMonthlyCrossCheck(NOW_ISO);
  });

  assert.deepEqual(result, { skipped: false, monthKey: DUE_MONTH_KEY }, "runMonthlyCrossCheck wirft NICHT weiter");
  assert.ok(
    logs.some((zeile) => zeile === "[cost-cross-check] monat=2026-07 telnyx_rechnung=nicht_verfuegbar(reason=provider_error) ist_je_traeger=keine ist_gesamt_usd_micro_cent=100 gate_carrier_eur_cent=0"),
    `unerwartete Log-Zeile: ${logs.join("\n")}`,
  );

  const second = await runMonthlyCrossCheck(NOW_ISO);
  assert.deepEqual(second, { skipped: true }, "der Monat gilt trotz Fehlschlag als geprueft - kein zweiter Versuch im selben Monat");
  assert.equal(invoiceCalls, 1);
});

test("KV-M4-5 Provider liefert keine Rechnung fuer den Monat: dieselbe Behandlung wie ein harter Fehler", async () => {
  const state = makeDefaultState();
  const store = makeStubStore(state);
  const config = fakeConfig();
  const voiceControl = fakeVoiceControl({
    telnyx: {
      async fetchMonthlyInvoiceTotal() {
        return { ok: false, reason: "invoice_not_found" };
      },
    },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  let result;
  const logs = await captureConsole(async () => {
    result = await runMonthlyCrossCheck(NOW_ISO);
  });

  assert.deepEqual(result, { skipped: false, monthKey: DUE_MONTH_KEY });
  assert.ok(
    logs.some((zeile) => zeile.includes("telnyx_rechnung=nicht_verfuegbar(reason=invoice_not_found)")),
    `unerwartete Log-Zeile: ${logs.join("\n")}`,
  );

  const second = await runMonthlyCrossCheck(NOW_ISO);
  assert.deepEqual(second, { skipped: true }, "kein zweiter Versuch im selben Monat");
});

test("KV-M4-6 Leerer Monat: keine Calls, keine Ledger-Belege -> beide Summen 0 (nicht null), kein Wurf", async () => {
  const state = makeDefaultState();
  const store = makeStubStore(state);
  const config = fakeConfig();
  const voiceControl = fakeVoiceControl({
    telnyx: { async fetchMonthlyInvoiceTotal() { return { ok: false, reason: "invoice_not_found" }; } },
  });
  const { runMonthlyCrossCheck } = makeCostCrossCheck({ store, config, voiceControl });

  let result;
  const logs = await captureConsole(async () => {
    result = await runMonthlyCrossCheck(NOW_ISO);
  });

  assert.deepEqual(result, { skipped: false, monthKey: DUE_MONTH_KEY });
  assert.ok(
    logs.some((zeile) => zeile === "[cost-cross-check] monat=2026-07 telnyx_rechnung=nicht_verfuegbar(reason=invoice_not_found) ist_je_traeger=keine ist_gesamt_usd_micro_cent=0 gate_carrier_eur_cent=0"),
    `unerwartete Log-Zeile: ${logs.join("\n")}`,
  );
});

test("KV-M4-7 erster Lauf ueberhaupt: crossCheckDueMonthKey liefert den Vormonat, nicht null", () => {
  const state = makeDefaultState();
  assert.equal(state.costCrossCheck.lastCheckedMonthKey, null, "Vorbedingung: noch nie geprueft");
  assert.equal(crossCheckDueMonthKey(state, NOW_ISO), DUE_MONTH_KEY);
});

// Winziger, lokaler console.error-Capture (NICHT test/helpers.js erweitert): captureConsole
// dort deckt NUR log/warn ab (Muster kv-m3/cost-truing-Tests) - boot.js loggt Sweep-Fehler
// bewusst ueber console.error (Fehlerkanal), ein dritter Konsument dieser einen Zeile waere
// hier unverhaeltnismaessig gegenueber einem 6-Zeilen-Lokal-Helfer.
async function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...teile) => lines.push(teile.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

// Die WERFENDEN Zweige von runSweepTick - je Eintrag: das Objekt im deps-Buendel, die
// Methode, die runSweepTick darauf ruft, das Log-Praefix ihres .catch() und der Fehlertext
// der Attrappe. EINE Liste statt neun handgerollter Attrappen + neun Assertionspaaren
// (G5): ein neuer Zweig kommt als EIN Eintrag dazu, nicht als drei verstreute Stellen.
//
// Warum ALLE werfen: die Isolation muss in BEIDE Richtungen belegt sein - ein werfender
// Zweig haelt die uebrigen nicht auf, und die uebrigen halten ihn nicht auf. Fehlt auch
// nur eine Methode in der Attrappe, wirft runSweepTick SYNCHRON auf undefined (der Wurf
// liegt VOR dem Promise, das .catch() faengt ihn nicht) - genau der Produktionsschaden,
// den test/sweep-fabrik-vertrag.test.js strukturell abdeckt.
const WERFENDE_ZWEIGE = [
  { zweig: "costCrossCheck", methode: "runMonthlyCrossCheck", logPraefix: "[cost-cross-check]", fehler: "kv-m4-8-boom" },
  { zweig: "outageWatch", methode: "runRecoverySweep", logPraefix: "[outage-watch]", fehler: "kv-m4-8-outage-boom" },
  { zweig: "outageWatch", methode: "runAlertChannelSelfTest", logPraefix: "[outage-watch]", fehler: "kv-m4-8-self-test-boom" },
  { zweig: "outageWatch", methode: "runHoldEscalationSweep", logPraefix: "[outage-watch]", fehler: "kv-m4-8-hold-escalation-boom" },
  { zweig: "paidWithoutNumberWatch", methode: "runPaidWithoutNumberSweep", logPraefix: "[paid-no-number]", fehler: "kv-m4-8-paid-no-number-boom" },
  { zweig: "provisionRetryWatch", methode: "runProvisionRetrySweep", logPraefix: "[provision-retry-sweep]", fehler: "kv-m4-8-provision-retry-boom" },
  { zweig: "priceDriftWatch", methode: "runPriceDriftSweep", logPraefix: "[price-drift]", fehler: "kv-m4-8-price-drift-boom" },
];

// Die beiden Zweige, die SAUBER zurueckkehren - an ihnen wird gemessen, dass die Wuerfe
// der uebrigen sie nicht aufhalten.
const STILLE_ZWEIGE = [
  { zweig: "costTruing", methode: "runCostTruingSweep" },
  { zweig: "provisioning", methode: "settleDueNumberMonthMeters" },
];

const laufSchluessel = ({ zweig, methode }) => `${zweig}.${methode}`;

// Build (P13): das vollstaendige deps-Buendel fuer runSweepTick + ein Protokoll, welche
// Methode tatsaechlich lief.
function baueSweepAttrappen() {
  const gerufen = {};
  const zweige = {};
  const attrappe = (eintrag, rumpf) => {
    zweige[eintrag.zweig] = zweige[eintrag.zweig] || {};
    zweige[eintrag.zweig][eintrag.methode] = async () => {
      gerufen[laufSchluessel(eintrag)] = true;
      return rumpf();
    };
  };
  for (const eintrag of STILLE_ZWEIGE) attrappe(eintrag, () => ({}));
  for (const eintrag of WERFENDE_ZWEIGE)
    attrappe(eintrag, () => {
      throw new Error(eintrag.fehler);
    });
  return { zweige, gerufen };
}

test("KV-M4-8 Sweep-Isolation: ein werfender Zweig haelt keinen der uebrigen auf (Test gegen die boot.js-Verdrahtung selbst)", async () => {
  const { zweige, gerufen } = baueSweepAttrappen();

  const errorLogs = await captureConsoleError(async () => {
    // runSweepTick selbst ist SYNCHRON (kein await zwischen den neun Zweigen) - der
    // Aufruf darf nicht werfen, obwohl mehrere Zweige rejecten.
    assert.doesNotThrow(() => runSweepTick(zweige));
    // Alle neun Zweige sind fire-and-forget - eine Microtask-Runde reicht, damit auch
    // die werfenden Promises ihr .catch() durchlaufen, bevor der Test endet.
    await new Promise((resolve) => setImmediate(resolve));
  });

  for (const eintrag of STILLE_ZWEIGE)
    assert.equal(gerufen[laufSchluessel(eintrag)], true, `${laufSchluessel(eintrag)} lief trotz der Wuerfe der uebrigen Zweige nicht`);

  for (const eintrag of WERFENDE_ZWEIGE) {
    assert.equal(gerufen[laufSchluessel(eintrag)], true, `${laufSchluessel(eintrag)} lief trotz der Wuerfe der uebrigen Zweige nicht`);
    assert.ok(
      errorLogs.some((zeile) => zeile === `${eintrag.logPraefix} ${eintrag.fehler}`),
      `${laufSchluessel(eintrag)}: der Wurf wird geloggt, nicht verschluckt: ${errorLogs.join("\n")}`,
    );
  }
});
