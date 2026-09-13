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
import { LLM_PROVIDER } from "../../src/llm/provider.js";
import { DRIVERS } from "./drivers.mjs";
import { nextCalleeTurn } from "./persona.mjs";
import { judgeConversation } from "./judge.mjs";
import { runChecks } from "./checks.mjs";
import { parseMetricsLog } from "./metrics-parse.mjs";
import { startExaFake } from "./exa-fake.mjs";
import { startConsultPump } from "./consult-pump.mjs";

// Vorgabewert (Spec §0: "Kein Wechsel von claude-haiku-4-5 ... im Produktions-Pfad")
// - byte-identisch zu config.js' eigenem CLAUDE_MODEL-Default. AL-P0 (Werkzeugwahl):
// vorher war das eine harte Konstante, die JEDEN Lauf auf Anthropic Haiku pinnte,
// unabhaengig von Shell/.env/CLI - jede DeepSeek-Messung war strukturell eine
// Anthropic-Messung (tasks/befund-toolwahl-5-bench.md). Jetzt nur noch der Fallback,
// wenn --agent-model/--llm-provider nicht gesetzt sind (Bestandslaeufe bleiben
// byte-identisch).
export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5";
export const DEFAULT_LLM_PROVIDER_FOR_BENCH = LLM_PROVIDER.ANTHROPIC;
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
  // AL-P0: Rate identisch zu src/config.js MODEL_PRICE_SCHEDULES["deepseek-v4-pro"]
  // (in/out, ohne Cache-Raten - dieselbe bewusste Vereinfachung wie die zwei
  // Anthropic-Zeilen oben). Rein informativer Bench-Schaetzwert, kein Budget-Gate.
  "deepseek-v4-pro": { in: 0.435, out: 0.87 },
});

function gitRev() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// AL-D3: szenario-eigene Env als generischer Durchreicher. Bis hierher praegte NUR
// assistantContextEnabled die Env - Faehigkeiten, die an einem Flag haengen (look_up,
// get_consult), waren im Bench damit strukturell abwesend, unabhaengig vom Szenario.
// REICHWEITE: dieses Objekt erreicht AUSSCHLIESSLICH den gespawnten Kindprozess. Weder
// BASE_ENV (test/helpers.js) noch .env noch render.yaml werden angefasst - test/al-d3-*
// pinnt das.
// PRAEZEDENZ, bewusst: scenario.env < driverEnv (der Treiber besitzt seinen Transport) <
// searchEnv (der Runner besitzt die Adresse des selbst gestarteten Fakes).
//
// AL-P0 (Werkzeugwahl): llmProvider/agentModel/deepseekApiKey sind jetzt STEUERBARE
// Werte statt hart gepinnter Konstanten (Namen mirror die config.js-Env-Variablen
// LLM_PROVIDER/CLAUDE_MODEL/DEEPSEEK_API_KEY) - ohne das lief JEDER Bench-Lauf
// strukturell gegen Anthropic Haiku, egal was Shell/CLI verlangten
// (tasks/befund-toolwahl-5-bench.md). ANTHROPIC_API_KEY bleibt UNBEDINGT gesetzt (Persona/
// Judge/assertConfig brauchen ihn immer, auch bei llmProvider=deepseek, s. config.js
// assertConfig-Kommentar "ANTHROPIC_API_KEY bleibt bewusst UNBEDINGT Pflicht").
export function buildEnv({ apiKey, deepseekApiKey, llmProvider, agentModel, scenario, driverEnv, searchEnv }) {
  return {
    ANTHROPIC_API_KEY: apiKey,
    LLM_PROVIDER: llmProvider,
    DEEPSEEK_API_KEY: deepseekApiKey || "",
    CLAUDE_MODEL: agentModel,
    METRICS_ENABLED: "true",
    ASSISTANT_CONTEXT_ENABLED: scenario.assistantContextEnabled ? "true" : "false",
    MAX_BUDGET_EUR: BENCH_MAX_BUDGET_EUR,
    VOICE_ENGINE: "budget",
    ...(scenario.env ?? {}),
    ...driverEnv,
    ...searchEnv,
  };
}

// AL-D3: default-Treffer fuer ein Szenario mit fakeSearch:true ohne eigene
// searchFacts-Angabe - haelt startExaFake({facts}) auch ohne Szenario-Deklaration lauffaehig.
const DEFAULT_SEARCH_FACTS = Object.freeze([{ title: "Bench-Treffer", highlight: "Bench-Auszug" }]);

// F1: Objekt statt drittem losem Argument - extra (treiber-eigene Seed-Felder) geht ans
// Ende von seedCall durch.
// AL-P0: tenantId kommt jetzt vom Aufrufer (Default BOOTSTRAP_TENANT_ID, s.
// runScenarioRepeat) statt hart im Objekt zu stehen - Voraussetzung fuer
// scenario.tenantId/scenario.profile (s. benchTenantsFor/assertProfileTenantIsSettable).
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
    mandate: scenario.mandate, // P6: undefined bei Bestands-Szenarien -> Sektion ""
    language: "de",
    status: "active",
    ...extra,
  });
}

// AL-P0 (Werkzeugwahl, tasks/befund-toolwahl-2-angebot.md): ein Szenario mit eigenem
// tenantId braucht eine minimale Tenant-Identitaet, sonst faellt disclosureSentence()
// auf ownerName="" zurueck (tenantContext ohne Tenant-Record, P2b) - kein Absturz, aber
// ein kaputter Offenlegungssatz. Der Owner-Tenant bleibt unberuehrt (ensureOwnerNumber
// pflegt ihn bereits selbst, test/helpers.js) - deshalb null fuer BOOTSTRAP_TENANT_ID,
// damit seedState() keinen tenants-Key bekommt (byte-identischer Seed zum Bestand).
export function benchTenantsFor(tenantId) {
  if (tenantId === BOOTSTRAP_TENANT_ID) return null;
  return [{ id: tenantId, status: "active", ownerName: `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}` }];
}

// AL-P0: resolveProfileFrom pinnt BOOTSTRAP_TENANT_ID hart auf OWNER_PROFILE (R2,
// src/store/defaults.js) und liest ein gespeichertes Profil dort NIE - ein
// scenario.profile ohne abweichendes scenario.tenantId waere also totes Verhalten
// (G2, stiller No-op). Failt laut und VOR dem ersten Server-Spawn statt eine
// Rechte-Messung zu liefern, die in Wahrheit nichts gemessen hat.
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

// AL-P12: Vor-Anrufe desselben Ziels + optionale Tenant-Settings. Ohne beides ist der
// Seed byte-identisch zum Bestand (scenario.priorCalls/settings sind undefined).
// AL-P0: scenario.profile seedet s.profiles[tenantId] (Tenant-Rechte wie allowLookup/
// allowConsult, tasks/befund-toolwahl-2-angebot.md); benchTenantsFor traegt die dafuer
// noetige Tenant-Identitaet nach. Beides bleibt weg (kein Key im seedState-Aufruf), wenn
// tenantId der Owner ist - Bestandslaeufe bleiben byte-identisch.
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
    // AL-P11: die strukturierte Ergebnis-Karte fuer den result_slots_present-Check.
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

// AL-P0: agentModel kommt vom Aufrufer (das TATSAECHLICH an CLAUDE_MODEL gesendete
// env.CLAUDE_MODEL, s. runScenarioRepeat) statt der frueheren Konstante - sonst
// bepreist ein DeepSeek-Lauf sich weiter mit Haiku-Raten (falsch etikettiert, genau
// die Fehlerklasse, die diese Phase beheben soll).
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
  // AL-P0: Default = Live-Default (Anthropic/Haiku, Spec §0) - ein Aufrufer, der die
  // drei neuen Felder weglaesst (heute nur convo-bench.mjs), erhaelt den byte-
  // identischen Bestandslauf.
  llmProvider = DEFAULT_LLM_PROVIDER_FOR_BENCH,
  agentModel = DEFAULT_AGENT_MODEL,
  deepseekApiKey,
}) {
  const startedAt = new Date().toISOString();
  const isInbound = scenario.direction === "inbound";
  const activeOwnerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : OWNER_TEST_NUMBER;
  const ownerNumber = provider === "telnyx" ? BENCH_TELNYX_OWNER : undefined;
  // AL-P0: tenantId + Tenant-Rechte (allowLookup/allowConsult) sind jetzt je Szenario
  // setzbar (tasks/befund-toolwahl-2-angebot.md) - Default bleibt der Owner-Tenant
  // (byte-identisch zum Bestand, s. benchTenantsFor/assertProfileTenantIsSettable).
  const tenantId = scenario.tenantId ?? BOOTSTRAP_TENANT_ID;
  assertProfileTenantIsSettable(scenario, tenantId);

  // Der Treiber-Transport lebt VOR startServer (ein evtl. lokaler Provider-Fake muss
  // laufen, bevor der Server-Env darauf zeigt) und wird im aeusseren finally NACH
  // srv.stop() geschlossen. AL-D3: derselbe Grund fuer den Such-Fake - EXA_API_BASE
  // muss stehen, bevor der Server startet.
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
    // AL-D3: die Pumpe startet, sobald die callId feststeht - get_consult braucht einen
    // FRISCHEN Client-Poll (consultClientIsPolling), bevor es ueberhaupt im Werkzeugsatz
    // erscheint. D-4 (Poll-Frische selbst) bleibt unangefasst.
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

    // AL-P0: agentModel kommt aus dem FINAL gemergten env-Objekt (env.CLAUDE_MODEL),
    // nicht aus dem rohen Funktionsargument - so bleibt das Label auch dann korrekt,
    // wenn ein Szenario CLAUDE_MODEL/LLM_PROVIDER selbst ueber scenario.env/driverEnv
    // ueberschreibt (Praezedenz s. buildEnv). Das genau ist der Zweck dieser Phase:
    // eine Zahl darf nie wieder falsch etikettiert sein.
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
        // BEW-1 (PLAN-INBOUND-PARITAET IP2): Richtung des Szenarios direkt an der
        // Zahl, die spaeter isoliert (JSON, Zusammenfassung) gelesen wird - nie mehr
        // stillschweigend als Aussage ueber den anderen Pfad lesbar.
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
      // Nur gesetzt, wenn ended_via==="persona_error" (Netz-/Auth-Fehler auf dem
      // Persona-Call) - err.message der Anthropic-SDK-Fehlerklassen enthaelt NIE den
      // Key selbst (nur HTTP-Status + API-Fehlertyp/-message).
      persona_error: personaError,
    };
  } finally {
    // AL-D3: die Pumpe steht ZUERST (ihr laufender Fetch haengt sonst an einem bereits
    // gestoppten Server), der Such-Fake NACH srv.stop() (Muster Treiber-Transport).
    //
    // Review-Fix Runde 2: consultPump.stop() wirft absichtlich erneut, wenn die Pumpe
    // im Lauf auf einen fatalError lief (z.B. der dokumentierte 401-Fall,
    // consult-pump.mjs:74). Ohne eigenes try/catch riss das die restliche Kette ab -
    // srv.stop()/searchFake.close()/transport.close() liefen nie, der gespawnte
    // Server-Kindprozess und der lokale Exa-Fake blieben offen (Lehre "Verwaiste
    // Testserver"). Der Fehler wird gesammelt und erst NACH allen Cleanups erneut
    // geworfen.
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
