import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../src/billing/cost-truing.js");
const { makeDefaultState, usageFor, platformTtsUsageView } = await import("../src/store/state-ops.js");
const {
  makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl, isoMinutesAgo,
  stubCountingFetch, foreignSipTrunkingPage, NEVER_LAST_PAGE_TOTAL,
} = await import("./cost-truing-harness.js");

const TENANT_A = "tenant_tts_a";
const TENANT_B = "tenant_tts_b";
const ANCHOR_A = "v3:TtsCharsTenantAAnchor0000000000000000000000000000";
const ANCHOR_B = "v3:TtsCharsTenantBAnchor0000000000000000000000000000";
const SESSION_A = "sess-tts-tenant-a-0001";
const SESSION_B = "sess-tts-tenant-b-0002";
const FOREIGN_SESSION = "sess-tts-foreign-0003";
const BAIT_LEG_ID = "0bad0bad-0bad-11f1-0bad-0bad0bad0bad1";
const ENDED_MINUTES_AGO = 200;

function sipTrunkingRecord({ callControlId, sessionId, cost, billedSec, at }) {
  const record = {
    record_type: "sip-trunking",
    cost,
    currency: "USD",
    telnyx_session_id: sessionId,
    telnyx_leg_id: BAIT_LEG_ID,
    started_at: at,
    finished_at: at,
    billed_sec: billedSec,
  };
  if (callControlId) record.call_control_id = callControlId;
  return record;
}

function callControlRecord({ sessionId, cost, billedSec, at }) {
  return {
    record_type: "call-control",
    cost,
    currency: "USD",
    telnyx_session_id: sessionId,
    telnyx_leg_id: BAIT_LEG_ID,
    started_at: at,
    billed_sec: billedSec,
  };
}

function ttsRecord({ sessionId, chars, cost, provider = "elevenlabs" }) {
  return {
    record_type: "text-to-speech",
    cost,
    currency: "USD",
    call_session_id: sessionId,
    call_leg_id: BAIT_LEG_ID,
    provider,
    number_of_characters: chars,
  };
}

test("(P6-5) die Zeichen landen am RICHTIGEN Tenant - kein Ueberlauf", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const callA = makeDueOutboundCall(state, { nowMs, tenantId: TENANT_A, legRef: { callControlId: ANCHOR_A } });
  const callB = makeDueOutboundCall(state, { nowMs, tenantId: TENANT_B, legRef: { callControlId: ANCHOR_B } });
  const store = makeStubStore(state);
  const at = isoMinutesAgo(nowMs, ENDED_MINUTES_AGO);
  stubCountingFetch({
    bodyFor: (recordType) => {
      if (recordType === "sip-trunking")
        return {
          data: [
            sipTrunkingRecord({ callControlId: null, sessionId: SESSION_A, cost: "0.0", billedSec: 0, at }),
            sipTrunkingRecord({ callControlId: ANCHOR_A, sessionId: SESSION_A, cost: "0.0401", billedSec: 60, at }),
            sipTrunkingRecord({ callControlId: null, sessionId: SESSION_B, cost: "0.0", billedSec: 0, at }),
            sipTrunkingRecord({ callControlId: ANCHOR_B, sessionId: SESSION_B, cost: "0.0502", billedSec: 60, at }),
          ],
        };
      if (recordType === "call-control")
        return {
          data: [
            callControlRecord({ sessionId: SESSION_A, cost: "0.0", billedSec: 0, at }),
            callControlRecord({ sessionId: SESSION_A, cost: "0.002", billedSec: 60, at }),
            callControlRecord({ sessionId: SESSION_B, cost: "0.0", billedSec: 0, at }),
            callControlRecord({ sessionId: SESSION_B, cost: "0.003", billedSec: 60, at }),
          ],
        };
      if (recordType === "text-to-speech")
        return {
          data: [
            ttsRecord({ sessionId: SESSION_A, chars: 238, cost: "1.666E-4" }),
            ttsRecord({ sessionId: SESSION_B, chars: 17, cost: "1.7E-4" }),
            ttsRecord({ sessionId: FOREIGN_SESSION, chars: 9999, cost: "1.0E-4" }),
          ],
        };
      return { data: [] };
    },
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(usageFor(state, TENANT_A).ttsCharacters, 238);
  assert.equal(usageFor(state, TENANT_B).ttsCharacters, 17);
  assert.equal(callA.actualCostMicroCents, 4_226_660, "0 + 4010000 + 0 + 200000 + 16660");
  assert.equal(callB.actualCostMicroCents, 5_337_000, "0 + 5020000 + 0 + 300000 + 17000");
});

test("(P6-6) zweiter Sweep zaehlt NICHT erneut (costTruedAt ist der Riegel)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const callA = makeDueOutboundCall(state, { nowMs, tenantId: TENANT_A, legRef: { callControlId: ANCHOR_A } });
  const store = makeStubStore(state);
  const at = isoMinutesAgo(nowMs, ENDED_MINUTES_AGO);
  stubCountingFetch({
    bodyFor: (recordType) => {
      if (recordType === "sip-trunking")
        return {
          data: [
            sipTrunkingRecord({ callControlId: null, sessionId: SESSION_A, cost: "0.0", billedSec: 0, at }),
            sipTrunkingRecord({ callControlId: ANCHOR_A, sessionId: SESSION_A, cost: "0.0401", billedSec: 60, at }),
          ],
        };
      if (recordType === "text-to-speech")
        return { data: [ttsRecord({ sessionId: SESSION_A, chars: 238, cost: "1.666E-4" })] };
      return { data: [] };
    },
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const after1 = usageFor(state, TENANT_A).ttsCharacters;
  assert.equal(after1, 238);
  assert.notEqual(callA.costTruedAt, null, "der Call ist geschlossen - genau das ist der Riegel");

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL });
  assert.equal(usageFor(state, TENANT_A).ttsCharacters, after1, "genau EINE Buchung je Call");
});

test("(P6-7) unvollstaendiger Pool -> keine Zeichen (dieselbe fail-closed-Asymmetrie wie das Geld)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, tenantId: TENANT_A, legRef: { callControlId: "cc_p6_7" } });
  const store = makeStubStore(state);
  stubCountingFetch({
    bodyFor: () => foreignSipTrunkingPage({
      at: isoMinutesAgo(nowMs, ENDED_MINUTES_AGO), idPrefix: "cc_p6_7", totalPages: NEVER_LAST_PAGE_TOTAL,
    }),
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(usageFor(state, TENANT_A).ttsCharacters, 0);
});

test("KV-P7-12: Relay-Verbrauch landet NACH dem Sweep im Kontingent-Zaehler; zweiter Sweep aendert nichts (costTruedAt)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, tenantId: TENANT_A, legRef: { callControlId: ANCHOR_A } });
  const store = makeStubStore(state);
  const at = isoMinutesAgo(nowMs, ENDED_MINUTES_AGO);
  stubCountingFetch({
    bodyFor: (recordType) => {
      if (recordType === "sip-trunking")
        return { data: [sipTrunkingRecord({ callControlId: ANCHOR_A, sessionId: SESSION_A, cost: "0.0401", billedSec: 60, at })] };
      if (recordType === "text-to-speech")
        return { data: [ttsRecord({ sessionId: SESSION_A, chars: 238, cost: "1.666E-4" })] };
      return { data: [] };
    },
  });
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const nowIso = new Date(nowMs).toISOString();
  assert.equal(platformTtsUsageView(state, config.billing, nowIso).characters, 238);

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL });
  assert.equal(
    platformTtsUsageView(state, config.billing, nowIso).characters, 238,
    "zweiter Sweep bucht NICHT erneut - costTruedAt ist der Riegel",
  );
});

test("KV-P7-13: Warnschwelle laeuft ueber den bestehenden Befundkanal (WARN + Audit), KEINE SMS", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, tenantId: TENANT_A, legRef: { callControlId: ANCHOR_A } });
  const config = fakeConfig({ ttsCharacterQuota: 300, ttsCharacterQuotaWarnPercent: 50 });
  const store = makeStubStore(state, { billing: config.billing });
  const at = isoMinutesAgo(nowMs, ENDED_MINUTES_AGO);
  stubCountingFetch({
    bodyFor: (recordType) => {
      if (recordType === "sip-trunking")
        return { data: [sipTrunkingRecord({ callControlId: ANCHOR_A, sessionId: SESSION_A, cost: "0.0401", billedSec: 60, at })] };
      if (recordType === "text-to-speech")
        return { data: [ttsRecord({ sessionId: SESSION_A, chars: 238, cost: "1.666E-4" })] };
      return { data: [] };
    },
  });

  const warns = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  const auditCalls = [];
  const audit = (event, req, detail) => auditCalls.push({ event, req, detail });
  const smsCalls = [];
  const messaging = () => ({
    async sendSms(args) {
      smsCalls.push(args);
    },
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit, messaging, now: () => nowMs,
  });
  try {
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(
    warns.some((w) => w.includes("grund=tts_quota_warn_threshold")),
    `erwartet WARN mit grund=tts_quota_warn_threshold:\n${warns.join("\n")}`,
  );
  assert.equal(
    auditCalls.filter((c) => c.detail.includes("tts_quota_warn_threshold")).length, 1,
    "genau EINE Audit-Zeile fuer die Warnschwelle",
  );
  assert.equal(smsCalls.length, 0, "der Sweep-Weg loest KEINE SMS aus (der Play-TTS-Pfad alarmiert separat)");
});
