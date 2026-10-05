import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { verwaisteSperren } from "./auftrag/sperren.mjs";
import { matches } from "./pruefungen-messen.mjs";
import { github, remoteFacts } from "./systemstand/github.mjs";
import { masterGreenProblems } from "./systemstand/master-gruen.mjs";
import { startedAt } from "./systemstand/pakete.mjs";
import { PACKAGE_STEPS } from "./systemstand/schritte.mjs";

const BASIS_FILE = "tools/basis/systemstand.json";
const WORKFLOW_DIR = ".github/workflows";
const CODEOWNERS_FILE = ".github/CODEOWNERS";
const STEP_LABEL = "schritt";
const REDPROBE_TITLE = "Rot-Probe 20:";
const PER_PAGE = 100;
const HTTP_NOT_FOUND = 404;
const EXIT_FAILURE = 1;
const NON_BLOCKING_PATTERNS = [/continue-on-error/, /\|\|\s*true/];
const PUSH_RULES = ["pull_request", "non_fast_forward", "deletion"];
const QUEUE_RULE = "merge_queue";
const QUEUE_ALL_GREEN = "ALLGREEN";
const WORKFLOW_FILE_PATTERN = /\.ya?ml$/;
const DAY_MS = 86_400_000;
const TIME_LIMIT_FACTOR = 2;
const TIME_LIMIT_NOTE = "Zeitgrenze überschritten, Entscheidung durch Antonio oder Jonas";
const AUTO_MERGE_QUERY =
  "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { autoMergeAllowed } }";

async function autoMergeAllowed(remote) {
  const [owner, name] = remote.full.split("/");
  const body = { query: AUTO_MERGE_QUERY, variables: { owner, name } };
  const { data } = await github("/graphql", { method: "POST", body });
  return data?.repository?.autoMergeAllowed === true;
}

function missing(condition, reason) {
  return condition ? [] : [reason];
}

function ruleParameters(rules, type) {
  return rules.find((rule) => rule.type === type)?.parameters ?? {};
}

function workflowWithJob(check) {
  const files = readdirSync(WORKFLOW_DIR).filter((file) => WORKFLOW_FILE_PATTERN.test(file));
  return files
    .sort()
    .map((file) => ({ file, text: readFileSync(join(WORKFLOW_DIR, file), "utf8") }))
    .find(({ text }) => text.includes(`name: ${check}\n`));
}

async function gateProblems(remote, check, command) {
  const statusChecks = ruleParameters(await remote.rules(), "required_status_checks");
  const required = (statusChecks.required_status_checks ?? []).map(({ context }) => context);
  const workflow = workflowWithJob(check);
  if (workflow === undefined) return [`kein Workflow einen Job „${check}“ hat`];
  const { file, text } = workflow;
  const markers = NON_BLOCKING_PATTERNS.map((pattern) => pattern.exec(text)?.[0]).filter(Boolean);
  return [
    ...missing(required.includes(check), `„${check}“ kein Pflicht-Check auf master ist`),
    ...missing(text.includes("pull_request"), `${file} nicht bei PRs läuft`),
    ...missing(text.includes(command), `${file} ${command} nicht ausführt`),
    ...markers.map((marker) => `${file} Schritte scheitern lässt (${marker})`),
  ];
}

function gate(check, command) {
  return (remote) => gateProblems(remote, check, command);
}

async function pushProblems(remote) {
  const rules = await remote.rules();
  const types = new Set(rules.map(({ type }) => type));
  const ids = [...new Set(rules.map((rule) => rule.ruleset_id))];
  const rulesets = await Promise.all(ids.map((id) => remote.get(`/rulesets/${id}`)));
  const weak = rulesets.filter(
    (ruleset) => ruleset.enforcement !== "active" || ruleset.current_user_can_bypass !== "never",
  );
  return [
    ...PUSH_RULES.filter((type) => !types.has(type)).map((type) => `die Regel ${type} fehlt`),
    ...weak.map(({ name }) => `das Ruleset „${name}“ nicht aktiv ist oder umgangen werden kann`),
  ];
}

function owns(pattern, path) {
  if (pattern.startsWith("/")) return matches(pattern.slice(1), path);
  return [path, basename(path)].some((candidate) => matches(pattern, candidate));
}

function ownerPattern(line) {
  const [pattern] = line.trim().split(/\s+/);
  return pattern;
}

function ownedSourceFiles() {
  const owners = existsSync(CODEOWNERS_FILE) ? readFileSync(CODEOWNERS_FILE, "utf8") : "";
  const patterns = owners
    .split("\n")
    .map(ownerPattern)
    .filter((pattern) => pattern !== "" && !pattern.startsWith("#"));
  const files = execFileSync("git", ["ls-files", "-z", "src"], { encoding: "utf8" }).split("\0");
  return files.filter((path) => path !== "" && patterns.some((pattern) => owns(pattern, path)));
}

async function srcWithoutHumansProblems(remote) {
  const [allowed, rules] = await Promise.all([autoMergeAllowed(remote), remote.rules()]);
  const approvals = ruleParameters(rules, "pull_request").required_approving_review_count ?? 0;
  const owned = ownedSourceFiles();
  return [
    ...missing(allowed, "Auto-Merge im Repo aus ist"),
    ...missing(approvals === 0, `ein PR ${approvals} Freigaben von Menschen braucht`),
    ...owned.slice(0, 1).map((path) => `CODEOWNERS ${owned.length} Dateien wie ${path} nennt`),
  ];
}

async function redProbeVerdict(remote, { number, title }) {
  const pull = await remote.get(`/pulls/${number}`);
  const suffix = `/actions/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=${PER_PAGE}`;
  const { workflow_runs: runs } = await remote.get(suffix);
  return runs.some(({ conclusion }) => conclusion === "failure") ? [] : [`„${title}“ durchging`];
}

async function redProbeProblems(remote) {
  const query = `repo:${remote.full} is:pr is:closed in:title "${REDPROBE_TITLE}"`;
  const path = `/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${PER_PAGE}`;
  const { items } = await github(path);
  const probes = items.filter(({ title }) => title.startsWith(REDPROBE_TITLE)).reverse();
  const latest = new Map(probes.map((item) => [item.title, item]));
  if (latest.size === 0) return ["Paket 20 noch keine Rot-Probe gefahren hat"];
  const verdicts = [...latest.values()].map((item) => redProbeVerdict(remote, item));
  return (await Promise.all(verdicts)).flat();
}

function queueChecksEveryEntry(rules) {
  const queue = ruleParameters(rules, QUEUE_RULE);
  return queue.grouping_strategy === QUEUE_ALL_GREEN && queue.max_entries_to_merge === 1;
}

async function strictRulesProblems(remote) {
  const rules = await remote.rules();
  const statusChecks = ruleParameters(rules, "required_status_checks");
  const upToDate =
    statusChecks.strict_required_status_checks_policy === true || queueChecksEveryEntry(rules);
  return [
    ...missing(
      ruleParameters(rules, "pull_request").require_code_owner_review === true,
      "die Code-Owner-Pflicht im Ruleset aus ist",
    ),
    ...missing(upToDate, "die Pflicht zum aktuellen Stand im Ruleset aus ist"),
  ];
}

const STEP_1A_CRITERIA = [
  {
    id: "lint-konfiguration",
    titel: "Ein PR mit geänderter Lint-Konfiguration wird gestoppt",
    pruefen: gate("Prüfungen prüfen", "tools/eslint-konfig-pruefen.mjs"),
  },
  {
    id: "umgeschriebener-test",
    titel: "Ein PR mit umgeschriebenem Test wird gestoppt",
    pruefen: gate("Testschutz", "tools/tests-nur-ergaenzt.mjs"),
  },
  {
    id: "lint-fehler",
    titel: "Ein PR mit Lint-Fehler wird gestoppt",
    pruefen: gate("CI", "npm run lint"),
  },
  {
    id: "push-auf-master",
    titel: "Ein direkter Push auf master wird gestoppt",
    pruefen: pushProblems,
  },
  {
    id: "src-ohne-menschen",
    titel: "Ein PR nur mit Code unter src/ wird ohne Menschen gemergt",
    pruefen: srcWithoutHumansProblems,
  },
  { id: "master-gruen", titel: "master ist grün", pruefen: masterGreenProblems, verlauf: true },
  {
    id: "rotproben",
    titel: "Die Rot-Proben von Paket 20 wurden gestoppt",
    pruefen: redProbeProblems,
    verlauf: true,
  },
  {
    id: "pflichten-an",
    titel: "Code-Owner-Pflicht und Pflicht zum aktuellen Stand sind an",
    pruefen: strictRulesProblems,
  },
];

const STEPS = [
  { id: "1a", kriterien: STEP_1A_CRITERIA },
  ...PACKAGE_STEPS,
  ...["6", "7", "8", "9", "10", "11"].map((id) => ({ id, kriterien: [], geschnitten: false })),
];

function outcome(result) {
  return Array.isArray(result) ? { gruende: result } : result;
}

async function criterionResult(remote, criterion) {
  try {
    return { ...criterion, ...outcome(await criterion.pruefen(remote)) };
  } catch (error) {
    return { ...criterion, gruende: [error.message] };
  }
}

async function discoveredStart(remote, step) {
  if (step.erstesPaket === undefined) return undefined;
  try {
    return await startedAt(remote, step.erstesPaket);
  } catch {
    return undefined;
  }
}

async function evaluate(remote, records) {
  const report = [];
  for (const step of STEPS) {
    const results = step.kriterien.map((item) => criterionResult(remote, item));
    const { start, schaetzungTage } = records.head[step.id] ?? {};
    const known = { start: start ?? (await discoveredStart(remote, step)), schaetzungTage };
    report.push({ ...step, ...known, kriterien: await Promise.all(results) });
  }
  return report;
}

function stepReasons(step) {
  if (step.geschnitten === false) return ["noch nicht geschnitten"];
  return [...new Set(step.kriterien.flatMap(({ gruende }) => gruende))];
}

function state(reasons) {
  return reasons.length === 0 ? "erfüllt" : `offen, weil ${reasons.join("; ")}`;
}

function overdue({ start, schaetzungTage }) {
  if (typeof start !== "string" || typeof schaetzungTage !== "number") return false;
  return Date.now() - Date.parse(start) > TIME_LIMIT_FACTOR * schaetzungTage * DAY_MS;
}

function stepLine(step) {
  const reasons = stepReasons(step);
  const note = reasons.length > 0 && overdue(step) ? `. ${TIME_LIMIT_NOTE}` : "";
  return `Schritt ${step.id}: ${state(reasons)}${note}`;
}

function estimate(days) {
  if (typeof days !== "number") return "offen";
  return days === 1 ? "1 Tag" : `${days} Tage`;
}

function parseRecords(text) {
  return text === undefined ? {} : (JSON.parse(text).schritte ?? {});
}

function basisText(commit) {
  const type = spawnSync("git", ["cat-file", "-t", commit], { encoding: "utf8" });
  if (type.stdout.trim() !== "commit") {
    throw new Error(`Die PR-Basis ${commit} ist kein Commit in diesem Checkout.`);
  }
  const shown = spawnSync("git", ["show", `${commit}:${BASIS_FILE}`], { encoding: "utf8" });
  return shown.status === 0 ? shown.stdout : undefined;
}

function readRecords(prBasis) {
  const head = parseRecords(existsSync(BASIS_FILE) ? readFileSync(BASIS_FILE, "utf8") : undefined);
  const base = parseRecords(prBasis === undefined ? undefined : basisText(prBasis));
  return {
    head,
    since: (step, id) => head[step]?.erfuelltSeit?.[id] ?? base[step]?.erfuelltSeit?.[id],
  };
}

function unknownEntries(head) {
  const known = new Map(STEPS.map(({ id, kriterien }) => [id, kriterien.map((item) => item.id)]));
  return Object.entries(head).flatMap(([step, entry]) => {
    const ids = known.get(step);
    if (ids === undefined) return [`${BASIS_FILE} nennt den unbekannten Schritt ${step}.`];
    return Object.keys(entry.erfuelltSeit ?? {})
      .filter((id) => !ids.includes(id))
      .map((id) => `${BASIS_FILE} nennt das unbekannte Kriterium ${id} in Schritt ${step}.`);
  });
}

function fallenBack(step, records) {
  return ({ id, gruende, ausstehend }) =>
    gruende.length > 0 && ausstehend !== true && records.since(step.id, id) !== undefined;
}

function regressions(report, records) {
  return report.flatMap((step) =>
    step.kriterien.filter(fallenBack(step, records)).map(({ id, titel, gruende, verlauf }) => ({
      verlauf: verlauf === true,
      text: `Rückfall in Schritt ${step.id}: „${titel}“ ist seit ${records.since(step.id, id)} erfüllt und jetzt ${state(gruende)}.`,
    })),
  );
}

function checkRecords(report, records, forPullRequest) {
  const found = regressions(report, records);
  const passing = ({ verlauf }) => forPullRequest && verlauf;
  for (const regression of found) {
    const note = passing(regression)
      ? " Das sperrt nur master, ein PR ändert den Verlauf nicht."
      : "";
    console.error(`${regression.text}${note}`);
  }
  const unknown = unknownEntries(records.head);
  for (const problem of unknown) console.error(problem);
  const blocking = found.filter((regression) => !passing(regression));
  if (blocking.length > 0 || unknown.length > 0) process.exitCode = EXIT_FAILURE;
}

function cell(text) {
  return text.split("|").join("\\|");
}

function issueBody(step, records) {
  const rows = step.kriterien.map(
    ({ id, titel, gruende }) =>
      `| ${cell(titel)} | ${cell(state(gruende))} | ${records.since(step.id, id) ?? "–"} |`,
  );
  const header = ["| Kriterium | Stand | erfüllt seit |", "| --- | --- | --- |"];
  return [
    stepLine(step),
    "",
    ...(rows.length === 0 ? [] : [...header, ...rows, ""]),
    `Start: ${step.start ?? "offen"}. Schätzung: ${estimate(step.schaetzungTage)}.`,
    "",
    "Prüfbefehl: `node tools/systemstand.mjs`",
    "",
  ].join("\n");
}

async function ensureStepLabel(remote) {
  const response = await remote.raw(`/labels/${STEP_LABEL}`);
  if (response.ok) return;
  if (response.status !== HTTP_NOT_FOUND) {
    throw new Error(
      `die GitHub-API das Label ${STEP_LABEL} mit HTTP ${response.status} verweigert`,
    );
  }
  await remote.send("POST", "/labels", { name: STEP_LABEL });
}

async function updateIssues(remote, report, records) {
  await ensureStepLabel(remote);
  const issues = await remote.get(`/issues?labels=${STEP_LABEL}&state=all&per_page=${PER_PAGE}`);
  for (const step of report) {
    const title = `Schritt ${step.id}`;
    const body = issueBody(step, records);
    const issue = issues.find((candidate) => candidate.title === title);
    if (issue === undefined) {
      await remote.send("POST", "/issues", { title, body, labels: [STEP_LABEL] });
    } else if (issue.body !== body) {
      await remote.send("PATCH", `/issues/${issue.number}`, { body });
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      pruefen: { type: "boolean", default: false },
      "pr-basis": { type: "string" },
      issues: { type: "boolean", default: false },
    },
  });
  const prBasis = values["pr-basis"];
  const records = readRecords(prBasis);
  const remote = remoteFacts();
  const report = await evaluate(remote, records);
  for (const step of report) console.log(stepLine(step));
  for (const line of await verwaisteSperren(remote)) console.log(line);
  if (values.issues) await updateIssues(remote, report, records);
  if (values.pruefen) checkRecords(report, records, prBasis !== undefined);
}

try {
  await main();
} catch (error) {
  console.error(`Systemstand: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
