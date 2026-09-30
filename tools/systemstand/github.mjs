import { env } from "node:process";

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPOSITORY = "sundartha/hermes";

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

export async function github(path, options = {}) {
  const response = await request(path, options);
  if (response.ok) return response.json();
  const method = options.method ?? "GET";
  throw new Error(`die GitHub-API auf ${method} ${path} mit HTTP ${response.status} antwortet`);
}

export function remoteFacts() {
  const full = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const get = async (suffix) => github(`/repos/${full}${suffix}`);
  const raw = async (suffix) => request(`/repos/${full}${suffix}`);
  const send = async (method, suffix, body) => github(`/repos/${full}${suffix}`, { method, body });
  let rules;
  return { full, get, raw, send, rules: () => (rules ??= get("/rules/branches/master")) };
}
