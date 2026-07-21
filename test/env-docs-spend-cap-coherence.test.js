// P3 (Boot-Guards Konfig-Kohaerenz): reiner Datei-Read von .env.example + render.yaml
// + src/config.js, die dokumentierten/ausgelieferten Budget-Achsen durch
// spendCapCoherence geschickt. Verhindert die stille Rueckkehr genau des Defekts, den
// diese Phase behebt (.env.example dokumentierte vor P3 eine Konfiguration, die der
// eigene Boot-Guard verweigert). Praezedenz: test/checkout-stale-stripe-customer-env-docs
// .test.js (Datei-Read statt Server-/Config-Import). Keine Server-/Config-Imports noetig
// ausser der reinen eurToCents-Rundung und der reinen spendCapCoherence-Wahrheitstabelle.
//
// DRITTE Quelle (Review-Fix Runde 1): der numEnv-CODE-FALLBACK in src/config.js (greift,
// wenn der Betreiber DEFAULT_TENANT_BUDGET_CENTS/MAX_BUDGET_EUR gar nicht setzt) ist eine
// EIGENE Zahl, unabhaengig von .env.example/render.yaml - ein Deploy ganz ohne diese
// Env-Vars haette den alten Fallback 1000 gegen platformSpendCapCents-Fallback 800
// gefahren (Boot-Refusal trotz "richtiger" Doku). Datei-Read statt config.js-Import:
// ein Import wuerde die ambiente Shell-Env auswerten (Lehre test-base-env-drift), der
// Datei-Read prueft die geschriebene Konstante selbst.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eurToCents } from "../src/config.js";
import { spendCapCoherence, planCapInertFindings } from "../src/boot-guard.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { CATALOG_SLUGS } from "../src/plans.js";
import { planCapCents } from "../src/billing/plan-caps.js";

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

// Liest den numEnv(..., { fallback: N, ... })-Wert fuer eine gegebene Env-Var direkt aus
// dem src/config.js-Quelltext (kein Import, s. Datei-Kommentar oben). [^)] statt . matcht
// ueber Zeilenumbrueche (config.js bricht die numEnv-Optionen auf mehrere Zeilen um).
function readCodeFallback(text, envName) {
  const m = text.match(new RegExp(`numEnv\\("${envName}",[^)]*?fallback:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!m) throw new Error(`numEnv-Fallback fuer ${envName} nicht in src/config.js gefunden`);
  return Number(m[1]);
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

// Review-Fix Runde 1 (S1/S2): der numEnv-CODE-FALLBACK selbst - greift, wenn ein Host
// DEFAULT_TENANT_BUDGET_CENTS/MAX_BUDGET_EUR ueberhaupt nicht setzt (weder .env noch
// Render-Dashboard). Rot vor diesem Fix: der alte Fallback 1000 verlor gegen den
// platformSpendCapCents-Fallback 800 (MAX_BUDGET_EUR-Fallback 8) - der ausgelieferte
// CODE-Default selbst bestand den eigenen Boot-Guard nicht.
test("src/config.js: numEnv-CODE-Fallback (kein Env gesetzt) ist kohaerent (kein fataler Boot-Refusal)", () => {
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const findings = spendCapCoherence({
    tenantDefaultCents: readCodeFallback(configSrc, "DEFAULT_TENANT_BUDGET_CENTS"),
    platformCapCents: eurToCents(readCodeFallback(configSrc, "MAX_BUDGET_EUR")),
    maxTariffCents: readCodeFallback(configSrc, "VOICE_TARIFF_DEFAULT_CENTS"),
    maxCallDurationS: MAX_CALL_DURATION_CAP_S,
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `src/config.js liefert einen vom eigenen Boot-Guard verweigerten CODE-Fallback: ${JSON.stringify(findings)}`,
  );
});

// LCT P6 / Punkt 0 (bewusst NICHT Teil dieser Phase): die zweite, NEUE Kohaerenz-Achse
// "hoechste abgeleitete Plan-Decke < MAX_BUDGET_EUR*100" (planCapInertFindings) gegen
// dieselben drei Quellen. ANDERS als die drei Tests oben ist diese Achse HEUTE BEWUSST
// NICHT erfuellt: der dokumentierte/CODE-Fallback-Wert von MAX_BUDGET_EUR bleibt bei 8
// (800 ct) - das Anheben ist Entscheidung 8/PLAN-BUDGET-AXES, ausdruecklich NICHT Teil von
// P6 (der LIVE-Wert auf Render ist bereits 30, nur Repo/Code-Fallback nicht). Diese Tests
// PINNEN die bekannte Luecke (fatal===true) statt sie zu verstecken - sie sind der
// Stolperdraht: sobald MAX_BUDGET_EUR in einer Quelle auf >=10 angehoben wird, muss der
// jeweilige Test auf `false` gedreht werden (Muster T-P3-13, boot-failclosed.test.js).
function planCapFatalFor(platformCapCents) {
  return planCapInertFindings({
    slugs: CATALOG_SLUGS,
    platformCapCents,
    capForSlug: (slug) => planCapCents(slug, { voiceCapRateCentsPerMin: 6 }),
  }).some((f) => f.fatal);
}

test("LCT P6 (bekannte Luecke, gepinnt): .env.example MAX_BUDGET_EUR=8 ist plan_cap_inert (business)", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const platformCapCents = eurToCents(Number(readEnvValue(envExample, "MAX_BUDGET_EUR")));
  assert.equal(
    planCapFatalFor(platformCapCents),
    true,
    "Diese Assertion MUSS auf false gedreht werden, sobald .env.example MAX_BUDGET_EUR>=10 dokumentiert (Punkt 0 aufgeloest)",
  );
});

test("LCT P6 (bekannte Luecke, gepinnt): render.yaml MAX_BUDGET_EUR=8 ist plan_cap_inert (business)", () => {
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  const platformCapCents = eurToCents(Number(readRenderValue(renderYaml, "MAX_BUDGET_EUR")));
  assert.equal(
    planCapFatalFor(platformCapCents),
    true,
    "Diese Assertion MUSS auf false gedreht werden, sobald render.yaml MAX_BUDGET_EUR>=10 dokumentiert (Punkt 0 aufgeloest)",
  );
});

test("LCT P6 (bekannte Luecke, gepinnt): src/config.js numEnv-CODE-Fallback MAX_BUDGET_EUR=8 ist plan_cap_inert (business)", () => {
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const platformCapCents = eurToCents(readCodeFallback(configSrc, "MAX_BUDGET_EUR"));
  assert.equal(
    planCapFatalFor(platformCapCents),
    true,
    "Diese Assertion MUSS auf false gedreht werden, sobald der CODE-Fallback >=10 ist (Punkt 0 aufgeloest)",
  );
});
