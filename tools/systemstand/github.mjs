import { env } from "node:process";

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPOSITORY = "sundartha/hermes";
const PER_PAGE = 100;
const HTTP_NOT_FOUND = 404;

function request(path, { method = "GET", body } = {}) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN oder GITHUB_TOKEN fehlt");
  const headers = {
    "User-Agent": "hermes-systemstand",
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const payload = body === undefined ? {} : { body: JSON.stringify(body) };
  return fetch(`${env.GITHUB_API_URL || GITHUB_API}${path}`, { method, headers, ...payload });
}

function parsed(response, method, path) {
  if (response.ok) return response.json();
  throw new Error(`die GitHub-API auf ${method} ${path} mit HTTP ${response.status} antwortet`);
}

export async function github(path, options = {}) {
  return parsed(await request(path, options), options.method ?? "GET", path);
}

async function pages(get, query, page = 1) {
  const suffix = `${query}&per_page=${PER_PAGE}&page=${page}`;
  const batch = await get(suffix);
  const notAList = `die GitHub-API auf GET ${suffix} keine Liste liefert`;
  if (!Array.isArray(batch)) throw new Error(notAList);
  return batch.length < PER_PAGE ? batch : [...batch, ...(await pages(get, query, page + 1))];
}

export function remoteFacts() {
  const full = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const get = async (suffix) => github(`/repos/${full}${suffix}`);
  const raw = async (suffix) => request(`/repos/${full}${suffix}`);
  const send = async (method, suffix, body) => github(`/repos/${full}${suffix}`, { method, body });
  const all = async (query) => pages(get, query);
  const optional = async (suffix) => {
    const response = await raw(suffix);
    if (response.status === HTTP_NOT_FOUND) return undefined;
    return parsed(response, "GET", `/repos/${full}${suffix}`);
  };
  let rules;
  const facts = { full, get, raw, send, all, optional };
  return { ...facts, rules: () => (rules ??= get("/rules/branches/master")) };
}
