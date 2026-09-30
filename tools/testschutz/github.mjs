import { env } from "node:process";

const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const USER_AGENT = "hermes-testschutz";
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

export async function graphql(query, number) {
  const { owner, name } = repositoryName();
  const response = await fetch(env.GITHUB_GRAPHQL_URL || GITHUB_GRAPHQL, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ query, variables: { owner, name, number } }),
  });
  if (!response.ok) throw new Error(`Die GitHub-API antwortet mit HTTP ${response.status}.`);
  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`Die GitHub-API meldet: ${errors.map(({ message }) => message).join("; ")}`);
  }
  return data.repository;
}

export async function rest(method, path) {
  const response = await fetch(`${env.GITHUB_API_URL || GITHUB_API}${path}`, {
    method,
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Die GitHub-API antwortet auf ${method} ${path} mit HTTP ${response.status}.`);
  }
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
