import { env } from "node:process";

const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const USER_AGENT = "hermes-testschutz";
const ISSUE_TYPE = "Issue";
const RELEASE_ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { number body createdAt lastEditedAt author { login } editor { login } }
    }
  }
}`;
const CLOSING_REFERENCE_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

function githubHeaders() {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN fehlt; die Prüfung braucht die GitHub-API.");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };
}

export function repositoryName() {
  const [owner, name] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !name)
    throw new Error("GITHUB_REPOSITORY fehlt oder hat nicht die Form owner/name.");
  return { owner, name, full: `${owner}/${name}` };
}

function httpFehler({ status }, aufruf = "") {
  const fehler = new Error(`Die GitHub-API antwortet${aufruf} mit HTTP ${status}.`);
  return Object.assign(fehler, { status });
}

export async function graphql(query, number) {
  const { owner, name } = repositoryName();
  const response = await fetch(env.GITHUB_GRAPHQL_URL || GITHUB_GRAPHQL, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ query, variables: { owner, name, number } }),
  });
  if (!response.ok) throw httpFehler(response);
  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`Die GitHub-API meldet: ${errors.map(({ message }) => message).join("; ")}`);
  }
  return data.repository;
}

export async function rest(method, path, body) {
  const json = body === undefined ? {} : { "Content-Type": "application/json" };
  const response = await fetch(`${env.GITHUB_API_URL || GITHUB_API}${path}`, {
    method,
    headers: { ...githubHeaders(), ...json },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw httpFehler(response, ` auf ${method} ${path}`);
  return response;
}

export async function getJson(path) {
  const response = await rest("GET", path);
  return response.json();
}

export function closedIssueNumbers(body) {
  const matches = (body ?? "").matchAll(CLOSING_REFERENCE_PATTERN);
  return [...new Set([...matches].map((match) => Number(match[1])))];
}

export async function linkedIssues(body) {
  const found = await Promise.all(
    closedIssueNumbers(body).map(
      async (number) => (await graphql(RELEASE_ISSUE_QUERY, number)).issueOrPullRequest,
    ),
  );
  return found.filter((node) => node?.__typename === ISSUE_TYPE);
}

export function latestApprovals(reviews, logins) {
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (logins.includes(login) && review.state !== "COMMENTED") latest.set(login, review);
  }
  return [...latest.values()].filter((review) => review.state === "APPROVED");
}

export function approvedAtHead(reviews, logins, headSha) {
  return latestApprovals(reviews, logins).filter((review) => review.commit_id === headSha);
}
