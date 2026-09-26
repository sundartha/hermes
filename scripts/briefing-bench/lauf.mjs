#!/usr/bin/env node
// Kommandozeile des briefing-bench (Bedienung: README.md daneben).
//   snapshot  --repo <checkout> --out <datei> [--env KEY=VALUE ...]
//   run       --tools <schnappschuss> --out <bericht> [--modus attrappe|anthropic]
//             [--modell <id>] [--laeufe 5] [--einschleusen selbstnennung|erfindung|verweigerung]
//   vergleich --alt <bericht> --neu <bericht>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { snapshotTools, runBench } from "./bench.mjs";
import { compareReports } from "./metriken.mjs";
import { anthropicModel, dummyModel } from "./modelle.mjs";
import { config } from "../../src/config.js";

const DEFAULT_RUNS = "5";
const MODE_DUMMY = "attrappe";
const MODE_ANTHROPIC = "anthropic";
const EXIT_NOT_MET = 2;
const JSON_INDENT = 2;

const OPTIONS = {
  repo: { type: "string" },
  out: { type: "string" },
  env: { type: "string", multiple: true, default: [] },
  tools: { type: "string" },
  modus: { type: "string", default: MODE_DUMMY },
  modell: { type: "string" },
  laeufe: { type: "string", default: DEFAULT_RUNS },
  einschleusen: { type: "string" },
  alt: { type: "string" },
  neu: { type: "string" },
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  writeFileSync(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`);

function envPairs(pairs) {
  return Object.fromEntries(
    pairs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
  );
}

function modelFor(values) {
  if (values.modus === MODE_DUMMY) return dummyModel({ injection: values.einschleusen || null });
  if (values.modus === MODE_ANTHROPIC) {
    return anthropicModel({ model: values.modell, apiKey: config.llm.anthropicApiKey });
  }
  throw new Error(`Unbekannter Modus: ${values.modus}`);
}

async function snapshotCommand(values) {
  const snapshot = await snapshotTools(path.resolve(values.repo), envPairs(values.env));
  writeJson(values.out, snapshot);
  console.log(`[briefing-bench] ${snapshot.tools.length} Werkzeuge -> ${values.out}`);
}

async function runCommand(values) {
  const runs = Number(values.laeufe);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error(`--laeufe muss eine positive ganze Zahl sein: ${values.laeufe}`);
  const report = await runBench({
    snapshot: readJson(values.tools),
    model: modelFor(values),
    runs,
  });
  writeJson(values.out, report);
  console.log(
    `[briefing-bench] ${report.modell}, ${runs} Laeufe je Szenario: ${JSON.stringify(report.summe)}`,
  );
}

function compareCommand(values) {
  const result = compareReports(readJson(values.alt), readJson(values.neu));
  console.log(JSON.stringify(result, null, JSON_INDENT));
  if (!result.erfuellt) process.exitCode = EXIT_NOT_MET;
}

const COMMANDS = { snapshot: snapshotCommand, run: runCommand, vergleich: compareCommand };

const { positionals, values } = parseArgs({ options: OPTIONS, allowPositionals: true });
const command = COMMANDS[positionals[0]];
if (command) {
  await command(values);
} else {
  console.error("Aufruf: lauf.mjs snapshot|run|vergleich ... (s. README.md)");
  process.exitCode = 1;
}
