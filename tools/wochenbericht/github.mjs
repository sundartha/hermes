import { env } from "node:process";

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPOSITORY = "sundartha/hermes";
const HTTP_NO_CONTENT = 204;
export const PER_PAGE = 100;

function token() {
  const value = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!value) throw new Error("GH_TOKEN oder GITHUB_TOKEN fehlt");
  return value;
}

export function repository() {
  return env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
}

const TIMEOUT_MS = 30_000;
const NETWORK_ERRORS = new Set(["TypeError", "TimeoutError", "AbortError"]);

async function attempt(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || response.status === HTTP_NO_CONTENT) return { response };
  return { response, value: await response.json() };
}

async function answer(url, init, { retry, timeoutMs }) {
  try {
    return await attempt(url, init, timeoutMs);
  } catch (error) {
    if (!retry || !NETWORK_ERRORS.has(error.name)) throw error;
    return attempt(url, init, timeoutMs);
  }
}

function failure(error) {
  return NETWORK_ERRORS.has(error.name) ? "keine Antwort liefert" : "eine unlesbare Antwort liefert";
}

function requestInit(method, body) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "hermes-wochenbericht",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export async function api(
  path,
  { method = "GET", body, accepted = [], retry = method === "GET", timeoutMs = TIMEOUT_MS } = {},
) {
  const url = `${env.GITHUB_API_URL || GITHUB_API}${path}`;
  const { response, value } = await answer(url, requestInit(method, body), { retry, timeoutMs }).catch((error) => {
    throw new Error(`die GitHub-API auf ${method} ${path} ${failure(error)} (${error.message})`);
  });
  if (response.status === HTTP_NO_CONTENT || accepted.includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`die GitHub-API auf ${method} ${path} mit HTTP ${response.status} antwortet`);
  }
  return value;
}

export function repo(suffix, options) {
  return api(`/repos/${repository()}${suffix}`, options);
}

export async function raiseIssueOnce(openIssues, { title, body, limit }) {
  if (openIssues.some((issue) => issue.title === title)) return;
  if (openIssues.length >= limit) {
    console.error(`Obergrenze von ${limit} offenen Issues erreicht; „${title}“ fehlt.`);
    return;
  }
  openIssues.push(await repo("/issues", { method: "POST", body: { title, body } }));
}

function withPage(path, page) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}per_page=${PER_PAGE}&page=${page}`;
}

export async function repoPages(suffix, { pick = (page) => page, until = () => false } = {}) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = pick(await repo(withPage(suffix, page)));
    items.push(...batch);
    if (batch.length < PER_PAGE || batch.some(until)) return items;
  }
}

export function searchText(query) {
  return `repo:${repository()} ${query}`;
}

export function searchIssues(query) {
  const encoded = encodeURIComponent(searchText(query));
  return api(`/search/issues?q=${encoded}&per_page=${PER_PAGE}`);
}

export async function graphql(query, variables) {
  const answer = await api("/graphql", { method: "POST", body: { query, variables }, retry: true });
  if (answer.errors?.length > 0) {
    const messages = answer.errors.map(({ message }) => message).join("; ");
    throw new Error(`die GitHub-GraphQL-Abfrage mit Fehlern antwortet: ${messages}`);
  }
  return answer.data;
}
