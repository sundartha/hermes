// P3 (Boot-Guards Konfig-Kohaerenz): reiner Datei-Read von .env.example + render.yaml,
// die dokumentierten Budget-Achsen durch spendCapCoherence geschickt. Verhindert die
// stille Rueckkehr genau des Defekts, den diese Phase behebt (.env.example dokumentierte
// vor P3 eine Konfiguration, die der eigene Boot-Guard verweigert). Praezedenz:
// test/checkout-stale-stripe-customer-env-docs.test.js (Datei-Read statt Server-/
// Config-Import). Keine Server-/Config-Imports noetig ausser der reinen eurToCents-
// Rundung und der reinen spendCapCoherence-Wahrheitstabelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eurToCents } from "../src/config.js";
import { spendCapCoherence } from "../src/boot-guard.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

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

test(".env.example: ausgelieferte Budget-Achsen sind kohaerent (kein fataler Boot-Refusal)", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const findings = spendCapCoherence({
    tenantDefaultCents: Number(readEnvValue(envExample, "DEFAULT_TENANT_BUDGET_CENTS")),
    platformCapCents: eurToCents(Number(readEnvValue(envExample, "MAX_BUDGET_EUR"))),
    maxTariffCents: Number(readEnvValue(envExample, "VOICE_TARIFF_DEFAULT_CENTS")),
    maxCallDurationS: MAX_CALL_DURATION_CAP_S,
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
    maxCallDurationS: MAX_CALL_DURATION_CAP_S,
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `render.yaml dokumentiert eine vom eigenen Boot-Guard verweigerte Konfiguration: ${JSON.stringify(findings)}`,
  );
});
