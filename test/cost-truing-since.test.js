// KE-P5 (die Zeitschranke des Belegabrufs): EIGENE Datei neben cost-truing-pool.test.js aus
// zwei Gruenden. (1) Der Gegenstand ist ein anderer: nicht "einmal je Sweep statt je
// Kandidat", sondern "wie weit zurueck". (2) node --test fuehrt je DATEI einen Prozess -
// die modul-globale Drossel des Adapters (30 Anfragen je realer UTC-Minute) hat damit je
// Datei ein eigenes Budget; beides in eine Datei zu legen brachte sie an die 30 und liesse
// die Suite irgendwann unerklaerlich eine Minute schlafen.
// Der ECHTE Telnyx-Adapter ist Pflicht, wo die ANZAHL der Anfragen die Zusage ist - ein
// Fake koennte sie nicht falsifizieren. Netzfrei: global.fetch ist gestubbt. process.env
// VOR den dynamischen Importen (Lehre test-base-env-drift).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice, ASSIGNABLE_COST_RECORD_TYPES } = await import("../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../src/billing/cost-truing.js");
const { makeDefaultState, usageFor } = await import("../src/store/state-ops.js");
const { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } = await import("../src/store/defaults.js");
const {
  makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl,
  stubCountingFetch, measuredSipTrunkingRecord, foreignSipTrunkingPage,
  MEASURED_PAGE_SIZE, NEVER_LAST_PAGE_TOTAL,
} = await import("./cost-truing-harness.js");

// FESTE Uhr und FESTE Kandidatenalter: die erwartete Schranke steht unten als LITERAL, nicht
// als zweite Ausfuehrung derselben Formel - eine nachgerechnete Erwartung waere mit jedem
// Vorzeichenfehler mit-falsch.
const P5_NOW = "2026-07-21T18:00:00.000Z";
const OLDEST_ENDED_MINUTES_AGO = 600;                    // endedAt = 08:00:00Z
const EXPECTED_SINCE = "2026-07-21T02:00:00.000Z";       // 08:00:00Z minus 6 h Marge
// Der groesste Abstand, den ein Beleg zum endedAt seines Anrufs haben kann: die Gespraechs-
// dauer, hart gedeckelt durch MAX_CALL_DURATION_CAP_S (die absolute Obergrenze der
// guthaben-abgeleiteten Notbremse, KS-P3). Genau diesen Fall muss die Marge abdecken -
// (P5-5) prueft ihn. Seit KS-P3 wird die Marge daraus ABGELEITET (Faktor 12), statt als
// Zahl gepflegt zu werden; der Eigenschafts-Assert unten haelt das fest.
const { MAX_CALL_DURATION_CAP_S } = await import("../src/store/defaults.js");
const POOL_SINCE_MARGIN_FACTOR = 12;

// Fake im Port-Zuschnitt, der die Pool-PARAMETER aufzeichnet (der Pruefgegenstand von
// P5-1/P5-2 ist der uebergebene Wert, nicht das Netz).
function paramRecordingAdapter(poolParams) {
  return {
    async fetchCostRecordPool(params) {
      poolParams.push(params);
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords: () => ({ ok: true, records: [] }),
  };
}

const sweepWith = ({ state, control, nowMs, config = fakeConfig(), store = makeStubStore(state) }) => ({
  store,
  run: makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  }).runCostTruingSweep,
});

test("(P5-1) `since` kommt vom AELTESTEN Kandidaten minus Marge - EINE Schranke je Sweep", async () => {
  const nowMs = Date.parse(P5_NOW);
  const state = makeDefaultState();
  // Reihenfolge im Store bewusst unsortiert: der aelteste steht in der Mitte.
  makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 200, legRef: { callControlId: "cc_p5_mid" } });
  makeDueOutboundCall(state, { nowMs, endedMinutesAgo: OLDEST_ENDED_MINUTES_AGO, legRef: { callControlId: "cc_p5_old" } });
  makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 190, legRef: { callControlId: "cc_p5_new" } });
  const poolParams = [];
  const { run } = sweepWith({ state, control: paramRecordingAdapter(poolParams), nowMs });

  const res = await run({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(res.candidates, 3);
  assert.equal(poolParams.length, 1, "EIN Pool-Abruf je Sweep, also auch EINE Schranke");
  assert.equal(poolParams[0]?.since, EXPECTED_SINCE);
});

// KS-P3 / TOD 12: die Marge war einmal eine Zahl, die an einem Cap hing, der sich geaendert
// hat. Dieser Assert rechnet sie aus der BEOBACHTETEN Schranke zurueck und haelt sie gegen
// die abgeleitete Untergrenze - er ueberlebt damit den naechsten Cap-Wechsel, waehrend das
// Literal EXPECTED_SINCE oben ihn bewusst NICHT ueberlebt (dort ist die Zahl der Beweis).
test("(P5-1b) die Marge bleibt mindestens das Zwoelffache der absoluten Obergrenze", async () => {
  const nowMs = Date.parse(P5_NOW);
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, {
    nowMs,
    endedMinutesAgo: OLDEST_ENDED_MINUTES_AGO,
    legRef: { callControlId: "cc_p5_marge" },
  });
  const poolParams = [];
  const { run } = sweepWith({ state, control: paramRecordingAdapter(poolParams), nowMs });

  await run({ trigger: SWEEP_TRIGGER.MANUAL });

  const marginMs = Date.parse(call.endedAt) - Date.parse(poolParams[0].since);
  assert.ok(
    marginMs >= POOL_SINCE_MARGIN_FACTOR * MAX_CALL_DURATION_CAP_S * 1000,
    `Marge ${marginMs} ms muss mindestens das ${POOL_SINCE_MARGIN_FACTOR}-fache der ` +
      `Obergrenze (${MAX_CALL_DURATION_CAP_S}s) betragen - sonst endet die Seitenschleife ` +
      "vor dem Beleg und der Pool gilt trotzdem als vollstaendig (fail-open im Geldpfad)",
  );
});

test("(P5-2) ein unbrauchbarer endedAt zieht die Schranke NICHT ins Bodenlose", async () => {
  const nowMs = Date.parse(P5_NOW);
  const state = makeDefaultState();
  const kaputt = makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 3000, legRef: { callControlId: "cc_p5_kaputt" } });
  kaputt.endedAt = "irgendwann"; // truthy, aber nicht parsebar -> kein Kandidat
  makeDueOutboundCall(state, { nowMs, endedMinutesAgo: OLDEST_ENDED_MINUTES_AGO, legRef: { callControlId: "cc_p5_old" } });
  const poolParams = [];
  const { run } = sweepWith({ state, control: paramRecordingAdapter(poolParams), nowMs });

  const res = await run({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(res.candidates, 1, "der Call mit unbrauchbarem Zeitstempel ist kein Kandidat");
  assert.equal(poolParams[0]?.since, EXPECTED_SINCE, "die Schranke haengt am aeltesten BRAUCHBAREN Kandidaten");
  assert.ok(!Number.isNaN(Date.parse(poolParams[0].since)), "nie NaN - new Date(NaN).toISOString() wuerfe");
});

test("(P5-3) leere Kandidatenliste -> KEINE einzige Anfrage, kein Versuch verbraucht", async () => {
  const nowMs = Date.parse(P5_NOW);
  const state = makeDefaultState();
  const zuJung = makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 5, legRef: { callControlId: "cc_p5_jung" } });
  const fetchCalls = stubCountingFetch();
  const { store, run } = sweepWith({ state, control: telnyxVoice, nowMs });

  const res = await run({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(fetchCalls.length, 0, "ohne Kandidaten geht keine Anfrage hinaus");
  assert.equal(res.candidates, 0);
  assert.equal(store.writes.length, 0, "sauberes No-op: kein Schreibzugriff");
  assert.equal(zuJung.costTruingAttempts, 0, "kein Versuch verbraucht");
  assert.equal(zuJung.costTruedSource, null);
});

test("(P5-4) EIN 3 h alter Kandidat -> genau eine Anfrage je Typ (die Schranke beendet die Seitenschleife)", async () => {
  const nowMs = Date.parse(P5_NOW);
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 180, legRef: { callControlId: "cc_p5_3h" } });
  // Eine VOLLE Seite fremder Belege, deren Zeitfelder weit vor der Schranke liegen
  // (2026-06-20 - die gemessene Retention reicht >= 31 Tage zurueck), mit einem
  // total_pages, das keine Seite zur letzten macht. Ohne Schranke blaettert der Adapter bis
  // zur Seitenobergrenze; mit Schranke endet er nach Seite 1.
  const fetchCalls = stubCountingFetch({
    bodyFor: (recordType) =>
      recordType === "sip-trunking"
        ? foreignSipTrunkingPage({ at: "2026-06-20T10:00:00Z", idPrefix: "cc_p5_fremd", totalPages: NEVER_LAST_PAGE_TOTAL })
        : { data: [] },
  });
  const { run } = sweepWith({ state, control: telnyxVoice, nowMs });

  await run({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(fetchCalls.length, ASSIGNABLE_COST_RECORD_TYPES.length,
    "eine Seite je Typ - ohne Schranke waeren es allein fuer sip-trunking 10 (Seitenobergrenze)");
  assert.deepEqual(
    fetchCalls
      .filter((c) => new URL(c.url).searchParams.get("filter[record_type]") === "sip-trunking")
      .map((c) => new URL(c.url).searchParams.get("page[number]")),
    ["1"],
  );
});

// (P5-5) ist vor UND nach der Aenderung gruen - das ist Absicht: sie ist der Mutationsschutz
// fuer POOL_SINCE_MARGIN_MS und faellt, sobald die Marge kleiner wird als die maximale
// Gespraechsdauer. Die Rot-vor-Gruen-Pflicht (A2) tragen P5-1/P5-2/P5-4.
// Fixture-Aufbau: Seite 1 traegt 50 FREMDE Belege, deren Zeitfelder GENAU am
// Gespraechsbeginn des Kandidaten liegen (endedAt minus MAX_CALL_DURATION_CAP_S) - eine zu
// knappe Marge erklaerte diese Seite fuer "vor der Schranke" und braeche ab, bevor Seite 2
// geholt ist. Seite 2 traegt die EIGENEN Belege des Kandidaten inklusive NULL-ZWILLING
// (Plan F3/PM-11, A2-Pflicht, weil dieser Test eine Kostensumme prueft).
function ownRecordsPage(at, sessionId, legId) {
  return {
    data: [
      // erstes Bein: traegt den Anker UND ist der Null-Zwilling (cost 0.0, billed_sec 0)
      measuredSipTrunkingRecord({ at, sessionId, callControlId: legId, cost: "0.0", billedSec: 0 }),
      // zweites Bein: OHNE Anker, kommt allein ueber die Session herein - und traegt das Geld
      measuredSipTrunkingRecord({ at, sessionId, cost: "0.0401", billedSec: 60 }),
    ],
    meta: { total_results: MEASURED_PAGE_SIZE + 2, total_pages: 2, page_size: MEASURED_PAGE_SIZE },
  };
}

test("(P5-5) die Marge deckt die Gespraechsdauer: eigene Belege auf Seite 2 werden gefunden und VOLLSTAENDIG summiert", async () => {
  const nowMs = Date.parse(P5_NOW);
  const state = makeDefaultState();
  state.usage[BOOTSTRAP_TENANT_ID] = { ...emptyUsage(), costCents: 100 };
  const legId = "v3:p5-anker";
  const call = makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 200, legRef: { callControlId: legId }, estimatedCostCents: 20 });
  const callStartIso = new Date(Date.parse(call.endedAt) - MAX_CALL_DURATION_CAP_S * 1000).toISOString();
  const fetchCalls = stubCountingFetch({
    bodyFor: (recordType, pageNumber) => {
      if (recordType !== "sip-trunking") return { data: [] };
      return pageNumber === 1
        ? foreignSipTrunkingPage({ at: callStartIso, idPrefix: "cc_p5_5_fremd", totalPages: 2 })
        : ownRecordsPage(callStartIso, "sess-p5-anker", legId);
    },
  });
  const { run } = sweepWith({
    state, control: telnyxVoice, nowMs,
    config: fakeConfig({ costTruingRequiredRecordTypes: ["sip-trunking"] }),
  });

  const res = await run({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(res.measured, 1, "Seite 2 wurde geholt - eine zu knappe Marge haette hier abgebrochen");
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.DETAIL_RECORDS);
  assert.equal(call.actualCostMicroCents, 4_010_000, "Null-Zwilling (0) + abgerechneter Beleg (0.0401 USD) - ALLE zugeordneten Belege");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 84, "Korrektur gebucht: 100 - (20 - 4)");
  assert.equal(fetchCalls.filter((c) => new URL(c.url).searchParams.get("filter[record_type]") === "sip-trunking").length, 2);
});
