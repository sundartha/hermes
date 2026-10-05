import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";

import { GESTOPPT, MANIFEST_FILE, ROTPROBEN_DIR, runCase } from "../pruefungen-messen.mjs";
import { github } from "./github.mjs";
import { packagesClosed } from "./pakete.mjs";

const STAGING_ADDRESS_VARIABLE = "STAGING_URL";
const HEALTH_PATH = "/healthz";
const HEALTH_TIMEOUT_MS = 10_000;
const HTTP_OK = 200;
const CATALOG_WITHOUT_TEST = "tools/basis/katalog-ohne-test.txt";
const ORDER_TOOL = "tools/auftrag.mjs";
const PHASE_BRANCH = "phase";
const ESLINT_EFFECTIVE_CONFIG = "tools/basis/eslint-wirksam.json";
const ESLINT_SUPPRESSIONS = "eslint-suppressions.json";
const ERROR_SEVERITY = 2;
const COMMENT_RULE = { paket: 31, name: "hermes/keine-kommentare" };
const TEXT_READING_RULE = { paket: 31, name: "hermes/kein-quelltext-als-text" };
const INSTRUCTIONS_FILE = "CLAUDE.md";
const INSTRUCTIONS_MAX_LINES = 100;
const RETIRED_WORKFLOW_DIRECTORY = ".claude/workflows";
const PROOF_BRANCH = "beleg/38-zehn-laeufe";
const PROOF_WORKFLOW_PREFIX = "Beleg";
const PROOF_GREEN_RUNS = 10;
const PER_PAGE = 100;
const SUCCESS = "success";
const LINE_BREAK = "\n";
const WORKFLOW_RULES_PROBES = join(ROTPROBEN_DIR, "workflows");
const SECRET_LIST_CASES = [
  "geheimnis-ausserhalb-der-liste.json",
  "environment-produktion-ausserhalb-der-liste.json",
];
const WORKFLOWS = {
  redProbes: { paket: 20, datei: "rotproben.yml" },
  cleanup: { paket: 30, datei: "aufraeumen.yml" },
  evaluation: { paket: 30, datei: "auswertung.yml" },
  instructions: { paket: 35, datei: "anweisungstexte.yml" },
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function lineCount(path) {
  const text = readFileSync(path, "utf8");
  if (text === "") return 0;
  return text.split(LINE_BREAK).length - (text.endsWith(LINE_BREAK) ? 1 : 0);
}

async function stagingProblems() {
  const address = env[STAGING_ADDRESS_VARIABLE];
  if (!address) return ["die Staging-Adresse nicht hinterlegt ist"];
  try {
    const signal = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
    const response = await fetch(new URL(HEALTH_PATH, address), { redirect: "manual", signal });
    if (response.status === HTTP_OK) return [];
    return [`Staging auf ${HEALTH_PATH} mit HTTP ${response.status} antwortet`];
  } catch (error) {
    return [`Staging auf ${HEALTH_PATH} nicht antwortet (${error.message})`];
  }
}

function catalogProblems() {
  if (!existsSync(CATALOG_WITHOUT_TEST)) return [];
  const lines = readFileSync(CATALOG_WITHOUT_TEST, "utf8").split(LINE_BREAK);
  const entries = lines.filter((line) => line.trim() !== "").length;
  return entries === 0 ? [] : [`${CATALOG_WITHOUT_TEST} noch ${entries} Einträge nennt`];
}

function workflowGreen({ paket, datei }) {
  return async (remote) => {
    const suffix = `/actions/workflows/${datei}/runs?branch=master&status=completed&per_page=1`;
    const answer = await remote.optional(suffix);
    if (answer === undefined) return [`Paket ${paket} fehlt`];
    const [latest] = answer.workflow_runs;
    if (latest === undefined) return [`${datei} auf master noch nicht gelaufen ist`];
    if (latest.conclusion === SUCCESS) return [];
    return [`der letzte Lauf von ${datei} auf master nicht grün ist (${latest.conclusion})`];
  };
}

async function secretListCaseProblems(probe, name) {
  const path = join(WORKFLOW_RULES_PROBES, name);
  if (!existsSync(path)) return [`${path} fehlt`];
  const fall = readJson(path);
  const verdict = await runCase({ root: cwd() }, probe, fall);
  return verdict === GESTOPPT ? [] : [`die Rot-Probe „${fall.titel}“ ${verdict} wurde`];
}

async function secretListProblems() {
  const manifest = join(WORKFLOW_RULES_PROBES, MANIFEST_FILE);
  if (!existsSync(manifest)) return [`${manifest} fehlt`];
  const { probe } = readJson(manifest);
  const verdicts = SECRET_LIST_CASES.map((name) => secretListCaseProblems(probe, name));
  return (await Promise.all(verdicts)).flat();
}

function orderToolProblems() {
  return existsSync(ORDER_TOOL) ? [] : [`${ORDER_TOOL} fehlt`];
}

async function phaseMergeProblems(remote) {
  const query = `repo:${remote.full} is:pr is:merged head:${PHASE_BRANCH}`;
  const { items } = await github(
    `/search/issues?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}`,
  );
  for (const { number } of items) {
    const { head } = await remote.get(`/pulls/${number}`);
    if (head.ref.startsWith(`${PHASE_BRANCH}/`)) return [];
  }
  return [`noch kein PR von einem Branch ${PHASE_BRANCH}/* gemergt ist`];
}

function ruleActive({ name }) {
  if (!existsSync(ESLINT_EFFECTIVE_CONFIG)) return false;
  const folders = Object.values(readJson(ESLINT_EFFECTIVE_CONFIG));
  return folders.some(({ rules }) => rules?.[name]?.[0] === ERROR_SEVERITY);
}

function frozenHits({ name }) {
  const suppressions = existsSync(ESLINT_SUPPRESSIONS) ? readJson(ESLINT_SUPPRESSIONS) : {};
  const counts = Object.values(suppressions)
    .map((rules) => rules[name]?.count ?? 0)
    .filter((count) => count > 0);
  return { files: counts.length, hits: counts.reduce((sum, count) => sum + count, 0) };
}

function commentBaselineProblems() {
  if (!ruleActive(COMMENT_RULE)) return [`Paket ${COMMENT_RULE.paket} fehlt`];
  const { files, hits } = frozenHits(COMMENT_RULE);
  if (hits === 0) return [];
  return [`die Kommentarregel noch ${hits} eingefrorene Treffer in ${files} Dateien hat`];
}

function textReadingProblems() {
  if (!ruleActive(TEXT_READING_RULE)) return [`Paket ${TEXT_READING_RULE.paket} fehlt`];
  const { files } = frozenHits(TEXT_READING_RULE);
  if (files === 0) return [];
  return [`noch ${files} Testdateien Dateien unter src/ oder *.md als Text lesen`];
}

function instructionsProblems() {
  const lines = lineCount(INSTRUCTIONS_FILE);
  if (lines <= INSTRUCTIONS_MAX_LINES) return [];
  return [`${INSTRUCTIONS_FILE} ${lines} Zeilen hat, erlaubt sind ${INSTRUCTIONS_MAX_LINES}`];
}

function retiredWorkflowProblems() {
  const listing = execFileSync("git", ["ls-files", "-z", RETIRED_WORKFLOW_DIRECTORY], {
    encoding: "utf8",
  });
  const files = listing.split("\0").filter(Boolean).length;
  return files === 0 ? [] : [`unter ${RETIRED_WORKFLOW_DIRECTORY}/ noch ${files} Dateien liegen`];
}

async function proofJobConclusions(remote, sha) {
  const suffix = `/actions/runs?head_sha=${sha}&per_page=${PER_PAGE}`;
  const { workflow_runs: runs } = await remote.get(suffix);
  const proofs = runs.filter(({ name }) => name.startsWith(PROOF_WORKFLOW_PREFIX));
  const answers = await Promise.all(
    proofs.map(({ id }) => remote.get(`/actions/runs/${id}/jobs?per_page=${PER_PAGE}`)),
  );
  return answers.flatMap(({ jobs }) => jobs.map(({ conclusion }) => conclusion));
}

async function proofProblems(remote) {
  const [owner] = remote.full.split("/");
  const head = encodeURIComponent(`${owner}:${PROOF_BRANCH}`);
  const [pull] = await remote.get(`/pulls?state=all&head=${head}&per_page=${PER_PAGE}`);
  if (pull === undefined) return [`der Beleg-PR ${PROOF_BRANCH} fehlt`];
  const conclusions = await proofJobConclusions(remote, pull.head.sha);
  const green = conclusions.filter((conclusion) => conclusion === SUCCESS).length;
  const other = conclusions.length - green;
  if (green >= PROOF_GREEN_RUNS && other === 0) return [];
  return [
    `der Beleg-PR ${PROOF_BRANCH} ${green} grüne und ${other} andere Läufe hat, verlangt sind ${PROOF_GREEN_RUNS} grüne und keine anderen`,
  ];
}

function workflowCriterion(id, workflow) {
  const titel = `Der letzte Lauf von ${workflow.datei} auf master ist grün`;
  return { id, titel, pruefen: workflowGreen(workflow), verlauf: true };
}

function withPackages({ erstesPaket, letztesPaket, kriterien, ...step }) {
  const packages = {
    id: "pakete-geschlossen",
    titel: `Die Issues der Pakete ${erstesPaket} bis ${letztesPaket} sind geschlossen`,
    pruefen: packagesClosed(erstesPaket, letztesPaket),
    verlauf: true,
  };
  return { ...step, erstesPaket, kriterien: [packages, ...kriterien] };
}

export const PACKAGE_STEPS = [
  {
    id: "1b",
    erstesPaket: 13,
    letztesPaket: 22,
    kriterien: [
      {
        id: "staging",
        titel: `Staging antwortet auf ${HEALTH_PATH} mit ${HTTP_OK}`,
        pruefen: stagingProblems,
        verlauf: true,
      },
      {
        id: "katalog-ohne-test",
        titel: `${CATALOG_WITHOUT_TEST} ist leer oder fehlt`,
        pruefen: catalogProblems,
      },
      workflowCriterion("rotproben", WORKFLOWS.redProbes),
      {
        id: "geheimnis-liste",
        titel:
          "Die Workflow-Prüfung stoppt secrets und das Environment produktion außerhalb der Liste",
        pruefen: secretListProblems,
      },
    ],
  },
  {
    id: "2",
    erstesPaket: 23,
    letztesPaket: 30,
    kriterien: [
      { id: "auftrag", titel: `${ORDER_TOOL} existiert`, pruefen: orderToolProblems },
      workflowCriterion("aufraeumen", WORKFLOWS.cleanup),
      workflowCriterion("auswertung", WORKFLOWS.evaluation),
      {
        id: "phase-pr",
        titel: `Ein PR von einem Branch ${PHASE_BRANCH}/* ist gemergt`,
        pruefen: phaseMergeProblems,
        verlauf: true,
      },
    ],
  },
  {
    id: "3",
    erstesPaket: 31,
    letztesPaket: 34,
    kriterien: [
      {
        id: "kommentar-basislinie",
        titel: "Die Basislinie der Kommentarregel ist leer",
        pruefen: commentBaselineProblems,
      },
      {
        id: "tests-ohne-quelltext",
        titel: "Kein Test liest Dateien unter src/ oder *.md als Text",
        pruefen: textReadingProblems,
      },
    ],
  },
  {
    id: "4",
    erstesPaket: 35,
    letztesPaket: 35,
    kriterien: [
      {
        id: "claude-md",
        titel: `${INSTRUCTIONS_FILE} hat höchstens ${INSTRUCTIONS_MAX_LINES} Zeilen`,
        pruefen: instructionsProblems,
      },
      {
        id: "workflows-entfernt",
        titel: `${RETIRED_WORKFLOW_DIRECTORY}/ existiert nicht mehr`,
        pruefen: retiredWorkflowProblems,
      },
      workflowCriterion("anweisungstexte", WORKFLOWS.instructions),
    ],
  },
  {
    id: "5",
    erstesPaket: 36,
    letztesPaket: 38,
    kriterien: [
      {
        id: "beleg-zehn-laeufe",
        titel: `Der Beleg-PR ${PROOF_BRANCH} hat ${PROOF_GREEN_RUNS} grüne Läufe`,
        pruefen: proofProblems,
        verlauf: true,
      },
    ],
  },
].map(withPackages);
