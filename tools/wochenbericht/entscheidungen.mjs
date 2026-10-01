import { repo, repoPages } from "./github.mjs";
import { DAY_MS, germanDate } from "./zeit.mjs";

export const APPROVERS = ["Antonio20045", "jonas986"];
export const AUTOMATION_LOGIN = "github-actions[bot]";
const OPEN_LABEL = "entscheidung";
const DONE_LABEL = "entschieden";
const NOTE_HEADING = "Entscheidung nötig";
const PRESENTED_MARKER = "<!-- wochenbericht-vorgelegt -->";
const DECIDED_MARKER = "<!-- wochenbericht-entschieden -->";
const ANSWER_DAYS = 3;
const SHOWN_DECISIONS = 3;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const OPTION_PATTERN = /^\s*(\d+)[.)]\s+(.+)$/;
const ANSWER_PATTERN = /^\s*(\d+)\s*$/;
const RECOMMENDED_PATTERN = /empfehlung/i;
const RECOMMENDATION_LINE = /Empfehlung:?\s*(?:Option\s*)?(\d+)/i;
const DEFAULT_LINE = /Vorgabe:?\s*(?:Option\s*)?(\d+)/i;

function optionList(text) {
  const groups = [];
  for (const line of text.split("\n")) {
    const match = OPTION_PATTERN.exec(line);
    if (match === null) continue;
    const number = Number(match[1]);
    if (number === 1) groups.push([]);
    groups.at(-1)?.push({ number, text: match[2].trim() });
  }
  return groups.at(-1) ?? [];
}

function lineNumber(pattern, text) {
  const match = pattern.exec(text);
  return match === null ? undefined : Number(match[1]);
}

function parseNote(text) {
  const options = optionList(text);
  const recommendation =
    options.find((option) => RECOMMENDED_PATTERN.test(option.text))?.number ??
    lineNumber(RECOMMENDATION_LINE, text);
  return { options, recommendation, fallback: lineNumber(DEFAULT_LINE, text) ?? recommendation };
}

function isMarker(comment, marker) {
  return comment.user?.login === AUTOMATION_LOGIN && comment.body?.startsWith(marker);
}

async function loadDecision(issue) {
  const comments = await repoPages(`/issues/${issue.number}/comments`);
  const notes = comments.filter((comment) => comment.body?.includes(NOTE_HEADING));
  const note = notes.at(-1) ?? { body: issue.body ?? "", created_at: issue.created_at };
  const since = comments.filter((comment) => comment.created_at >= note.created_at);
  const presented = since.find((comment) => isMarker(comment, PRESENTED_MARKER));
  return {
    issue: issue.number,
    title: issue.title,
    url: issue.html_url,
    ...parseNote(note.body),
    presentedAt: presented?.created_at,
    comments: since,
  };
}

export async function openDecisions() {
  const issues = await repoPages(
    `/issues?labels=${OPEN_LABEL}&state=open&sort=created&direction=asc`,
  );
  const plain = issues.filter((issue) => issue.pull_request === undefined);
  return Promise.all(plain.map(loadDecision));
}

function deadline(decision, now) {
  return new Date(new Date(decision.presentedAt ?? now).getTime() + ANSWER_DAYS * DAY_MS);
}

function answerOf(decision) {
  const valid = new Set(decision.options.map(({ number }) => number));
  const fromApprovers = decision.comments.filter((comment) =>
    APPROVERS.includes(comment.user?.login),
  );
  const answers = fromApprovers.map((comment) => ({
    comment,
    number: lineNumber(ANSWER_PATTERN, comment.body ?? ""),
  }));
  return answers.filter(({ number }) => valid.has(number)).at(-1);
}

function outcome(decision, now) {
  const answer = answerOf(decision);
  if (answer !== undefined) {
    const { login } = answer.comment.user;
    const when = germanDate(answer.comment.created_at);
    return { number: answer.number, reason: `Antwort „${answer.number}“ von ${login} am ${when}.` };
  }
  if (decision.fallback === undefined) return undefined;
  const reason = `Bis zum ${germanDate(deadline(decision, now))} kam keine Antwort von ${APPROVERS.join(" oder ")}; es gilt die Vorgabe.`;
  return { number: decision.fallback, reason };
}

async function relabel(issueNumber) {
  await repo("/labels", {
    method: "POST",
    body: { name: DONE_LABEL },
    accepted: [HTTP_UNPROCESSABLE],
  });
  await repo(`/issues/${issueNumber}/labels`, { method: "POST", body: { labels: [DONE_LABEL] } });
  await repo(`/issues/${issueNumber}/labels/${OPEN_LABEL}`, {
    method: "DELETE",
    accepted: [HTTP_NOT_FOUND],
  });
}

export async function evaluateDue(decisions, now) {
  const due = decisions.filter(
    ({ presentedAt }) => presentedAt !== undefined && deadline({ presentedAt }, now) <= now,
  );
  for (const decision of due) {
    const result = outcome(decision, now);
    if (result === undefined) {
      console.log(`#${decision.issue}: keine Vorgabe lesbar, bleibt offen.`);
      continue;
    }
    const chosen = decision.options.find(({ number }) => number === result.number);
    const body = [
      DECIDED_MARKER,
      `## Entschieden: Option ${result.number}`,
      "",
      chosen.text,
      "",
      `Grund: ${result.reason}`,
      "",
    ];
    await repo(`/issues/${decision.issue}/comments`, {
      method: "POST",
      body: { body: body.join("\n") },
    });
    await relabel(decision.issue);
    console.log(`#${decision.issue}: entschieden, Option ${result.number}.`);
  }
  return decisions.filter((decision) => !due.includes(decision));
}

export async function markPresented(decisions, report) {
  for (const decision of decisions.slice(0, SHOWN_DECISIONS)) {
    if (decision.presentedAt !== undefined) continue;
    const text = [
      PRESENTED_MARKER,
      `Vorgelegt im Wochenbericht KW ${report.week} (#${report.number}).`,
      "",
      `Antwort: ein Kommentar in diesem Issue, der nur die Nummer der Option enthält. ${fallbackText(decision, report.now)}`,
      "",
    ].join("\n");
    await repo(`/issues/${decision.issue}/comments`, { method: "POST", body: { body: text } });
  }
}

function fallbackText(decision, now) {
  if (decision.fallback === undefined)
    return "Eine Vorgabe ist nicht lesbar; ohne Antwort bleibt sie offen.";
  return `Ohne Antwort von ${APPROVERS.join(" oder ")} gilt ab dem ${germanDate(deadline(decision, now))} Option ${decision.fallback}.`;
}

function decisionLines(decision, index, now) {
  const options = decision.options.map(({ number, text }) => `${number}. ${text}`);
  const choice = [
    `Empfehlung: ${decision.recommendation === undefined ? "keine lesbar" : `Option ${decision.recommendation}`}.`,
    `Vorgabe: ${decision.fallback === undefined ? "keine lesbar" : `Option ${decision.fallback}`}.`,
  ];
  return [
    `### ${index + 1}. ${decision.title} ([#${decision.issue}](${decision.url}))`,
    "",
    ...(options.length === 0
      ? ["Die Optionen ließen sich nicht lesen; bitte im Issue nachsehen."]
      : options),
    "",
    choice.join(" "),
    `Antwort: ein Kommentar in #${decision.issue}, der nur die Nummer enthält. ${fallbackText(decision, now)}`,
    "",
  ];
}

export function decisionSection(decisions, now) {
  if (decisions.length === 0) return ["Keine offenen Entscheidungen.", ""];
  const rest = decisions.length - SHOWN_DECISIONS;
  return [
    ...decisions
      .slice(0, SHOWN_DECISIONS)
      .flatMap((decision, index) => decisionLines(decision, index, now)),
    ...(rest > 0
      ? [`Weitere ${rest} offene Entscheidungen folgen in den nächsten Berichten.`, ""]
      : []),
  ];
}
