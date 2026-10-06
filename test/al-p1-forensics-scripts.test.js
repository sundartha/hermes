import { test } from "node:test";
import assert from "node:assert/strict";
import { abandonStats, ABANDON_WINDOW_MS } from "../scripts/call-abandon-rate.mjs";
import {
  unaccountedMsOf,
  unaccountedVerdict,
  parseLatencyArgs,
} from "../scripts/telnyx-call-latency.mjs";
import { readAcrossTenants } from "../scripts/prod-read.mjs";

const OUTBOUND_ANSWERED_ABANDON = {
  direction: "outbound",
  answeredAt: "2026-07-28T10:00:00.000Z",
  endedAt: "2026-07-28T10:00:10.000Z",
  callerTurns: 0,
};

test("AL-P1-14: abandonStats zaehlt nur beantwortete Outbounds unter 15s mit callerTurns 0", () => {
  const exactWindow = {
    direction: "outbound",
    answeredAt: "2026-07-28T10:00:00.000Z",
    endedAt: "2026-07-28T10:00:15.000Z",
    callerTurns: 0,
  };
  const withCallerTurn = {
    direction: "outbound",
    answeredAt: "2026-07-28T10:00:00.000Z",
    endedAt: "2026-07-28T10:00:05.000Z",
    callerTurns: 1,
  };
  const inboundEarly = {
    direction: "inbound",
    answeredAt: "2026-07-28T10:00:00.000Z",
    endedAt: "2026-07-28T10:00:05.000Z",
    callerTurns: 0,
  };
  const unanswered = {
    direction: "outbound",
    answeredAt: null,
    endedAt: "2026-07-28T10:00:05.000Z",
    callerTurns: 0,
  };
  const rows = [OUTBOUND_ANSWERED_ABANDON, exactWindow, withCallerTurn, inboundEarly, unanswered];

  const stats = abandonStats(rows);

  assert.equal(stats.answeredOutbound, 3, "nur die drei beantworteten Outbound-Zeilen zaehlen im Nenner");
  assert.equal(stats.abandoned, 1, "NUR OUTBOUND_ANSWERED_ABANDON erfuellt alle drei Kriterien");
  assert.ok(Math.abs(stats.ratePercent - 33.333333) < 0.001);
});

test("AL-P1-15: abandonStats liefert ratePercent null bei leerem Nenner (keine erfundene 0%)", () => {
  assert.equal(abandonStats([]).ratePercent, null);
  const noOutbound = [{ direction: "inbound", answeredAt: "t", endedAt: "t2", callerTurns: 0 }];
  assert.equal(abandonStats(noOutbound).ratePercent, null);
});

test("AL-P1-15b: ABANDON_WINDOW_MS ist die gepinnte Spec-Konstante (15s)", () => {
  assert.equal(ABANDON_WINDOW_MS, 15_000);
});

test("AL-P1-16: unaccountedMsOf -> undefined, wenn ein benannter Posten fehlt", () => {
  const complete = {
    transcription_duration_ms: 100,
    llm_first_token_duration_ms: 800,
    audio_first_token_duration_ms: 300,
    start_speaking_plan_extra_wait_duration_ms: 0,
    end_user_perceived_latency_ms: 1300,
  };
  assert.equal(unaccountedMsOf(complete), 100, "1300 - (100+800+300+0) = 100");

  const missingOnePosten = { ...complete, llm_first_token_duration_ms: undefined };
  assert.equal(unaccountedMsOf(missingOnePosten), undefined, "ein fehlender Posten -> undefined, NIE 0");

  const missingTotal = { ...complete, end_user_perceived_latency_ms: undefined };
  assert.equal(unaccountedMsOf(missingTotal), undefined, "fehlende Gesamtzahl -> undefined");
});

test("AL-P1-17: unaccountedVerdict kippt bei > 300ms auf exceedsTolerance", () => {
  const rowsOk = [
    {
      transcription_duration_ms: 100,
      llm_first_token_duration_ms: 800,
      audio_first_token_duration_ms: 300,
      start_speaking_plan_extra_wait_duration_ms: 0,
      end_user_perceived_latency_ms: 1300,
    },
  ];
  const verdictOk = unaccountedVerdict(rowsOk);
  assert.equal(verdictOk.medianMs, 100);
  assert.equal(verdictOk.exceedsTolerance, false);

  const rowsExceed = [
    {
      transcription_duration_ms: 100,
      llm_first_token_duration_ms: 800,
      audio_first_token_duration_ms: 300,
      start_speaking_plan_extra_wait_duration_ms: 0,
      end_user_perceived_latency_ms: 1800,
    },
  ];
  const verdictExceed = unaccountedVerdict(rowsExceed);
  assert.equal(verdictExceed.medianMs, 600);
  assert.equal(verdictExceed.exceedsTolerance, true);

  const verdictEmpty = unaccountedVerdict([]);
  assert.equal(verdictEmpty.medianMs, undefined, "leere Basis -> kein Urteil");
  assert.equal(verdictEmpty.exceedsTolerance, false);
});

test("AL-P1-18: parseLatencyArgs unterscheidet UUID, --call und Fehlform", () => {
  assert.deepEqual(parseLatencyArgs(["node", "script.mjs", "conv-uuid-123"]), {
    conversationId: "conv-uuid-123",
  });
  assert.deepEqual(parseLatencyArgs(["node", "script.mjs", "--call", "call_hermes_1"]), {
    hermesCallId: "call_hermes_1",
  });
  assert.ok(parseLatencyArgs(["node", "script.mjs"]).error, "kein Argument -> error");
  assert.ok(parseLatencyArgs(["node", "script.mjs", "--call"]).error, "--call ohne Wert -> error");
});

function fakeRunner(tenantRows) {
  const queries = [];
  let poolEndCalls = 0;
  const client = {
    async query(text, params) {
      queries.push({ text: text.trim(), params });
      if (text.includes("FROM tenant")) return { rows: tenantRows };
      if (text.includes("set_config")) return { rows: [] };
      return { rows: [] };
    },
  };
  return {
    queries,
    poolEndCallsRef: () => poolEndCalls,
    async withClient(fn) {
      return fn(client);
    },
    _pool: {
      async end() {
        poolEndCalls++;
      },
    },
  };
}

test("AL-P1-19: readAcrossTenants setzt app.current_tenant PRO Tenant (vor dem jeweiligen Read) und schliesst den Pool", async () => {
  const runner = fakeRunner([{ id: "tenant_a" }, { id: "tenant_b" }]);
  const readRows = async (client, tenantId) => {
    const setConfigForThisTenant = runner.queries.filter(
      (q) => q.text.includes("set_config") && q.params[0] === tenantId,
    );
    assert.equal(setConfigForThisTenant.length, 1, `set_config fuer ${tenantId} muss VOR dem Read stehen`);
    return [{ tenantId }];
  };

  const rows = await readAcrossTenants(readRows, { runner });

  assert.deepEqual(rows, [{ tenantId: "tenant_a" }, { tenantId: "tenant_b" }]);
  assert.equal(runner.poolEndCallsRef(), 1, "_pool.end() wird genau einmal gerufen");
});

test("AL-P1-19b: readAcrossTenants schliesst den Pool auch, wenn readRows wirft", async () => {
  const runner = fakeRunner([{ id: "tenant_a" }]);
  const throwingReadRows = async () => {
    throw new Error("boom");
  };

  await assert.rejects(() => readAcrossTenants(throwingReadRows, { runner }), /boom/);
  assert.equal(runner.poolEndCallsRef(), 1, "_pool.end() wird auch im Wurf-Fall genau einmal gerufen");
});
