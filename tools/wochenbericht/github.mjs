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

export async function api(path, { method = "GET", body, accepted = [] } = {}) {
  const response = await fetch(`${env.GITHUB_API_URL || GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "hermes-wochenbericht",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === HTTP_NO_CONTENT || accepted.includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`die GitHub-API auf ${method} ${path} mit HTTP ${response.status} antwortet`);
  }
  return response.json();
}

export function repo(suffix, options) {
  return api(`/repos/${repository()}${suffix}`, options);
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

export function searchIssues(query) {
  const encoded = encodeURIComponent(`repo:${repository()} ${query}`);
  return api(`/search/issues?q=${encoded}&per_page=${PER_PAGE}`);
}
