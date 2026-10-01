const OWN_WORKFLOW = "Systemstand";
const RECENT_COMMITS = 10;
const PER_PAGE = 100;
const SHORT_SHA = 7;
const COMPLETED = "completed";
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

async function newestMasterRuns(remote) {
  const commits = await remote.get(`/commits?sha=master&per_page=${RECENT_COMMITS}`);
  for (const { sha } of commits) {
    const suffix = `/actions/runs?event=push&head_sha=${sha}&per_page=${PER_PAGE}`;
    const { workflow_runs: all } = await remote.get(suffix);
    const runs = all.filter(({ name }) => name !== OWN_WORKFLOW);
    if (runs.length > 0) return { sha, runs };
  }
  return undefined;
}

function failed({ status, conclusion }) {
  return status === COMPLETED && !PASSING_CONCLUSIONS.has(conclusion);
}

export async function masterGreenProblems(remote) {
  const newest = await newestMasterRuns(remote);
  if (newest === undefined) {
    return [`auf master in den letzten ${RECENT_COMMITS} Commits kein Lauf zu finden ist`];
  }
  const where = `auf master ${newest.sha.slice(0, SHORT_SHA)}`;
  const red = newest.runs.filter(failed);
  if (red.length > 0) return red.map(({ name }) => `„${name}“ ${where} rot ist`);
  const running = newest.runs.filter(({ status }) => status !== COMPLETED);
  if (running.length === 0) return [];
  return { gruende: running.map(({ name }) => `„${name}“ ${where} noch läuft`), ausstehend: true };
}
