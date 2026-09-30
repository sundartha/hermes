import { setTimeout as sleep } from "node:timers/promises";
import { closedIssueNumbers, getJson, repositoryName, rest } from "./github.mjs";

const TESTSCHUTZ_WORKFLOW = "testschutz.yml";
const OPEN_PULL_REQUESTS_PAGE_SIZE = 100;
const RUN_POLL_INTERVAL_MS = 10_000;
const RUN_POLL_ATTEMPTS = 30;

async function latestRun(sha) {
  const { full } = repositoryName();
  const path = `/repos/${full}/actions/workflows/${TESTSCHUTZ_WORKFLOW}/runs?event=pull_request&head_sha=${sha}&per_page=1`;
  const { workflow_runs: runs } = await getJson(path);
  return runs[0];
}

async function completedRun(sha) {
  for (let attempt = 0; attempt < RUN_POLL_ATTEMPTS; attempt += 1) {
    const run = await latestRun(sha);
    if (run === undefined || run.status === "completed") return run;
    await sleep(RUN_POLL_INTERVAL_MS);
  }
  throw new Error(`Der Testschutz-Lauf für ${sha} wird nicht fertig.`);
}

export async function rerunLinkedPullRequests({ issue }) {
  const { full } = repositoryName();
  const open = await getJson(
    `/repos/${full}/pulls?state=open&per_page=${OPEN_PULL_REQUESTS_PAGE_SIZE}`,
  );
  const pulls = open.filter(({ body }) => closedIssueNumbers(body).includes(issue));
  if (pulls.length === 0) console.log(`Issue #${issue}: kein offener PR verknüpft.`);
  for (const { number, head } of pulls) {
    const run = await completedRun(head.sha);
    if (run === undefined) {
      console.log(`PR #${number}: kein Testschutz-Lauf für ${head.sha}.`);
      continue;
    }
    await rest("POST", `/repos/${full}/actions/runs/${run.id}/rerun`);
    console.log(`PR #${number}: Testschutz-Lauf ${run.id} neu gestartet.`);
  }
}
