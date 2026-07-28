// Kern-Orchestrierung der Conversation-Bench (tasks/convo-bench-spec.md §3): treibt
// EIN (Szenario, Repeat) end-to-end. Server-Start ueber test/helpers.js (Praezedenz:
// scripts/smoke-stripe-payment.mjs importiert dieselbe Datei) - direkter Store-Seed
// via seedState/seedCall, NIEMALS POST /api/calls (einzige Route mit originateCall,
// Spec §6 Sicherheitsargument). ANTHROPIC_API_KEY erreicht diese Datei nur als
// Funktionsargument, nie geloggt.
//
// AL-P8: die TRANSPORTSCHICHT (wie der gespawnte Server angesprochen wird) sitzt hinter
// dem Treiber-Port (drivers.mjs) - dieser Runner kennt nur noch turn.sayTexts/endedVia,
// nicht mehr TeXML-Interna. Env/Seed/Persona-Schleife/Metrics/Snapshot/Checks/Judge/
// Kosten/Report-Bau bleiben hier (S2: EIN Runner statt Duplizierung je Treiber).
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
import { DRIVERS } from "./drivers.mjs";
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
const BENCH_CALL_ID_PREFIX = "call_bench";
// Dummy-Telnyx-Owner-Nummer NUR fuer die Bench (nie real gekauft/angerufen - Provider-
// Credentials bleiben leer, VOICE_ENGINE=budget, kein /api/calls -> physisch kein Dial).
const BENCH_TELNYX_OWNER = Object.freeze({ e164: "+13125557000", provider: "telnyx" });

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

function buildEnv({ apiKey, scenario, driverEnv }) {
  return {
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_MODEL: PRODUCTION_CLAUDE_MODEL,
    METRICS_ENABLED: "true",
    ASSISTANT_CONTEXT_ENABLED: scenario.assistantContextEnabled ? "true" : "false",
    MAX_BUDGET_EUR: BENCH_MAX_BUDGET_EUR,
    VOICE_ENGINE: "budget",
    ...driverEnv,
  };
}

// F1: Objekt statt drittem losem Argument - extra (treiber-eigene Seed-Felder, z.B.
// callControlId/assistantId des Shim-Treibers) geht ans Ende von seedCall durch.
function buildCallSeed({ scenario, provider, extra }) {
  return seedCall({
    id: `${BENCH_CALL_ID_PREFIX}_${scenario.id}`,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider,
    direction: "outbound",
    goal: scenario.goal,
    briefing: scenario.briefing,
    constraints: scenario.constraints,
    context: scenario.context,
    mandate: scenario.mandate, // P6: undefined bei Bestands-Szenarien -> Sektion ""
    language: "de",
    status: "active",
    ...extra,
  });
}

// P4: ein stiller Callee-Turn geht als LEERES SpeechResult raus; im Transkript steht
// dafuer dieser Marker - Persona-Spiegelung und Judge duerfen keinen leeren Text-Block
// sehen (die Anthropic-API lehnt ihn ab), und "der Angerufene sagt nichts" ist fuer den
// Judge eine echte, bewertbare Information.
const SILENT_TURN_TRANSCRIPT_TEXT = "[Schweigen - der Angerufene sagt nichts]";

function calleeTranscriptText(callee) {
  return callee.silent ? SILENT_TURN_TRANSCRIPT_TEXT : callee.text;
}

// G5: das Sample-Push (agent_samples-Report-Feld) UND der Transkript-Append gehoerten
// immer zusammen (frueher an drei Stellen dupliziert: Erst-Turn, Schleife, beide
// Aufrufer) - EIN Aufruf traegt beides.
function pushSample(agentSamples, transcript, turn) {
  agentSamples.push({ turn: agentSamples.length, sayTexts: turn.sayTexts });
  if (turn.sayTexts.length) transcript.push({ role: "agent", text: turn.sayTexts.join(" ") });
}

// Wartet best-effort, bis summarizeCall (async, nicht awaited im Handler) die Summary
// persistiert hat. Timeout -> Report zeigt summary=null statt die Bench abstuerzen zu
// lassen. Reines Store-Polling - der terminale Provider-Webhook (Settlement) gehoert
// seit AL-P8 dem Treiber (transport.finish), nicht mehr diesem Runner.
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
  driverId,
  apiKey,
}) {
  const startedAt = new Date().toISOString();
  const isInbound = scenario.direction === "inbound";
  const activeOwnerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : OWNER_TEST_NUMBER;
  const ownerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : undefined;

  // Der Treiber-Transport lebt VOR startServer (ein evtl. lokaler Provider-Fake muss
  // laufen, bevor der Server-Env darauf zeigt) und wird im aeusseren finally NACH
  // srv.stop() geschlossen.
  const transport = await DRIVERS[driverId].create({ scenario, provider });
  const call = isInbound ? null : buildCallSeed({ scenario, provider, extra: transport.seedOverrides });
  const env = buildEnv({ apiKey, scenario, driverEnv: transport.env });
  const seed = isInbound ? seedState({}) : seedState({ calls: [call] });

  const transcript = [];
  const agentSamples = [];
  const personaUsages = [];
  let endedVia = null;
  let personaError = null;
  let callId = call?.id ?? null;
  let srv;

  try {
    srv = await startServer({ env, seed, ownerNumber });
    const opened = await transport.open({ srv, scenario, call, activeOwnerNumber });
    callId = opened.callId;
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
      transcript.push({ role: "caller", text: calleeTranscriptText(callee) });

      turn = await transport.say(callee.text);
      calleeTurnIndex += 1;
      pushSample(agentSamples, transcript, turn);
    }

    const metricsParsed = parseMetricsLog(srv.stdout);
    if (callId) {
      await transport.finish(callId); // terminaler Provider-Webhook (Settlement)
      await waitForSummary(srv, callId); // best-effort, Timeout -> summary=null (Bestand)
    }
    const store = srv.readStore();
    const storeSnapshot = extractStoreSnapshot(store, BOOTSTRAP_TENANT_ID, callId);
    const agentUsageBucket = store.usage?.[BOOTSTRAP_TENANT_ID];

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
        driver: driverId,
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
      },
      checks,
      judge,
      cost_estimate_usd: cost,
      turn_count: agentSamples.length,
      ended_via: endedVia,
      // Nur gesetzt, wenn ended_via==="persona_error" (Netz-/Auth-Fehler auf dem
      // Persona-Call) - err.message der Anthropic-SDK-Fehlerklassen enthaelt NIE den
      // Key selbst (nur HTTP-Status + API-Fehlertyp/-message).
      persona_error: personaError,
      shim_gates: transport.diagnostics().shim_gate_reasons ?? [],
    };
  } finally {
    if (srv) await srv.stop();
    await transport.close();
  }
}
