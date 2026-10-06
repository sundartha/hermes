import { execSync } from "node:child_process";
import {
  startServer,
  seedState,
  seedCall,
  ROOT,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
  OWNER_TEST_NUMBER,
} from "../../test/helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";
import { LLM_PROVIDER } from "../../src/llm/provider.js";
import { DRIVERS } from "./drivers.mjs";
import { nextCalleeTurn } from "./persona.mjs";
import { judgeConversation } from "./judge.mjs";
import { runChecks } from "./checks.mjs";
import { parseMetricsLog } from "./metrics-parse.mjs";
import { startExaFake } from "./exa-fake.mjs";
import { startConsultPump } from "./consult-pump.mjs";

export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5";
export const DEFAULT_LLM_PROVIDER_FOR_BENCH = LLM_PROVIDER.ANTHROPIC;
const BENCH_MAX_BUDGET_EUR = "20";
const BENCH_CALL_ID_PREFIX = "call_bench";
const BENCH_TELNYX_OWNER = Object.freeze({ e164: "+13125557000", provider: "telnyx" });

const SUMMARY_POLL_TIMEOUT_MS = 20000;
const SUMMARY_POLL_INTERVAL_MS = 150;

const PRICE_TABLE = Object.freeze({
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-sonnet-5": { in: 2.0, out: 10.0 },
  "deepseek-v4-pro": { in: 0.435, out: 0.87 },
});

function gitRev() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function buildEnv({ apiKey, deepseekApiKey, llmProvider, agentModel, scenario, driverEnv, searchEnv }) {
  return {
    ANTHROPIC_API_KEY: apiKey,
    LLM_PROVIDER: llmProvider,
    DEEPSEEK_API_KEY: deepseekApiKey || "",
    CLAUDE_MODEL: agentModel,
    METRICS_ENABLED: "true",
    ASSISTANT_CONTEXT_ENABLED: scenario.assistantContextEnabled ? "true" : "false",
    MAX_BUDGET_EUR: BENCH_MAX_BUDGET_EUR,
    ...(scenario.env ?? {}),
    ...driverEnv,
    ...searchEnv,
  };
}

const DEFAULT_SEARCH_FACTS = Object.freeze([{ title: "Bench-Treffer", highlight: "Bench-Auszug" }]);

function buildCallSeed({ scenario, provider, tenantId, extra }) {
  return seedCall({
    id: `${BENCH_CALL_ID_PREFIX}_${scenario.id}`,
    tenantId,
    provider,
    direction: "outbound",
    goal: scenario.goal,
    briefing: scenario.briefing,
    constraints: scenario.constraints,
    context: scenario.context,
    mandate: scenario.mandate,
    language: "de",
    status: "active",
    ...extra,
  });
}

export function benchTenantsFor(tenantId) {
  if (tenantId === BOOTSTRAP_TENANT_ID) return null;
  return [{ id: tenantId, status: "active", ownerName: `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}` }];
}

export function assertProfileTenantIsSettable(scenario, tenantId) {
  if (scenario.profile && tenantId === BOOTSTRAP_TENANT_ID) {
    throw new Error(
      `Szenario "${scenario.id}": profile gesetzt, aber tenantId ist der Owner ` +
        `(BOOTSTRAP_TENANT_ID) - resolveProfileFrom pinnt den Owner hart auf ` +
        `OWNER_PROFILE und liest das gespeicherte Profil dort nie. Setze ` +
        `scenario.tenantId auf einen Nicht-Owner-Wert.`,
    );
  }
}

function buildSeed({ scenario, call, isInbound, tenantId }) {
  const priors = (scenario.priorCalls || []).map((prior, i) =>
    seedCall({
      id: `${BENCH_CALL_ID_PREFIX}_${scenario.id}_prior${i}`,
      tenantId,
      direction: "outbound",
      status: "completed",
      endedAt: new Date().toISOString(),
      ...prior,
    }),
  );
  const tenants = benchTenantsFor(tenantId);
  return seedState({
    calls: isInbound ? [] : [call, ...priors],
    ...(scenario.settings ? { settings: scenario.settings } : {}),
    ...(scenario.profile ? { profiles: { [tenantId]: scenario.profile } } : {}),
    ...(tenants ? { tenants } : {}),
  });
}

const SILENT_TURN_TRANSCRIPT_TEXT = "[Schweigen - der Angerufene sagt nichts]";

function calleeTranscriptText(callee) {
  return callee.silent ? SILENT_TURN_TRANSCRIPT_TEXT : callee.text;
}

function pushSample(agentSamples, transcript, turn) {
  agentSamples.push({ turn: agentSamples.length, sayTexts: turn.sayTexts });
  if (turn.sayTexts.length) transcript.push({ role: "agent", text: turn.sayTexts.join(" ") });
}

async function waitForSummary(srv, callId) {
  const deadline = Date.now() + SUMMARY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const call = (srv.readStore().calls || []).find((c) => c.id === callId);
    if (call?.summary != null) return;
    await new Promise((r) => setTimeout(r, SUMMARY_POLL_INTERVAL_MS));
  }
}

function extractStoreSnapshot(store, tenantId, callId) {
  const call = (store.calls || []).find((c) => c.id === callId);
  return {
    summary: call?.summary ?? null,
    objectiveAchieved: call?.objectiveAchieved ?? null,
    result: call?.result ?? null,
    actionItems: (store.actionItems || []).filter((a) => a.callId === callId),
    calendarNewEvents: store.calendar?.[tenantId] || [],
  };
}

function summarizeMetrics(metricsParsed) {
  return {
    turns: metricsParsed.filter((m) => m.kind === "turn").map((m) => m.payload),
    stt_gaps_ms: metricsParsed.filter((m) => m.kind === "stt_gap").map((m) => m.payload.gapMs),
    llm_calls: metricsParsed.filter((m) => m.kind === "llm").map((m) => m.payload),
  };
}

function usdCost(model, usage) {
  if (!usage) return 0;
  const price = PRICE_TABLE[model] || PRICE_TABLE[DEFAULT_AGENT_MODEL];
  return (usage.input_tokens / 1e6) * price.in + (usage.output_tokens / 1e6) * price.out;
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

function estimateCost({ agentModel, agentUsageBucket, personaUsages, personaModel, judgeUsage, judgeModel }) {
  const agentUsd = usdCost(agentModel, {
    input_tokens: agentUsageBucket?.inputTokens || 0,
    output_tokens: agentUsageBucket?.outputTokens || 0,
  });
  const personaUsd = personaUsages.reduce((sum, u) => sum + usdCost(personaModel, u), 0);
  const judgeUsd = usdCost(judgeModel, judgeUsage);
  return {
    agent_usd: round4(agentUsd),
    persona_usd: round4(personaUsd),
    judge_usd: round4(judgeUsd),
    total_usd: round4(agentUsd + personaUsd + judgeUsd),
  };
}

export async function runScenarioRepeat({
  scenario,
  repeatIndex,
  label,
  personaModel,
  judgeModel,
  maxTurnsCap,
  provider,
  driverId,
  apiKey,
  llmProvider = DEFAULT_LLM_PROVIDER_FOR_BENCH,
  agentModel = DEFAULT_AGENT_MODEL,
  deepseekApiKey,
}) {
  const startedAt = new Date().toISOString();
  const isInbound = scenario.direction === "inbound";
  const activeOwnerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : OWNER_TEST_NUMBER;
  const ownerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : undefined;
  const tenantId = scenario.tenantId ?? BOOTSTRAP_TENANT_ID;
  assertProfileTenantIsSettable(scenario, tenantId);

  const transport = await DRIVERS[driverId].create({ scenario, provider });
  const searchFake = scenario.fakeSearch
    ? await startExaFake({ facts: scenario.searchFacts ?? DEFAULT_SEARCH_FACTS }) : null;
  const searchEnv = searchFake ? { EXA_API_BASE: searchFake.url } : {};
  const call = isInbound
    ? null
    : buildCallSeed({ scenario, provider, tenantId, extra: transport.seedOverrides });
  const env = buildEnv({ apiKey, deepseekApiKey, llmProvider, agentModel, scenario, driverEnv: transport.env, searchEnv });
  const seed = buildSeed({ scenario, call, isInbound, tenantId });

  const transcript = [];
  const agentSamples = [];
  const personaUsages = [];
  let endedVia = null;
  let personaError = null;
  let callId = call?.id ?? null;
  let srv;
  let consultPump = null;

  try {
    srv = await startServer({ env, seed, ownerNumber });
    const opened = await transport.open({ srv, scenario, call, activeOwnerNumber });
    callId = opened.callId;
    if (scenario.pumpConsult) {
      consultPump = startConsultPump({
        baseUrl: srv.localUrl,
        callId,
        answers: scenario.consultAnswer ?? [],
      });
    }
    let turn = opened.turn;
    pushSample(agentSamples, transcript, turn);

    let calleeTurnIndex = 0;
    for (;;) {
      if (turn.endedVia) {
        endedVia = turn.endedVia;
        break;
      }
      if (agentSamples.length >= maxTurnsCap) {
        endedVia = "turn_cap";
        break;
      }
      let callee;
      try {
        callee = await nextCalleeTurn({
          apiKey,
          model: personaModel,
          scenario,
          transcript,
          turnIndex: calleeTurnIndex,
        });
      } catch (err) {
        endedVia = "persona_error";
        personaError = err.message;
        break;
      }
      if (callee.refused) {
        endedVia = "persona_refusal";
        break;
      }
      if (callee.usage) personaUsages.push(callee.usage);
      transcript.push({ role: "caller", text: calleeTranscriptText(callee) });

      turn = await transport.say(callee.text);
      calleeTurnIndex += 1;
      pushSample(agentSamples, transcript, turn);
    }

    const metricsParsed = parseMetricsLog(srv.stdout);
    if (callId) {
      await transport.finish(callId);
      await waitForSummary(srv, callId);
    }
    const store = srv.readStore();
    const storeSnapshot = extractStoreSnapshot(store, tenantId, callId);
    const agentUsageBucket = store.usage?.[tenantId];

    const runResult = {
      call: call || { direction: "inbound", language: "de" },
      ownerName: `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`,
      transcript,
      agentSamples,
      endedVia,
      turnCount: agentSamples.length,
      metricsParsed,
      storeSnapshot,
    };

    const checks = runChecks(runResult, scenario);
    let judge;
    try {
      judge = await judgeConversation({ apiKey, model: judgeModel, scenario, transcript });
    } catch (err) {
      judge = { error: err.message };
    }

    const cost = estimateCost({
      agentModel: env.CLAUDE_MODEL,
      agentUsageBucket,
      personaUsages,
      personaModel,
      judgeUsage: judge?.usage,
      judgeModel,
    });

    return {
      meta: {
        scenario: scenario.id,
        repeat_index: repeatIndex,
        label,
        started_at: startedAt,
        agent_model: env.CLAUDE_MODEL,
        llm_provider: env.LLM_PROVIDER,
        persona_model: personaModel,
        judge_model: judgeModel,
        provider,
        driver: driverId,
        direction: scenario.direction,
        git_rev: gitRev(),
      },
      transcript,
      agent_samples: agentSamples,
      metrics: summarizeMetrics(metricsParsed),
      store_snapshot: {
        summary: storeSnapshot.summary,
        objective_achieved: storeSnapshot.objectiveAchieved,
        action_items: storeSnapshot.actionItems,
        calendar_new_events: storeSnapshot.calendarNewEvents,
        result: storeSnapshot.result,
      },
      checks,
      judge,
      cost_estimate_usd: cost,
      turn_count: agentSamples.length,
      ended_via: endedVia,
      persona_error: personaError,
    };
  } finally {
    let consultPumpError = null;
    if (consultPump) {
      try {
        await consultPump.stop();
      } catch (err) {
        consultPumpError = err;
      }
    }
    if (srv) await srv.stop();
    if (searchFake) await searchFake.close();
    await transport.close();
    if (consultPumpError) throw consultPumpError;
  }
}
