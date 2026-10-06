import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eurToCents } from "../src/config.js";
import { spendCapCoherence } from "../src/boot-guard.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvValue(text, name) {
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!m) throw new Error(`${name} nicht in .env.example gefunden`);
  return m[1].trim();
}

function readRenderValue(text, name) {
  const m = text.match(new RegExp(`key:\\s*${name}\\s*\\n\\s*value:\\s*"?([^"\\n]+)"?`));
  if (!m) throw new Error(`${name} nicht in render.yaml gefunden`);
  return m[1].trim();
}

function readCodeFallback(text, envName) {
  const m = text.match(new RegExp(`numEnv\\(\\s*"${envName}",[^)]*?fallback:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!m) throw new Error(`numEnv-Fallback fuer ${envName} nicht in src/config.js gefunden`);
  return Number(m[1]);
}

test(".env.example: ausgelieferte Budget-Achsen sind kohaerent (kein fataler Boot-Refusal)", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const findings = spendCapCoherence({
    tenantDefaultCents: Number(readEnvValue(envExample, "DEFAULT_TENANT_BUDGET_CENTS")),
    platformCapCents: eurToCents(Number(readEnvValue(envExample, "MAX_BUDGET_EUR"))),
    maxTariffCents: Number(readEnvValue(envExample, "VOICE_TARIFF_DEFAULT_CENTS")),
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `.env.example dokumentiert eine vom eigenen Boot-Guard verweigerte Konfiguration: ${JSON.stringify(findings)}`,
  );
});

test("render.yaml: ausgelieferte Budget-Achsen sind kohaerent (kein fataler Boot-Refusal)", () => {
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  const findings = spendCapCoherence({
    tenantDefaultCents: Number(readRenderValue(renderYaml, "DEFAULT_TENANT_BUDGET_CENTS")),
    platformCapCents: eurToCents(Number(readRenderValue(renderYaml, "MAX_BUDGET_EUR"))),
    maxTariffCents: Number(readRenderValue(renderYaml, "VOICE_TARIFF_DEFAULT_CENTS")),
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `render.yaml dokumentiert eine vom eigenen Boot-Guard verweigerte Konfiguration: ${JSON.stringify(findings)}`,
  );
});

test("src/config.js: numEnv-CODE-Fallback (kein Env gesetzt) ist kohaerent (kein fataler Boot-Refusal)", () => {
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const findings = spendCapCoherence({
    tenantDefaultCents: readCodeFallback(configSrc, "DEFAULT_TENANT_BUDGET_CENTS"),
    platformCapCents: eurToCents(readCodeFallback(configSrc, "MAX_BUDGET_EUR")),
    maxTariffCents: readCodeFallback(configSrc, "VOICE_TARIFF_DEFAULT_CENTS"),
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `src/config.js liefert einen vom eigenen Boot-Guard verweigerten CODE-Fallback: ${JSON.stringify(findings)}`,
  );
});

const WORST_CASE_TARIFF_CENTS_PER_MIN = 30;

test("KS-P6: der ausgelieferte Worst-Case-Tarif ist 30 ct/min - dieselbe Zahl in allen drei Quellen", () => {
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    readCodeFallback(configSrc, "VOICE_TARIFF_DEFAULT_CENTS"),
    WORST_CASE_TARIFF_CENTS_PER_MIN,
    "src/config.js numEnv-Fallback",
  );
  assert.equal(
    Number(readEnvValue(envExample, "VOICE_TARIFF_DEFAULT_CENTS")),
    WORST_CASE_TARIFF_CENTS_PER_MIN,
    ".env.example",
  );
  assert.equal(
    Number(readRenderValue(renderYaml, "VOICE_TARIFF_DEFAULT_CENTS")),
    WORST_CASE_TARIFF_CENTS_PER_MIN,
    "render.yaml",
  );
});

const RETENTION_DAYS_DEFAULT = 30;
const DIAGNOSTIC_RETENTION_DAYS_DEFAULT = 7;

test("LAW-15 (Mechanismus, gruen) - Retention-Defaults 30/7 stimmen in src/config.js und .env.example ueberein", () => {
  const configSource = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  assert.equal(readCodeFallback(configSource, "RETENTION_DAYS"), RETENTION_DAYS_DEFAULT);
  assert.equal(readCodeFallback(configSource, "DIAGNOSTIC_RETENTION_DAYS"), DIAGNOSTIC_RETENTION_DAYS_DEFAULT);
  assert.equal(Number(readEnvValue(envExample, "RETENTION_DAYS")), RETENTION_DAYS_DEFAULT);
  assert.equal(Number(readEnvValue(envExample, "DIAGNOSTIC_RETENTION_DAYS")), DIAGNOSTIC_RETENTION_DAYS_DEFAULT);
  assert.ok(
    DIAGNOSTIC_RETENTION_DAYS_DEFAULT < RETENTION_DAYS_DEFAULT,
    "die Diagnose-Frist ist die STRENGERE und damit immer die bindende (src/config.js)",
  );
});

function readBoolCodeFallback(text, envName) {
  const match = text.match(new RegExp(`boolEnv\\(\\s*"${envName}",[^)]*?fallback:\\s*(true|false)`));
  if (!match) throw new Error(`boolEnv-Fallback fuer ${envName} nicht in src/config.js gefunden`);
  return match[1] === "true";
}

const EL_INBOUND_SHIPPED_DEFAULT = false;

test("IE3-7: ELEVENLABS_INBOUND_ENABLED sagt in src/config.js, .env.example und render.yaml dasselbe (Blueprint gegen Code)", () => {
  const name = "ELEVENLABS_INBOUND_ENABLED";
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    readBoolCodeFallback(configSrc, name),
    EL_INBOUND_SHIPPED_DEFAULT,
    "src/config.js boolEnv-Fallback",
  );
  assert.equal(readEnvValue(envExample, name), String(EL_INBOUND_SHIPPED_DEFAULT), ".env.example");
  assert.equal(readRenderValue(renderYaml, name), String(EL_INBOUND_SHIPPED_DEFAULT), "render.yaml");
});

const BUDGET_WATCHDOG_SHIPPED_MS = 15000;

test("IE2: BUDGET_WATCHDOG_INTERVAL_MS sagt in src/config.js, .env.example und render.yaml dasselbe (Blueprint gegen Code)", () => {
  const name = "BUDGET_WATCHDOG_INTERVAL_MS";
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    readCodeFallback(configSrc, name),
    BUDGET_WATCHDOG_SHIPPED_MS,
    "src/config.js numEnv-Fallback",
  );
  assert.equal(Number(readEnvValue(envExample, name)), BUDGET_WATCHDOG_SHIPPED_MS, ".env.example");
  assert.equal(Number(readRenderValue(renderYaml, name)), BUDGET_WATCHDOG_SHIPPED_MS, "render.yaml");
});
