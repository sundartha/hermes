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
//
// PAY-25 (Buchhaltung, kein eigener Test): die Katalog-ID verlangt eine Env-Doku-Kohaerenz
// fuer VOICE_TARIFF_DOMESTIC_PREFIXES. Sie ENTFAELLT - die Vorwahlliste ist eine
// Code-Konstante in src/config.js, keine Env-Variable; .env.example dokumentiert korrekt
// VOICE_TARIFF_DOMESTIC_CENTS/_DEFAULT_CENTS/_FULL_COST_FLOOR_CENTS und bewusst kein
// _PREFIXES (Re-Baseline tasks/i18n-tests/19-w2-baseline.md §3.7). Es gibt hier also keine
// zweite Quelle, gegen die sich etwas pruefen liesse.
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

// Liest den numEnv(..., { fallback: N, ... })-Wert fuer eine gegebene Env-Var direkt aus
// dem src/config.js-Quelltext (kein Import, s. Datei-Kommentar oben). [^)] statt . matcht
// ueber Zeilenumbrueche (config.js bricht die numEnv-Optionen auf mehrere Zeilen um).
// \s* nach der Klammer: config.js bricht laengere numEnv-Aufrufe hinter "numEnv(" um
// (z.B. DIAGNOSTIC_RETENTION_DAYS) - ohne das findet der Parser den Fallback nicht.
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
  });
  assert.equal(
    findings.some((f) => f.fatal),
    false,
    `src/config.js liefert einen vom eigenen Boot-Guard verweigerten CODE-Fallback: ${JSON.stringify(findings)}`,
  );
});

// KS-P9/E10: die frueher hier gepinnte zweite Kohaerenz-Achse ("hoechste abgeleitete
// Plan-Decke < MAX_BUDGET_EUR*100", `plan_cap_inert`) ist ersatzlos entfallen - die
// Plattform-Zahl bindet nicht mehr, also kann sie keine Plan-Decke inert machen. Die drei
// spendCapCoherence-Doku-Tests oben bleiben und pruefen jetzt A0/B.

// KS-P6/E1: der ausgelieferte Worst-Case-Minutentarif. Die drei Kohaerenztests oben pruefen
// nur, dass die Zahl den eigenen Boot-Guard nicht ausloest - WELCHE Zahl ausgeliefert wird,
// prueft keiner. Genau dort ist der Wert stehengeblieben: der Owner hat am 2026-07-29 auf 30
// entschieden und live gesetzt, das Repo lieferte weiter 300 aus (Faktor 10 zwischen Betrieb
// und Repo, unbemerkt). Der Satz bemisst seit KS-P5a BEIDES: die Vorab-Reserve und die
// Plan-Kostendecke.
// Datei-Read statt config-Import (Muster LAW-15 unten, Begruendung im Dateikopf): ein Import
// wuerde die ambiente .env/Shell auswerten und waere umgebungsabhaengig-flaky.
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

// LAW-15 (tasks/i18n-tests/09-recht-und-compliance.md): die Retention-Defaults. Die
// "fail-closed bei 0"-Haelfte ist am KONSUMENTEN bereits gepinnt (diagnostic-retention
// P2b-05/12/24/31, retention.test.js "RETENTION_DAYS=0") - ungepinnt war nur die ZAHL
// selbst: Code-Fallback und .env.example sind zwei Quellen, die auseinanderlaufen
// koennen (dieselbe Klasse Defekt wie die Budget-Achsen oben).
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

// boolEnv-Analogon zu readCodeFallback: liest den ausgelieferten CODE-Default einer
// Boolean-Env direkt aus dem src/config.js-Quelltext (kein config-Import - der wuerde die
// ambiente Shell auswerten, Lehre test-base-env-drift).
function readBoolCodeFallback(text, envName) {
  const match = text.match(new RegExp(`boolEnv\\(\\s*"${envName}",[^)]*?fallback:\\s*(true|false)`));
  if (!match) throw new Error(`boolEnv-Fallback fuer ${envName} nicht in src/config.js gefunden`);
  return match[1] === "true";
}

// IP3: der Prototyp einer zweiten Wahrheit ueber EINEN Wahrheitswert. render.yaml trug
// "true" samt Kommentar "Default true", waehrend der boolEnv-Fallback seit dem
// 422-Befund (2026-08-04) false ist und .env.example false dokumentiert. Ein erneutes
// Anwenden des Blueprints haette den belegt defekten Inbound-Handoff scharf gestellt -
// der Anrufer hoert dann nur die Fehleransage. Der Schalter selbst verschwindet spaeter
// mit dem Assistant-Pfad; bis dahin sagen alle drei Quellen dasselbe.
const INBOUND_HANDOFF_SHIPPED_DEFAULT = false;

test("IP3: TELNYX_INBOUND_HANDOFF_ENABLED sagt in src/config.js, .env.example und render.yaml dasselbe (Blueprint gegen Code)", () => {
  const name = "TELNYX_INBOUND_HANDOFF_ENABLED";
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.equal(
    readBoolCodeFallback(configSrc, name),
    INBOUND_HANDOFF_SHIPPED_DEFAULT,
    "src/config.js boolEnv-Fallback",
  );
  assert.equal(readEnvValue(envExample, name), String(INBOUND_HANDOFF_SHIPPED_DEFAULT), ".env.example");
  assert.equal(readRenderValue(renderYaml, name), String(INBOUND_HANDOFF_SHIPPED_DEFAULT), "render.yaml");
});

// IE2: derselbe Riegel eine Zeile darueber, fuer den Takt der Geld-Wache. Die Zahl IST die
// bewusst akzeptierte Ueberziehung zwischen zwei Runden (hoechstens ein Takt Gespraechszeit
// je laufendem Leg) - liefe render.yaml auseinander, waere im Betrieb eine andere
// Ueberziehung scharf als die dokumentierte und begruendete. Dieselben drei Leser wie oben
// (G5 statt einer vierten Kopie).
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
