import { repoPages } from "./github.mjs";
import { WEEK_MS } from "./zeit.mjs";

const EQUIVALENT_LINE = /^Gleichwertig: .+, weil .+$/gm;
const EXIT_LINE = /^Auftrag passt nicht: \S/m;
const REVIEW_LABEL = "pruefer";
const CLOSED = "closed";

function equivalentCount(commits) {
  return commits.reduce((sum, { commit }) => sum + (commit.message.match(EQUIVALENT_LINE) ?? []).length, 0);
}

function inWeek(timestamp, start) {
  return timestamp !== null && timestamp !== undefined && new Date(timestamp) >= start;
}

async function closedByChange({ number }) {
  const events = await repoPages(`/issues/${number}/events`);
  const closing = events.filter(({ event }) => event === CLOSED).at(-1);
  return typeof closing?.commit_id === "string";
}

export async function incentiveSection(now) {
  const start = new Date(now - WEEK_MS);
  const since = start.toISOString();
  const [commits, comments, reviewIssues] = await Promise.all([
    repoPages(`/commits?sha=master&since=${since}`),
    repoPages(`/issues/comments?since=${since}`),
    repoPages(`/issues?labels=${REVIEW_LABEL}&state=${CLOSED}&since=${since}`),
  ]);
  const exits = comments.filter(({ body, created_at: created }) => inWeek(created, start) && EXIT_LINE.test(body ?? ""));
  const closed = reviewIssues.filter(({ pull_request: pull, closed_at: closedAt }) => pull === undefined && inWeek(closedAt, start));
  let withChange = 0;
  for (const issue of closed) if (await closedByChange(issue)) withChange += 1;
  return [
    `- Angenommene Gleichwertig-Meldungen in Commits auf master: ${equivalentCount(commits)}`,
    `- Ausstiege „Auftrag passt nicht“ in Kommentaren: ${exits.length}`,
    `- Geschlossene Prüfer-Issues: ${withChange} mit einer Änderung, ${closed.length - withChange} ohne Änderung`,
    "",
  ];
}
