import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eurToCents } from "../src/config.js";
import { spendCapCoherence } from "../src/boot-guard.js";
import { gebauteKonfiguration } from "./gemeinsam/gebaute-konfiguration.js";

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

function gebauteStandardwerte(felderJeVariable) {
  const ohneVariablen = Object.fromEntries(Object.keys(felderJeVariable).map((name) => [name, undefined]));
  const gebaut = gebauteKonfiguration(ohneVariablen, Object.values(felderJeVariable));
  return Object.fromEntries(Object.entries(felderJeVariable).map(([name, feld]) => [name, gebaut[feld]]));
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
  const standard = gebauteStandardwerte({
    DEFAULT_TENANT_BUDGET_CENTS: "billing.defaultTenantBudgetCents",
    MAX_BUDGET_EUR: "billing.platformSpendCapCents",
    VOICE_TARIFF_DEFAULT_CENTS: "billing.voiceTariffDefaultCents",
  });
  const findings = spendCapCoherence({
    tenantDefaultCents: standard.DEFAULT_TENANT_BUDGET_CENTS,
    platformCapCents: standard.MAX_BUDGET_EUR,
    maxTariffCents: standard.VOICE_TARIFF_DEFAULT_CENTS,
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `src/config.js liefert einen vom eigenen Boot-Guard verweigerten CODE-Fallback: ${JSON.stringify(findings)}`,
  );
});

const WORST_CASE_TARIFF_CENTS_PER_MIN = 30;

test("KS-P6: der ausgelieferte Worst-Case-Tarif ist 30 ct/min - dieselbe Zahl in allen drei Quellen", () => {
  const standard = gebauteStandardwerte({ VOICE_TARIFF_DEFAULT_CENTS: "billing.voiceTariffDefaultCents" });
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    standard.VOICE_TARIFF_DEFAULT_CENTS,
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
  const standard = gebauteStandardwerte({
    RETENTION_DAYS: "privacy.retentionDays",
    DIAGNOSTIC_RETENTION_DAYS: "privacy.diagnosticRetentionDays",
  });
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  assert.equal(standard.RETENTION_DAYS, RETENTION_DAYS_DEFAULT);
  assert.equal(standard.DIAGNOSTIC_RETENTION_DAYS, DIAGNOSTIC_RETENTION_DAYS_DEFAULT);
  assert.equal(Number(readEnvValue(envExample, "RETENTION_DAYS")), RETENTION_DAYS_DEFAULT);
  assert.equal(Number(readEnvValue(envExample, "DIAGNOSTIC_RETENTION_DAYS")), DIAGNOSTIC_RETENTION_DAYS_DEFAULT);
  assert.ok(
    DIAGNOSTIC_RETENTION_DAYS_DEFAULT < RETENTION_DAYS_DEFAULT,
    "die Diagnose-Frist ist die STRENGERE und damit immer die bindende (src/config.js)",
  );
});

const EL_INBOUND_SHIPPED_DEFAULT = false;

test("IE3-7: ELEVENLABS_INBOUND_ENABLED sagt in src/config.js, .env.example und render.yaml dasselbe (Blueprint gegen Code)", () => {
  const name = "ELEVENLABS_INBOUND_ENABLED";
  const standard = gebauteStandardwerte({ [name]: "voice.elevenLabsInbound.enabled" });
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    standard[name],
    EL_INBOUND_SHIPPED_DEFAULT,
    "src/config.js boolEnv-Fallback",
  );
  assert.equal(readEnvValue(envExample, name), String(EL_INBOUND_SHIPPED_DEFAULT), ".env.example");
  assert.equal(readRenderValue(renderYaml, name), String(EL_INBOUND_SHIPPED_DEFAULT), "render.yaml");
});

const BUDGET_WATCHDOG_SHIPPED_MS = 15000;

test("IE2: BUDGET_WATCHDOG_INTERVAL_MS sagt in src/config.js, .env.example und render.yaml dasselbe (Blueprint gegen Code)", () => {
  const name = "BUDGET_WATCHDOG_INTERVAL_MS";
  const standard = gebauteStandardwerte({ [name]: "safety.budgetWatchdogIntervalMs" });
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    standard[name],
    BUDGET_WATCHDOG_SHIPPED_MS,
    "src/config.js numEnv-Fallback",
  );
  assert.equal(Number(readEnvValue(envExample, name)), BUDGET_WATCHDOG_SHIPPED_MS, ".env.example");
  assert.equal(Number(readRenderValue(renderYaml, name)), BUDGET_WATCHDOG_SHIPPED_MS, "render.yaml");
});
