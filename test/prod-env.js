import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BASE_ENV } from "./helpers.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseRenderEnv() {
  const text = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  const entry = /-\s+key:\s*(\w+)\s*\n\s*value:\s*(.*)$/gm;
  const env = {};
  let match;
  while ((match = entry.exec(text)) !== null) {
    const raw = match[2].trim();
    env[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return Object.freeze(env);
}

export const RENDER_ENV = parseRenderEnv();

export const LIVE_MEASURED = Object.freeze({
  ALLOWED_COUNTRY_CODES: "*",
  MAX_BUDGET_EUR: "30",
});

export const LIVE_UNMEASURED = Object.freeze({
  BUDGET_MONTH_ENABLED: "Boot-Zeile ab P1 vorhanden; Uebernahme nach LIVE_MEASURED gehoert zu P6/P7",
  MULTI_TENANT: "kein Boot-Ausdruck; Blueprint-Wert widerspricht dem Live-Produkt",
  SELF_SERVICE_ENABLED: "kein Boot-Ausdruck; Blueprint-Wert widerspricht dem Live-Produkt",
  PLATFORM_ALERT_SMS_TO: "Wert ist eine Betreiber-Rufnummer und gehoert nicht ins Repo",
});

export const LIVE_ENV = Object.freeze({ ...RENDER_ENV, ...LIVE_MEASURED });

export const PROD_DUMMY_SECRETS = Object.freeze({
  ANTHROPIC_API_KEY: "test-anthropic-key",
  TELNYX_API_KEY: "",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  ALLOWED_NUMBERS: "",
  PROFILES_JSON: "",
});

export const PROD_ENV_EXEMPTIONS = Object.freeze({
  STORE_BACKEND: "die Suite laeuft offline ohne Postgres (DATABASE_URL ist ein Secret)",
  WEB_DIST_DIR: "setzt einen apps/web-Build voraus, der in der Suite nicht existiert",
  COST_TRUING_REQUIRED_RECORD_TYPES:
    "Blueprint-Wert ist leer (= Boot-Refusal), exakter Live-Wert aus keinem Log ablesbar",
});

function spawnEnvFrom(source, overrides) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (key in PROD_ENV_EXEMPTIONS) continue;
    env[key] = value;
  }
  return { ...env, ...PROD_DUMMY_SECRETS, ...overrides };
}

export function prodEnv(overrides = {}) {
  return spawnEnvFrom(LIVE_ENV, overrides);
}

export function blueprintEnv(overrides = {}) {
  return spawnEnvFrom(RENDER_ENV, overrides);
}

export function divergentGateKeys() {
  return Object.keys(LIVE_ENV).filter(
    (key) =>
      key in BASE_ENV &&
      !(key in PROD_ENV_EXEMPTIONS) &&
      String(BASE_ENV[key]) !== LIVE_ENV[key],
  );
}
