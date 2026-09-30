import { closedIssueNumbers, getJson, graphql, repositoryName } from "./github.mjs";

const BEHAVIOUR_LABEL = "verhalten-geaendert";
const APPROVERS = ["Antonio20045", "jonas986"];
const ALLOWED_LIST_HEADING = "Tests, deren Erwartung sich ändern darf";
const HEADING_PATTERN = /^#{1,6}\s+(.+)$/;
const LIST_MARKER_PATTERN = /^(?:[-*+]|\d+[.)])\s+/;
const CODE_SPAN_PATTERN = /^`(.+)`$/;
const LINE_BREAK_PATTERN = /\r?\n/;
const MAX_LABEL_EVENTS = 100;

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number
      body
      lastEditedAt
      timelineItems(last: ${MAX_LABEL_EVENTS}, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
        nodes {
          __typename
          ... on LabeledEvent { createdAt actor { login } label { name } }
          ... on UnlabeledEvent { createdAt actor { login } label { name } }
        }
      }
    }
  }
}`;

function labelProblem(issue) {
  const events = issue.timelineItems.nodes.filter(({ label }) => label?.name === BEHAVIOUR_LABEL);
  const last = events.at(-1);
  if (last?.__typename !== "LabeledEvent") {
    return `Issue #${issue.number} trägt das Label ${BEHAVIOUR_LABEL} nicht.`;
  }
  const actor = last.actor?.login ?? "ein unbekanntes Konto";
  if (!APPROVERS.includes(actor)) {
    return `Issue #${issue.number}: das Label ${BEHAVIOUR_LABEL} hat ${actor} gesetzt; es zählt nur, wenn ${APPROVERS.join(" oder ")} es setzen.`;
  }
  if (issue.lastEditedAt !== null && issue.lastEditedAt > last.createdAt) {
    return `Issue #${issue.number}: der Text wurde nach dem Label geändert; ${APPROVERS.join(" oder ")} müssen das Label neu setzen.`;
  }
  return undefined;
}

function itemText(line) {
  const text = line.trim().replace(LIST_MARKER_PATTERN, "").trim();
  return CODE_SPAN_PATTERN.exec(text)?.[1] ?? text;
}

function allowedNames(body) {
  const lines = (body ?? "").split(LINE_BREAK_PATTERN).map((line) => line.trim());
  const start = lines.findIndex(
    (line) => HEADING_PATTERN.exec(line)?.[1].trim() === ALLOWED_LIST_HEADING,
  );
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING_PATTERN.test(line));
  return rest
    .slice(0, end === -1 ? rest.length : end)
    .map(itemText)
    .filter(Boolean);
}

export async function approval(pullRequest) {
  const { full } = repositoryName();
  const { body } = await getJson(`/repos/${full}/pulls/${pullRequest}`);
  const issueNumbers = closedIssueNumbers(body);
  if (issueNumbers.length === 0) {
    const notLinked = "Der PR ist mit keinem Issue verknüpft; im PR-Text fehlt „Closes #<Issue>“.";
    return { names: new Set(), notes: [notLinked], approvedIssues: [] };
  }
  const issues = await Promise.all(
    issueNumbers.map(async (number) => (await graphql(ISSUE_QUERY, number)).issue),
  );
  const verdicts = issues.map((issue) => ({ issue, problem: labelProblem(issue) }));
  const notes = verdicts.map(({ problem }) => problem).filter(Boolean);
  const approved = verdicts
    .filter(({ problem }) => problem === undefined)
    .map(({ issue }) => issue);
  const names = new Set(approved.flatMap(({ body: issueBody }) => allowedNames(issueBody)));
  const approvedIssues = approved.map(({ number }) => `#${number}`);
  return { names, notes, approvedIssues };
}

export function listHint() {
  return `unter „${ALLOWED_LIST_HEADING}“ in einem Issue mit dem Label ${BEHAVIOUR_LABEL} von ${APPROVERS.join(" oder ")}`;
}
