import { spawnSync } from "node:child_process";

import { APPROVERS } from "../akteure.mjs";
import { PER_PAGE, graphql, repo, repoPages, searchIssues, searchText } from "./github.mjs";
import { WEEK_MS, daysBetween, germanDate } from "./zeit.mjs";

const SYSTEMSTAND_TOOL = "tools/systemstand.mjs";
const APPROVAL_WORKFLOW = "Freigabe";
const APPROVAL_MARKER = "<!-- freigabe-zusammenfassung -->";
const NEEDS_APPROVAL = "Braucht Freigabe:";
const MUST_CHANGE = "Muss geändert werden:";
const RED = new Set(["failure", "timed_out", "startup_failure"]);
const PASSING = new Set(["success", "skipped", "neutral"]);
const SCHEDULED_RED_STREAK = 3;
const SHORT_SHA = 7;
const REVERT_PATTERN = /^Revert\b|This reverts commit/m;

export function systemstandLines() {
  const result = spawnSync(process.execPath, [SYSTEMSTAND_TOOL], { encoding: "utf8" });
  const lines = result.stdout.split("\n").filter((line) => line.startsWith("Schritt "));
  const errors = result.stderr.split("\n").filter(Boolean);
  if (lines.length === 0 && errors.length === 0) return ["Systemstand hat nichts ausgegeben."];
  return [...lines.map((line) => `- ${line}`), ...errors.map((line) => `- ${line}`)];
}

function onMaster(run) {
  return run.head_branch === "master" && run.event !== "pull_request";
}

function redOnMasterLines(runs, weekStart) {
  const red = runs.filter(
    (run) => onMaster(run) && RED.has(run.conclusion) && new Date(run.created_at) >= weekStart,
  );
  const byWorkflow = Map.groupBy(red, (run) => run.name);
  const lines = [...byWorkflow.entries()].map(
    ([name, list]) =>
      `- ${name}: ${list.length} rot, zuletzt [${germanDate(list[0].created_at)}](${list[0].html_url})`,
  );
  return [`Rote Läufe auf master in sieben Tagen: ${red.length}.`, "", ...lines];
}

function commitIsGreen(runs) {
  return runs.every((run) => PASSING.has(run.conclusion));
}

function shortCommit([sha, runs]) {
  return `Commit ${sha.slice(0, SHORT_SHA)} vom ${germanDate(runs.at(-1).created_at)}`;
}

function greenMasterLine(runs, now) {
  const pushes = runs.filter((run) => onMaster(run) && run.event === "push");
  const byCommit = [...Map.groupBy(pushes, (run) => run.head_sha).entries()];
  const finished = byCommit.filter(([, list]) => list.every((run) => run.status === "completed"));
  const latestGreen = finished.find(([, list]) => commitIsGreen(list));
  if (latestGreen === undefined) return "Im Zeitraum gibt es keinen grünen Stand auf master.";
  if (latestGreen === finished[0]) {
    return `Tage seit dem letzten grünen master: 0, master ist grün (${shortCommit(latestGreen)}).`;
  }
  const since = daysBetween(latestGreen[1].at(-1).created_at, now);
  return `Tage seit dem letzten grünen master: ${since}. Zuletzt grün war ${shortCommit(latestGreen)}; der neueste fertige Stand, ${shortCommit(finished[0])}, ist rot.`;
}

export async function scheduledRedStreaks(workflows) {
  const streaks = [];
  for (const workflow of workflows) {
    const { workflow_runs: runs } = await repo(
      `/actions/workflows/${workflow.id}/runs?event=schedule&status=completed&per_page=${SCHEDULED_RED_STREAK}`,
    );
    const red =
      runs.length === SCHEDULED_RED_STREAK && runs.every((run) => RED.has(run.conclusion));
    if (red) streaks.push({ name: workflow.name, runs });
  }
  return streaks;
}

function streakLines(streaks) {
  if (streaks.length === 0) return ["Kein geplanter Lauf war dreimal hintereinander rot."];
  return streaks.map(
    ({ name, runs }) =>
      `- Geplanter Lauf „${name}“ dreimal hintereinander rot, zuletzt [${germanDate(runs[0].created_at)}](${runs[0].html_url}).`,
  );
}

export function redSection({ runs, streaks, now }) {
  const weekStart = new Date(now - WEEK_MS);
  return [
    ...redOnMasterLines(runs, weekStart),
    "",
    greenMasterLine(runs, now),
    "",
    ...streakLines(streaks),
    "",
  ];
}

const MERGED_BY_QUERY = [
  "query($text: String!, $first: Int!) {",
  "search(query: $text, type: ISSUE, first: $first) {",
  "nodes { ... on PullRequest { number mergedBy { login } } }",
  "}",
  "}",
].join(" ");

async function mergedBy(number) {
  const pull = await repo(`/pulls/${number}`);
  return pull.merged_by?.login;
}

async function mergers(items, query) {
  if (items.length === 0) return new Map();
  const { search } = await graphql(MERGED_BY_QUERY, { text: searchText(query), first: PER_PAGE });
  const by = new Map(search.nodes.map((pull) => [pull.number, pull.mergedBy?.login]));
  for (const { number } of items.filter((item) => !by.has(item.number))) {
    by.set(number, await mergedBy(number));
  }
  return by;
}

export async function mergeSection(now) {
  const [since] = new Date(now - WEEK_MS).toISOString().split("T");
  const merged = await searchIssues(`is:pr is:merged merged:>=${since}`);
  const query = `is:pr is:merged merged:>=${since} ${APPROVERS.map((login) => `-reviewed-by:${login}`).join(" ")}`;
  const unreviewed = await searchIssues(query);
  const by = await mergers(unreviewed.items, query);
  const withoutHumans = unreviewed.items.filter((item) => !APPROVERS.includes(by.get(item.number)));
  return [
    `${withoutHumans.length} von ${merged.total_count} Merges in sieben Tagen ohne Review oder Merge durch ${APPROVERS.join(" oder ")}.`,
    "",
    ...withoutHumans.map((item) => `- [#${item.number} ${item.title}](${item.html_url})`),
    "",
  ];
}

export function revertSection(commits) {
  const reverts = commits.filter((commit) => REVERT_PATTERN.test(commit.commit.message));
  if (reverts.length === 0) return ["Keine Rücknahmen auf master in sieben Tagen.", ""];
  return [
    ...reverts.map(
      ({ sha, html_url: url, commit }) =>
        `- [${sha.slice(0, SHORT_SHA)}](${url}) ${commit.message.split("\n")[0]}`,
    ),
    "",
  ];
}

async function latestApproval(pull, runs) {
  const isApproval = (run) => run.name === APPROVAL_WORKFLOW;
  const known = runs.find((run) => run.head_sha === pull.head.sha && isApproval(run));
  if (known !== undefined) return known;
  const { workflow_runs: forCommit } = await repo(`/actions/runs?head_sha=${pull.head.sha}`);
  return forCommit.find(isApproval);
}

async function approvalState(pull, runs) {
  const latest = await latestApproval(pull, runs);
  if (latest?.conclusion !== "failure") return undefined;
  const comments = await repoPages(`/issues/${pull.number}/comments`);
  const summary = comments.find((comment) => comment.body?.startsWith(APPROVAL_MARKER))?.body ?? "";
  if (summary.includes(MUST_CHANGE)) return undefined;
  const reasons = summary.split("\n").filter((line) => line.includes(NEEDS_APPROVAL));
  return reasons.map((line) => line.replace(/^-\s*/, "")).join(" ") || "Freigabe-Prüfung ist rot.";
}

export async function approvalSection(runs) {
  const pulls = await repoPages("/pulls?state=open");
  const lines = [];
  for (const pull of pulls.filter((candidate) => !candidate.draft)) {
    const reason = await approvalState(pull, runs);
    if (reason !== undefined)
      lines.push(`- [#${pull.number} ${pull.title}](${pull.html_url}): ${reason}`);
  }
  return lines.length === 0 ? ["Kein PR wartet auf eine Freigabe.", ""] : [...lines, ""];
}
