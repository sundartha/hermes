#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { SCENARIOS, SCENARIO_IDS } from "./convo-bench/scenarios/index.mjs";
import { DRIVERS, DRIVER_IDS, DEFAULT_DRIVER_ID, scenarioSupportsDriver } from "./convo-bench/drivers.mjs";
import { runScenarioRepeat, DEFAULT_AGENT_MODEL, DEFAULT_LLM_PROVIDER_FOR_BENCH } from "./convo-bench/runner.mjs";
import { PERSONA_MODEL_DEFAULT } from "./convo-bench/persona.mjs";
import { JUDGE_MODEL_DEFAULT } from "./convo-bench/judge.mjs";
import { writeReport, writeSummary, printSummaryTable, printCompareTable, readReportDir } from "./convo-bench/report.mjs";
import { LLM_PROVIDER, LLM_PROVIDER_VALUES } from "../src/llm/provider.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MAX_TURNS_CAP = 10;
const DEFAULT_REPEAT = 3;
const DEFAULT_PROVIDER = "telnyx";
const DEFAULT_LABEL = "default";
const AGENT_MODEL_DEFAULT_FOR_LLM_PROVIDER = Object.freeze({
  [LLM_PROVIDER.ANTHROPIC]: DEFAULT_AGENT_MODEL,
  [LLM_PROVIDER.DEEPSEEK]: "deepseek-v4-pro",
});

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function resolveDriverId(args, provider) {
  const id = typeof args.driver === "string" ? args.driver : DEFAULT_DRIVER_ID;
  const driver = DRIVERS[id];
  if (!driver) throw new Error(`Unbekannter Treiber "${id}" (verfuegbar: ${DRIVER_IDS.join(", ")})`);
  if (driver.requiresProvider && provider !== driver.requiresProvider) {
    throw new Error(`Treiber "${id}" laeuft nur mit --provider ${driver.requiresProvider} (aktuell: ${provider})`);
  }
  return id;
}

function resolveScenarioIds(args, driverId) {
  if (args.all) {
    return SCENARIO_IDS.filter((id) => {
      const supported = scenarioSupportsDriver(SCENARIOS[id], driverId);
      if (!supported) console.log(`[convo-bench] uebersprungen: ${id} (nur Treiber ${SCENARIOS[id].drivers.join(",")})`);
      return supported;
    });
  }
  if (args.scenario) {
    const scenario = SCENARIOS[args.scenario];
    if (!scenario) {
      throw new Error(`Unbekanntes Szenario "${args.scenario}" (verfuegbar: ${SCENARIO_IDS.join(", ")})`);
    }
    if (!scenarioSupportsDriver(scenario, driverId)) {
      throw new Error(`Szenario "${args.scenario}" laeuft nur mit Treiber ${scenario.drivers.join(",")} (aktuell: ${driverId})`);
    }
    return [args.scenario];
  }
  throw new Error("Bitte --scenario <id> oder --all angeben.");
}

function resolveOutDir(args) {
  if (args.out) return path.resolve(ROOT, args.out);
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  return path.join(ROOT, "data", "convo-bench", runId);
}

function requireApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[convo-bench] ANTHROPIC_API_KEY fehlt in process.env. Abbruch.");
    process.exit(1);
  }
  return apiKey;
}

function resolveLlmProvider(args) {
  const value = typeof args["llm-provider"] === "string" ? args["llm-provider"] : DEFAULT_LLM_PROVIDER_FOR_BENCH;
  if (!LLM_PROVIDER_VALUES.includes(value))
    throw new Error(`Unbekannter --llm-provider "${value}" (verfuegbar: ${LLM_PROVIDER_VALUES.join(", ")})`);
  return value;
}

function requireDeepseekKeyIfNeeded(llmProvider) {
  if (llmProvider !== LLM_PROVIDER.DEEPSEEK) return "";
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    console.error("[convo-bench] DEEPSEEK_API_KEY fehlt in process.env (noetig fuer --llm-provider deepseek). Abbruch.");
    process.exit(1);
  }
  return key;
}

async function runCommand(args) {
  const provider = typeof args.provider === "string" ? args.provider : DEFAULT_PROVIDER;
  const driverId = resolveDriverId(args, provider);
  const scenarioIds = resolveScenarioIds(args, driverId);
  const llmProvider = resolveLlmProvider(args);
  const apiKey = requireApiKey();
  const deepseekApiKey = requireDeepseekKeyIfNeeded(llmProvider);
  const repeat = Number(args.repeat) || DEFAULT_REPEAT;
  const label = typeof args.label === "string" ? args.label : DEFAULT_LABEL;
  const personaModel = typeof args["persona-model"] === "string" ? args["persona-model"] : PERSONA_MODEL_DEFAULT;
  const judgeModel = typeof args["judge-model"] === "string" ? args["judge-model"] : JUDGE_MODEL_DEFAULT;
  const agentModel =
    typeof args["agent-model"] === "string" ? args["agent-model"] : AGENT_MODEL_DEFAULT_FOR_LLM_PROVIDER[llmProvider];
  const maxTurnsCap = Number(args["max-turns"]) || DEFAULT_MAX_TURNS_CAP;
  const outDir = resolveOutDir(args);

  console.log(
    `[convo-bench] Lauf: scenarios=${scenarioIds.join(",")} repeat=${repeat} provider=${provider} driver=${driverId} ` +
      `llm-provider=${llmProvider} agent-model=${agentModel} persona=${personaModel} judge=${judgeModel} ` +
      `max-turns=${maxTurnsCap} out=${outDir}`,
  );

  const results = [];
  for (const scenarioId of scenarioIds) {
    const scenario = SCENARIOS[scenarioId];
    for (let r = 0; r < repeat; r++) {
      console.log(`[convo-bench] ${scenarioId} repeat ${r + 1}/${repeat} laeuft...`);
      const result = await runScenarioRepeat({
        scenario,
        repeatIndex: r,
        label,
        personaModel,
        judgeModel,
        maxTurnsCap,
        provider,
        driverId,
        apiKey,
        llmProvider,
        agentModel,
        deepseekApiKey,
      });
      const file = writeReport(outDir, result);
      results.push(result);
      const passed = result.checks.filter((c) => c.pass).length;
      console.log(
        `[convo-bench] ${scenarioId} r${r} -> ended_via=${result.ended_via} turns=${result.turn_count} ` +
          `checks=${passed}/${result.checks.length} report=${file}`,
      );
    }
  }

  writeSummary(outDir, results);
  printSummaryTable(results);

  const allChecksPass = results.every((r) => r.checks.every((c) => c.pass));
  process.exit(allChecksPass ? 0 : 1);
}

async function compareCommand(args) {
  const [dirA, dirB] = args._;
  if (!dirA || !dirB) throw new Error("compare braucht zwei Report-Verzeichnisse: compare <dirA> <dirB>");
  const reportsA = readReportDir(path.resolve(process.cwd(), dirA));
  const reportsB = readReportDir(path.resolve(process.cwd(), dirB));
  printCompareTable(reportsA, reportsB);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === "run") return runCommand(args);
  if (command === "compare") return compareCommand({ _: args._.slice(1) });
  console.error("Nutzung: node scripts/convo-bench.mjs run|compare ...");
  process.exit(1);
}

main().catch((err) => {
  console.error(`[convo-bench] Fehler: ${err.message}`);
  process.exit(1);
});
