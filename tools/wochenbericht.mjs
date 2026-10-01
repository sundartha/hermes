import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  APPROVERS,
  AUTOMATION_LOGIN,
  decisionSection,
  evaluateDue,
  markPresented,
  openDecisions,
} from "./wochenbericht/entscheidungen.mjs";
import { PER_PAGE, repo, repoPages } from "./wochenbericht/github.mjs";
import { costSection, readBudget, runWindowStart } from "./wochenbericht/kosten.mjs";
import {
  approvalSection,
  mergeSection,
  redSection,
  revertSection,
  scheduledRedStreaks,
  systemstandLines,
} from "./wochenbericht/stand.mjs";
import { germanDate, isoWeek } from "./wochenbericht/zeit.mjs";

const REPORT_PREFIX = "Wochenbericht KW";
const ALARM_PREFIX = "Geplanter Lauf dreimal hintereinander rot:";
const OPEN_ISSUE_LIMIT = 25;
const EXIT_FAILURE = 1;
const WRITING_OPTIONS = ["auswerten", "alarme", "bericht"];

function parseOptions() {
  const { values } = parseArgs({
    options: {
      probe: { type: "boolean", default: false },
      datei: { type: "string", default: join(tmpdir(), "wochenbericht.md") },
      auswerten: { type: "boolean", default: false },
      alarme: { type: "boolean", default: false },
      bericht: { type: "boolean", default: false },
    },
  });
  const writing = WRITING_OPTIONS.filter((name) => values[name]);
  if (values.probe && writing.length > 0) {
    throw new Error(
      `--probe schreibt nur in eine Datei und verträgt kein --${writing.join(", --")}`,
    );
  }
  return values;
}

async function workflowList() {
  const { workflows } = await repo(`/actions/workflows?per_page=${PER_PAGE}`);
  return workflows;
}

async function workflowRuns(workflows, now) {
  const start = runWindowStart(now);
  const names = new Map(workflows.map(({ id, name }) => [id, name]));
  const runs = await repoPages("/actions/runs", {
    pick: (page) => page.workflow_runs,
    until: (run) => new Date(run.created_at) < start,
  });
  const recent = runs.filter((run) => new Date(run.created_at) >= start);
  return recent.map((run) => ({ ...run, name: names.get(run.workflow_id) ?? run.name }));
}

async function openAutomationIssues() {
  const creator = encodeURIComponent(AUTOMATION_LOGIN);
  const issues = await repoPages(`/issues?state=open&creator=${creator}`);
  return issues.filter((issue) => issue.pull_request === undefined);
}

function alarmBody(runs) {
  const links = runs.map((run) => `- [${germanDate(run.created_at)}](${run.html_url})`);
  return ["Die letzten drei geplanten Läufe waren rot:", "", ...links, ""].join("\n");
}

async function raiseAlarms(streaks, openIssues) {
  for (const { name, runs } of streaks) {
    const title = `${ALARM_PREFIX} ${name}`;
    if (openIssues.some((issue) => issue.title === title)) continue;
    if (openIssues.length >= OPEN_ISSUE_LIMIT) {
      console.error(
        `Obergrenze von ${OPEN_ISSUE_LIMIT} offenen Issues erreicht; „${title}“ fehlt.`,
      );
      continue;
    }
    const body = { title, body: alarmBody(runs) };
    openIssues.push(await repo("/issues", { method: "POST", body }));
  }
}

function headCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

function section(title, lines) {
  return [`## ${title}`, "", ...lines];
}

async function buildReport({ now, decisions, streaks, workflows, openIssues }) {
  const runs = await workflowRuns(workflows, now);
  const [approvals, merges, reverts] = await Promise.all([
    approvalSection(),
    mergeSection(now),
    revertSection(now),
  ]);
  const lines = [
    `Stand ${germanDate(now)}, Commit ${headCommit()}. Zeitraum: die letzten sieben Tage, bei den Kosten zusätzlich der laufende Monat.`,
    "",
    ...section("Entscheidungen", decisionSection(decisions, now)),
    ...section("Wartet auf Freigabe", approvals),
    ...section("Systemstand", [...systemstandLines(), ""]),
    ...section("Rote Läufe", redSection({ runs, streaks, now })),
    ...section("Merges ohne Menschen", merges),
    ...section("Rücknahmen", reverts),
    ...section("Kosten", costSection(runs, readBudget(), now)),
    ...section("Issues automatischer Läufe", [
      `${openIssues.length} offen, Obergrenze ${OPEN_ISSUE_LIMIT}.`,
      "",
    ]),
  ];
  return { title: `${REPORT_PREFIX} ${isoWeek(now)}`, week: isoWeek(now), body: lines.join("\n") };
}

async function publish(report, { decisions, openIssues, now }) {
  const previous = openIssues.filter((issue) => issue.title.startsWith(REPORT_PREFIX));
  const others = openIssues.length - previous.length;
  if (others >= OPEN_ISSUE_LIMIT) {
    throw new Error(
      `${others} Issues automatischer Läufe sind offen, die Obergrenze ${OPEN_ISSUE_LIMIT} ist erreicht; der Bericht wird nicht angelegt`,
    );
  }
  const body = { title: report.title, body: report.body, assignees: APPROVERS };
  const issue = await repo("/issues", { method: "POST", body });
  await markPresented(decisions, { week: report.week, number: issue.number, now });
  for (const old of previous) {
    await repo(`/issues/${old.number}`, { method: "PATCH", body: { state: "closed" } });
  }
  console.log(`${report.title} angelegt: ${issue.html_url}`);
}

async function main() {
  const options = parseOptions();
  const now = new Date();
  const all = await openDecisions();
  const decisions = options.auswerten ? await evaluateDue(all, now) : all;
  if (!options.alarme && !options.probe && !options.bericht) return;
  const workflows = await workflowList();
  const streaks = await scheduledRedStreaks(workflows);
  const openIssues = await openAutomationIssues();
  if (options.alarme) await raiseAlarms(streaks, openIssues);
  if (!options.probe && !options.bericht) return;
  const report = await buildReport({ now, decisions, streaks, workflows, openIssues });
  if (options.probe) {
    writeFileSync(options.datei, `# ${report.title}\n\n${report.body}`);
    console.log(`Bericht in ${options.datei} geschrieben.`);
  }
  if (options.bericht) await publish(report, { decisions, openIssues, now });
}

try {
  await main();
} catch (error) {
  console.error(`Wochenbericht: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
