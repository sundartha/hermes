#!/usr/bin/env node
// Conversation-Bench CLI-Entry (tasks/convo-bench-spec.md). Reine Orchestrierung:
// Argumente parsen, Szenarien laden, pro (Szenario,Repeat) den Runner aufrufen,
// Reports schreiben, Exit-Code aus den deterministischen Checks ableiten.
//
// NIEMALS Teil von `npm test` (braucht Netz + echten ANTHROPIC_API_KEY, Spec §0).
// Aufruf: node scripts/convo-bench.mjs run --scenario <id>|--all [--repeat 3]
//         [--label ...] [--persona-model ...] [--judge-model ...] [--max-turns 10]
//         [--provider telnyx|twilio] [--out data/convo-bench/<run-id>]
//         node scripts/convo-bench.mjs compare <reportDirA> <reportDirB>
import path from "path";
import { fileURLToPath } from "url";
import { SCENARIOS, SCENARIO_IDS } from "./convo-bench/scenarios/index.mjs";
import { runScenarioRepeat } from "./convo-bench/runner.mjs";
import { PERSONA_MODEL_DEFAULT } from "./convo-bench/persona.mjs";
import { JUDGE_MODEL_DEFAULT } from "./convo-bench/judge.mjs";
import { writeReport, writeSummary, printSummaryTable, printCompareTable, readReportDir } from "./convo-bench/report.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Kosten-Bremse (Spec §Risiken: "MAX_TURNS-Kappe verbindlich") - globaler, harter Cap
// ueber ALLE Szenarien; scenario.maxTurns (checks.mjs) ist davon unabhaengig der
// Check-Schwellwert. Default aus der Spec-CLI-Beispielzeile.
const DEFAULT_MAX_TURNS_CAP = 10;
const DEFAULT_REPEAT = 3;
// Default-Provider = Live-Provider (Spec §3-1).
const DEFAULT_PROVIDER = "telnyx";
const DEFAULT_LABEL = "default";

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

function resolveScenarioIds(args) {
  if (args.all) return SCENARIO_IDS;
  if (args.scenario) {
    if (!SCENARIOS[args.scenario]) {
      throw new Error(`Unbekanntes Szenario "${args.scenario}" (verfuegbar: ${SCENARIO_IDS.join(", ")})`);
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

// ANTHROPIC_API_KEY nur aus process.env, NIE geloggt (auch nicht in Fehlerpfaden) -
// Regel 4 (CLAUDE.md) + Spec §0/§6.
function requireApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[convo-bench] ANTHROPIC_API_KEY fehlt in process.env. Abbruch.");
    process.exit(1);
  }
  return apiKey;
}

async function runCommand(args) {
  const apiKey = requireApiKey();
  const scenarioIds = resolveScenarioIds(args);
  const repeat = Number(args.repeat) || DEFAULT_REPEAT;
  const label = typeof args.label === "string" ? args.label : DEFAULT_LABEL;
  const personaModel = typeof args["persona-model"] === "string" ? args["persona-model"] : PERSONA_MODEL_DEFAULT;
  const judgeModel = typeof args["judge-model"] === "string" ? args["judge-model"] : JUDGE_MODEL_DEFAULT;
  const maxTurnsCap = Number(args["max-turns"]) || DEFAULT_MAX_TURNS_CAP;
  const provider = typeof args.provider === "string" ? args.provider : DEFAULT_PROVIDER;
  const outDir = resolveOutDir(args);

  console.log(
    `[convo-bench] Lauf: scenarios=${scenarioIds.join(",")} repeat=${repeat} provider=${provider} ` +
      `persona=${personaModel} judge=${judgeModel} max-turns=${maxTurnsCap} out=${outDir}`,
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
        apiKey,
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

  // Exit-Code 0 NUR wenn ALLE deterministischen Checks aller Szenarien/Repeats
  // bestehen (Spec §2/§5-i). Judge-Scores sind informativ, kein Hard-Gate.
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
  // Fehlerpfad: NIE den Key loggen (Regel 4) - nur err.message.
  console.error(`[convo-bench] Fehler: ${err.message}`);
  process.exit(1);
});
