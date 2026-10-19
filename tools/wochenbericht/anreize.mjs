import { enthaeltAlteTestZeile, enthaeltAusstiegszeile, pruefungenDerAuswege } from "../auftrag/ausgang.mjs";
import { repoPages } from "./github.mjs";
import { WEEK_MS } from "./zeit.mjs";

const EQUIVALENT_LINE = /^Gleichwertig: .+, weil .+$/gm;
const REVIEW_LABEL = "pruefer";
const CLOSED = "closed";

function equivalentCount(commits) {
  return commits.reduce((sum, { commit }) => sum + (commit.message.match(EQUIVALENT_LINE) ?? []).length, 0);
}

function exitsByCheck(texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const id of pruefungenDerAuswege(text)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const sorted = [...counts].sort(([first, many], [second, more]) => more - many || first.localeCompare(second));
  return sorted.length > 0 ? sorted.map(([id, count]) => `${id} ${count}`).join(", ") : "0";
}

function inWeek(timestamp, start) {
  return timestamp !== null && timestamp !== undefined && new Date(timestamp) >= start;
}

async function closedByChange({ number }) {
  const events = await repoPages(`/issues/${number}/events`);
  const closing = events.filter(({ event }) => event === CLOSED).at(-1);
  return typeof closing?.commit_id === "string";
}

export function weekCommits(now) {
  return repoPages(`/commits?sha=master&since=${new Date(now - WEEK_MS).toISOString()}`);
}

export async function incentiveSection(now, { commits: pending = weekCommits(now) } = {}) {
  const start = new Date(now - WEEK_MS);
  const since = start.toISOString();
  const [commits, comments, reviewIssues] = await Promise.all([
    pending,
    repoPages(`/issues/comments?since=${since}`),
    repoPages(`/issues?labels=${REVIEW_LABEL}&state=${CLOSED}&since=${since}`),
  ]);
  const weekComments = comments.filter(({ created_at: created }) => inWeek(created, start)).map(({ body }) => body ?? "");
  const exits = weekComments.filter(enthaeltAusstiegszeile);
  const oldTests = weekComments.filter(enthaeltAlteTestZeile);
  const byCheck = exitsByCheck([...commits.map(({ commit }) => commit.message), ...weekComments]);
  const closed = reviewIssues.filter(({ pull_request: pull, closed_at: closedAt }) => pull === undefined && inWeek(closedAt, start));
  let withChange = 0;
  for (const issue of closed) if (await closedByChange(issue)) withChange += 1;
  return [
    `- Angenommene Gleichwertig-Meldungen in Commits auf master: ${equivalentCount(commits)}`,
    `- Ausstiege „Auftrag passt nicht“ in Kommentaren: ${exits.length}`,
    `- Ausstiege je Prüfung: ${byCheck}`,
    `- Alter Test hält altes Verhalten fest: ${oldTests.length}`,
    `- Geschlossene Prüfer-Issues: ${withChange} mit einer Änderung, ${closed.length - withChange} ohne Änderung`,
    "",
  ];
}
