const OWN_WORKFLOW = "Systemstand";
const RECENT_COMMITS = 10;
const PER_PAGE = 100;
const SHORT_SHA = 7;
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

export async function masterGreenProblems(remote) {
  const commits = await remote.get(`/commits?sha=master&per_page=${RECENT_COMMITS}`);
  for (const { sha } of commits) {
    const suffix = `/actions/runs?event=push&head_sha=${sha}&per_page=${PER_PAGE}`;
    const { workflow_runs: all } = await remote.get(suffix);
    const runs = all.filter(({ name }) => name !== OWN_WORKFLOW);
    if (runs.length === 0 || runs.some(({ status }) => status !== "completed")) continue;
    return runs
      .filter(({ conclusion }) => !PASSING_CONCLUSIONS.has(conclusion))
      .map(({ name }) => `„${name}“ auf master ${sha.slice(0, SHORT_SHA)} rot ist`);
  }
  return [`auf master in den letzten ${RECENT_COMMITS} Commits kein Lauf ganz abgeschlossen ist`];
}
