// Kern-Orchestrierung der Conversation-Bench (tasks/convo-bench-spec.md §3): treibt
// EIN (Szenario, Repeat) end-to-end. Server-Start ueber test/helpers.js (Praezedenz:
// scripts/smoke-stripe-payment.mjs importiert dieselbe Datei) - direkter Store-Seed
// via seedState/seedCall, NIEMALS POST /api/calls (einzige Route mit originateCall,
// Spec §6 Sicherheitsargument). ANTHROPIC_API_KEY erreicht diese Datei nur als
// Funktionsargument, nie geloggt.
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
import { parseVoiceBody } from "./texml.mjs";
import { nextCalleeTurn } from "./persona.mjs";
import { judgeConversation } from "./judge.mjs";
import { runChecks } from "./checks.mjs";
import { parseMetricsLog } from "./metrics-parse.mjs";

// Produktions-Default (Spec §0: "Kein Wechsel von claude-haiku-4-5 ... im Produktions-
// Pfad") - die Bench setzt CLAUDE_MODEL fuer den gespawnten Server explizit auf
// denselben Wert wie config.js' eigener Default, statt sich auf den Default zu
// verlassen (Absicht im Code sichtbar, G16).
const PRODUCTION_CLAUDE_MODEL = "claude-haiku-4-5";
// Defensive Anhebung des Bench-Budgets (Spec §3-1): der Store-Default (BASE_ENV) waere
// zu knapp fuer mehrere Repeats/Turns in einem Lauf.
const BENCH_MAX_BUDGET_EUR = "20";
const CALL_SID = "CAtest_bench";
const BENCH_CALL_ID_PREFIX = "call_bench";
const BENCH_DEFAULT_CALLER = "+4915100000099";
// Dummy-Telnyx-Owner-Nummer NUR fuer die Bench (nie real gekauft/angerufen - Provider-
// Credentials bleiben leer, VOICE_ENGINE=budget, kein /api/calls -> physisch kein Dial).
const BENCH_TELNYX_OWNER = Object.freeze({ e164: "+13125557000", provider: "telnyx" });
// Fail-closed-Signatur-Header (Spec: SKIP_TWILIO_SIGNATURE_CHECK umgeht nur die
// KRYPTO-Pruefung, NICHT providerFromHeaders - dessen Header-Praesenz entscheidet, ob
// server.js /voice/incoming als Telnyx oder Twilio rendert). Werte sind Dummies wie in
// test/telnyx-signature.test.js (kein echter Ed25519-Beweis noetig, da die
// Krypto-Pruefung selbst uebersprungen wird).
const TELNYX_DUMMY_HEADERS = Object.freeze({
  "telnyx-signature-ed25519": "bench-dummy",
  "telnyx-timestamp": "0",
});

const SUMMARY_POLL_TIMEOUT_MS = 20000;
const SUMMARY_POLL_INTERVAL_MS = 150;

// Preise pro 1M Tokens in USD (Spec §8, claude-api-Referenz 2026-06-24): Haiku 4.5
// $1/$5, Sonnet-5 Intro-Preis $2/$10 bis 2026-08-31 (danach reguraer $3/$15). Rein
// informativer Kosten-Schaetzwert im Report, kein Budget-Gate.
const PRICE_TABLE = Object.freeze({
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-sonnet-5": { in: 2.0, out: 10.0 },
});

function gitRev() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function buildEnv({ apiKey, scenario }) {
  return {
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_MODEL: PRODUCTION_CLAUDE_MODEL,
    METRICS_ENABLED: "true",
    ASSISTANT_CONTEXT_ENABLED: scenario.assistantContextEnabled ? "true" : "false",
    MAX_BUDGET_EUR: BENCH_MAX_BUDGET_EUR,
    VOICE_ENGINE: "budget",
  };
}

function buildCallSeed(scenario, provider) {
  return seedCall({
    id: `${BENCH_CALL_ID_PREFIX}_${scenario.id}`,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider,
    direction: "outbound",
    goal: scenario.goal,
    briefing: scenario.briefing,
    constraints: scenario.constraints,
    context: scenario.context,
    language: "de",
    status: "active",
  });
}

function recordAgentSay(transcript, parsed) {
  if (!parsed.sayTexts.length) return;
  transcript.push({ role: "agent", text: parsed.sayTexts.join(" ") });
}

function extractCallIdFromUrl(url) {
  return new URL(url).searchParams.get("callId");
}

// Erster Request der Choreografie (Spec §3-2): outbound -> /voice/outbound, inbound
// -> /voice/incoming (To=aktive Owner-Nummer, From=Anrufer). Fuer Telnyx werden die
// Dummy-Signatur-Header gesetzt, damit providerFromHeaders() korrekt telnyx erkennt
// (SKIP_TWILIO_SIGNATURE_CHECK umgeht nur die Krypto-Pruefung selbst).
async function runFirstTurn({ srv, scenario, call, provider, activeOwnerNumber, transcript, texmlSamples }) {
  const isInbound = scenario.direction === "inbound";
  const res = isInbound
    ? await fetch(`${srv.localUrl}/voice/incoming`, {
        method: "POST",
        headers: provider === "telnyx" ? TELNYX_DUMMY_HEADERS : {},
        body: new URLSearchParams({
          To: activeOwnerNumber.e164,
          From: scenario.callerNumber || BENCH_DEFAULT_CALLER,
          CallSid: CALL_SID,
        }),
      })
    : await fetch(`${srv.localUrl}/voice/outbound?callId=${call.id}`, {
        method: "POST",
        body: new URLSearchParams({ CallSid: CALL_SID }),
      });
  const body = await res.text();
  const parsed = parseVoiceBody(body, srv.localUrl);
  texmlSamples.push({ turn: 0, ...parsed });
  recordAgentSay(transcript, parsed);
  return parsed;
}

// Beendet den Call ueber die echte /voice/status-Webhook-Route (reiner Status-
// Renderer, KEIN originateCall - Spec §6) und wartet best-effort, bis summarizeCall
// (async, nicht awaited im Handler) die Summary persistiert hat. Timeout -> Report
// zeigt summary=null statt die Bench abstuerzen zu lassen.
async function finalizeCall(srv, callId) {
  await fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams({ CallStatus: "completed" }),
  }).catch(() => {});
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
  const price = PRICE_TABLE[model] || PRICE_TABLE[PRODUCTION_CLAUDE_MODEL];
  return (usage.input_tokens / 1e6) * price.in + (usage.output_tokens / 1e6) * price.out;
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

function estimateCost({ agentUsageBucket, personaUsages, personaModel, judgeUsage, judgeModel }) {
  const agentUsd = usdCost(PRODUCTION_CLAUDE_MODEL, {
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

// Faehrt EIN (Szenario, Repeat) end-to-end und liefert den vollstaendigen Report
// (Spec §5-iii-Schema). maxTurnsCap ist die verbindliche, globale Kosten-Bremse (CLI
// --max-turns); scenario.maxTurns ist NUR der Check-Schwellwert (turn_count_within_
// budget) - beide Werte sind bewusst getrennt (ein Szenario darf ueber sein eigenes
// Budget hinauslaufen bis zum globalen Cap, der Check schlaegt dann informativ fehl).
export async function runScenarioRepeat({
  scenario,
  repeatIndex,
  label,
  personaModel,
  judgeModel,
  maxTurnsCap,
  provider,
  apiKey,
}) {
  const startedAt = new Date().toISOString();
  const isInbound = scenario.direction === "inbound";
  const activeOwnerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : OWNER_TEST_NUMBER;
  const ownerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : undefined;
  const call = isInbound ? null : buildCallSeed(scenario, provider);
  const env = buildEnv({ apiKey, scenario });
  const seed = isInbound ? seedState({}) : seedState({ calls: [call] });

  const srv = await startServer({ env, seed, ownerNumber });
  const transcript = [];
  const texmlSamples = [];
  const personaUsages = [];
  let endedVia = null;
  let personaError = null;
  let callId = call?.id ?? null;

  try {
    let parsed = await runFirstTurn({ srv, scenario, call, provider, activeOwnerNumber, transcript, texmlSamples });
    if (isInbound) {
      if (!parsed.nextTurnUrl) throw new Error("Inbound-Erst-Turn lieferte kein Gather (unbekannte Nummer?)");
      callId = extractCallIdFromUrl(parsed.nextTurnUrl);
    }

    let calleeTurnIndex = 0;
    for (;;) {
      if (parsed.hasHangup) {
        endedVia = "agent_hangup";
        break;
      }
      if (texmlSamples.length >= maxTurnsCap) {
        endedVia = "turn_cap";
        break;
      }
      if (!parsed.nextTurnUrl) {
        endedVia = "no_gather";
        break;
      }
      // Persona-Call gegen echtes Netz (Anthropic-API) - genau wie beim Judge (weiter
      // unten) darf ein Fehler (Auth/Rate-Limit/Netz) NICHT den ganzen Lauf crashen,
      // sondern muss einen Report mit dem bisherigen Transkript + Befund liefern
      // (Spec: Bench misst auch, WO ein Gespraech real scheitert).
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
      transcript.push({ role: "caller", text: callee.text });

      const turnRes = await fetch(parsed.nextTurnUrl, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: callee.text }),
      });
      calleeTurnIndex += 1;
      parsed = parseVoiceBody(await turnRes.text(), srv.localUrl);
      texmlSamples.push({ turn: texmlSamples.length, ...parsed });
      recordAgentSay(transcript, parsed);
    }

    const metricsParsed = parseMetricsLog(srv.stdout);
    if (callId) await finalizeCall(srv, callId);
    const store = srv.readStore();
    const storeSnapshot = extractStoreSnapshot(store, BOOTSTRAP_TENANT_ID, callId);
    const agentUsageBucket = store.usage?.[BOOTSTRAP_TENANT_ID];

    const runResult = {
      call: call || { direction: "inbound", language: "de" },
      ownerName: `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`,
      transcript,
      texmlSamples,
      endedVia,
      turnCount: texmlSamples.length,
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

    const cost = estimateCost({ agentUsageBucket, personaUsages, personaModel, judgeUsage: judge?.usage, judgeModel });

    return {
      meta: {
        scenario: scenario.id,
        repeat_index: repeatIndex,
        label,
        started_at: startedAt,
        agent_model: PRODUCTION_CLAUDE_MODEL,
        persona_model: personaModel,
        judge_model: judgeModel,
        provider,
        git_rev: gitRev(),
      },
      transcript,
      texml_samples: texmlSamples,
      metrics: summarizeMetrics(metricsParsed),
      store_snapshot: {
        summary: storeSnapshot.summary,
        objective_achieved: storeSnapshot.objectiveAchieved,
        action_items: storeSnapshot.actionItems,
        calendar_new_events: storeSnapshot.calendarNewEvents,
      },
      checks,
      judge,
      cost_estimate_usd: cost,
      turn_count: texmlSamples.length,
      ended_via: endedVia,
      // Nur gesetzt, wenn ended_via==="persona_error" (Netz-/Auth-Fehler auf dem
      // Persona-Call) - err.message der Anthropic-SDK-Fehlerklassen enthaelt NIE den
      // Key selbst (nur HTTP-Status + API-Fehlertyp/-message).
      persona_error: personaError,
    };
  } finally {
    await srv.stop();
  }
}
