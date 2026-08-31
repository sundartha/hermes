// KE-P6 (Aenderung 3): das Sweep-Log ist die Datenquelle des Bruchpunkt-Waechters (KE-P8)
// und liefert B = pool/kandidaten aus der Wirklichkeit (U9). Deshalb gegen den ECHTEN
// Adapter, mit gestubbtem global.fetch: nur so zaehlt `anfragen` echte HTTP-Anfragen.
// Env VOR den dynamischen Importen (Lehre test-base-env-drift), Muster cost-truing-pool.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice, ASSIGNABLE_COST_RECORD_TYPES } = await import("../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../src/billing/cost-truing.js");
const { makeDefaultState } = await import("../src/store/state-ops.js");
const { captureConsole } = await import("./helpers.js");
const {
  makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl,
  stubCountingFetch, measuredSipTrunkingRecord, foreignSipTrunkingPage, NEVER_LAST_PAGE_TOTAL,
} = await import("./cost-truing-harness.js");

const sweepLineOf = (lines) => lines.filter((l) => l.startsWith("[cost-truing] sweep "));

// ---- (P6-8) das Format selbst: die vier neuen Felder HINTER den Bestandsfeldern ----
//
// Zwei Kandidaten mit demselben Anker (bewusst - dieser Test pinnt NUR das Log-FORMAT, die
// Zuordnungs-Korrektheit selbst ist test/cost-truing-pool.test.js/telnyx-cost-records.test.js
// vorbehalten): so liefert EIN einziger Roh-Beleg (pool=1) fuer BEIDE Kandidaten einen
// nicht-leeren Treffer (unvollstaendig=2, unbestimmt=0) - ohne die Kernzusage D1 (EIN
// Pool-Abruf je Sweep) zu verlassen. costTruingRequiredRecordTypes bleibt beim
// fakeConfig-Default [] -> classifyRecords liefert nie 'complete' (gemessen=0 bleibt exakt).
test("(P6-8) Sweep-Log traegt anfragen/seiten/pool/vollstaendig HINTER den Bestandsfeldern", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const SHARED_ANCHOR = "v3:SharedAnchorForLogFormatTestOnly000000000000000000";
  makeDueOutboundCall(state, { nowMs, legRef: { callControlId: SHARED_ANCHOR } });
  makeDueOutboundCall(state, { nowMs, legRef: { callControlId: SHARED_ANCHOR } });
  const store = makeStubStore(state);
  const anchorRecord = measuredSipTrunkingRecord({
    at: new Date(nowMs).toISOString(), sessionId: "sess_p6_8", callControlId: SHARED_ANCHOR,
  });
  const fetchCalls = stubCountingFetch({
    bodyFor: (recordType) => (recordType === "sip-trunking" ? { data: [anchorRecord] } : { data: [] }),
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = sweepLineOf(lines);
  assert.equal(
    line,
    "[cost-truing] sweep trigger=manual kandidaten=2 gemessen=0 unvollstaendig=2 " +
      "ohne_schaetzung=0 unbestimmt=0 uebersprungen=0 " +
      `anfragen=${ASSIGNABLE_COST_RECORD_TYPES.length} seiten=${ASSIGNABLE_COST_RECORD_TYPES.length} ` +
      // KV2-1 (Kriterium (d)): kanaele= HINTER den Bestandsfeldern - kein Ziel gesetzt
      // (BASE_ENV/fakeConfig-Default) -> kanaele=keine.
      // KV2-6: buch=/herzschlag= HINTER kanaele=. Beide Kandidaten enden 200 min her
      // (makeDueOutboundCall-Default) - das liegt INNERHALB der Karenz dieser Config
      // (costTruingDelayMinutes=180min + costTruingSweepIntervalMs=1h = 4h), also
      // ausserhalb JEDES Fensters: buch=keine herzschlag=keine.
      "pool=1 vollstaendig=true kanaele=keine buch=keine herzschlag=keine nie_beendet=0 profillos=0",
  );
  assert.equal(
    fetchCalls.length, Number(line.match(/anfragen=(\d+)/)[1]),
    "anfragen zaehlt ECHTE HTTP-Anfragen, nicht eine zweite Buchhaltung",
  );
});

// ---- (P6-9) 0 Kandidaten -> 0 Anfragen, die Zeile erscheint trotzdem (KE-P5-Nachweis) ----

test("(P6-9) 0 Kandidaten -> 0 Anfragen, aber die Zeile erscheint (KE-P5-Nachweis, jetzt ablesbar)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const store = makeStubStore(state);
  const fetchCalls = stubCountingFetch();
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = sweepLineOf(lines);
  assert.match(line, /kandidaten=0 .* anfragen=0 seiten=0 pool=0 vollstaendig=true/);
  assert.equal(fetchCalls.length, 0, "ohne Kandidaten darf der Sweep keine einzige Anfrage stellen");
});

// ---- (P6-10) unvollstaendiger Pool: vollstaendig=false, die Anfragen stehen trotzdem da ----

test("(P6-10) unvollstaendiger Pool -> vollstaendig=false, die Anfragen stehen trotzdem da", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_p6_10" } });
  const store = makeStubStore(state);
  stubCountingFetch({
    bodyFor: () => foreignSipTrunkingPage({
      at: new Date(nowMs).toISOString(), idPrefix: "cc_p6_10", totalPages: NEVER_LAST_PAGE_TOTAL,
    }),
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = sweepLineOf(lines);
  assert.match(line, / vollstaendig=false/);
  assert.ok(
    Number(line.match(/anfragen=(\d+)/)[1]) > 0,
    "genau im Stoerfall darf der Waechter nicht blind sein",
  );
});

// ---- (P6-11) 429 mit Wiederholung: anfragen > seiten (der verbrannte Versuch ist sichtbar) ----
//
// Muster (P4-R2, telnyx-cost-records.test.js): Mock-Timer statt Wanduhr - die produktive
// Drossel (kein throttle-Override im Sweep-Pfad) haengt an setTimeout, Date.now bleibt real.

test("(P6-11) 429 mit Wiederholung: anfragen > seiten (der verbrannte Versuch ist sichtbar)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const nowMs = Date.now();
    const state = makeDefaultState();
    makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_p6_11" } });
    const store = makeStubStore(state);
    const RATE_LIMIT_BODY = { errors: [{ code: "10011", title: "Too many requests" }] };
    let firstTypeAttempts = 0;
    global.fetch = async (url) => {
      const params = new URL(String(url)).searchParams;
      const isFirstType = params.get("filter[record_type]") === ASSIGNABLE_COST_RECORD_TYPES[0];
      if (isFirstType) firstTypeAttempts++;
      if (isFirstType && firstTypeAttempts === 1) {
        return {
          ok: false, status: 429, headers: new Headers({ "x-ratelimit-reset": "1" }),
          json: async () => RATE_LIMIT_BODY, text: async () => JSON.stringify(RATE_LIMIT_BODY),
        };
      }
      const body = { data: [] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
    };

    const { runCostTruingSweep } = makeCostTruing({
      store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
    });

    const sweepPromise = captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(2000); // ueber die 1 s Wartezeit aus x-ratelimit-reset hinaus
    const lines = await sweepPromise;

    const [line] = sweepLineOf(lines);
    const requests = Number(line.match(/anfragen=(\d+)/)[1]);
    const pages = Number(line.match(/seiten=(\d+)/)[1]);
    assert.ok(requests > pages, "eine wiederholte Anfrage ist eine Anfrage mehr, aber keine Seite mehr");
    assert.equal(firstTypeAttempts, 2, "ein Versuch + genau eine Wiederholung");
  } finally {
    t.mock.timers.reset();
  }
});
