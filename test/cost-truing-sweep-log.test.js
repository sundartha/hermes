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
      "pool=1 vollstaendig=true kanaele=keine buch=keine herzschlag=keine nie_beendet=0 " +
      "profillos=0 erschoepft=0 abschluesse=profil_fehlt(2) el_reifung=keine el_abweichung=0 el_uebrig=0",
  );
  assert.equal(
    fetchCalls.length, Number(line.match(/anfragen=(\d+)/)[1]),
    "anfragen zaehlt ECHTE HTTP-Anfragen, nicht eine zweite Buchhaltung",
  );
});

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
    t.mock.timers.tick(2000);
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
