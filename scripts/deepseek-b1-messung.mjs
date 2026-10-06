#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const USER_BALANCE_PATH = "/user/balance";
const MODELS_PATH = "/models";

const MODEL_FLASH = "deepseek-v4-flash";
const MODEL_PRO = "deepseek-v4-pro";
const CONFIGURED_MODELS = Object.freeze([MODEL_FLASH, MODEL_PRO]);

const PRICE_SOURCE_URL = "https://api-docs.deepseek.com/quick_start/pricing";
const PRICE_SOURCE_RETRIEVED = "2026-08-08";
const DOC_PRICES_USD_PER_MTOK = Object.freeze({
  [MODEL_FLASH]: Object.freeze({ cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 }),
  [MODEL_PRO]: Object.freeze({ cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 }),
});

const DOCUMENTED_USAGE_KEYS = new Set([
  "prompt_tokens",
  "completion_tokens",
  "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens",
  "total_tokens",
  "completion_tokens_details",
  "completion_tokens_details.reasoning_tokens",
]);

const TOKENS_PER_MILLION = 1_000_000;
const REDACTED_PLACEHOLDER = "***";
const HTTP_OK = 200;
const HTTP_ERROR_THRESHOLD = 400;
const HTTP_TIMEOUT_MS = 60_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

const TAKE_MESSAGE_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "take_message",
    description:
      "Nimm eine Nachricht fuer den Besitzer entgegen, wenn der Anrufer das wuenscht " +
      "oder kein Termin bzw. keine sofortige Aktion moeglich ist.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Die Nachricht des Anrufers, kurz zusammengefasst." },
      },
      required: ["message"],
    },
  },
});

const ALL_BLOCK_LETTERS = Object.freeze(["A", "B", "C", "D", "E", "F"]);
const DEFAULT_BLOCKS = Object.freeze(["A", "B", "C", "D", "E"]);
const FIXED_BLOCK_ORDER = Object.freeze(["A", "B", "C", "E", "D", "F"]);
const COMPARABLE_BLOCKS = Object.freeze(["A", "B", "C", "E"]);

const DEFAULT_MAX_USD = 1.0;

const BLOCK_A_CALLS_PER_MODEL = 3;
const BLOCK_A_TARGET_CHARS = 800;
const BLOCK_A_MAX_TOKENS = 64;
const BLOCK_A_SEED_SENTENCE =
  "Bitte nenne in einem Satz einen Vorteil von horizontaler Skalierung verteilter Systeme. ";

const CACHE_PROMPT_MIN_CHARS = 12_000;
const CACHE_REPEATS_IMMEDIATE = 10;
const CACHE_CONTROL_AND_DELAYED_CALLS = 3;
const BLOCK_B_CALLS_PER_MODEL = CACHE_REPEATS_IMMEDIATE + CACHE_CONTROL_AND_DELAYED_CALLS;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CACHE_REPEAT_DELAY_MINUTES = 30;
const CACHE_REPEAT_DELAY_MS = CACHE_REPEAT_DELAY_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const CACHE_MAX_TOKENS = 16;
const CACHE_PROMPT_FIRST_SENTENCE = "Alpha-Start: Dies ist ein Testprotokoll fuer Cache-Verhalten. ";
const CACHE_PROMPT_FIRST_SENTENCE_ALT = "Zeta-Start: Dies ist ein Testprotokoll fuer Cache-Verhalten. ";
const CACHE_PROMPT_LAST_SENTENCE = "ENDE-A bitte antworte mit einem einzigen Wort.";
const CACHE_PROMPT_LAST_SENTENCE_ALT = "ZIEL-B bitte antworte mit einem einzigen Wort.";
const CACHE_PROMPT_FILLER_SENTENCE =
  "Dieser Fuelltext dient ausschliesslich dazu, den Prompt lang genug fuer eine Cache-Einheit zu machen. ";
const CACHE_PROMPT_BODY = CACHE_PROMPT_FILLER_SENTENCE.repeat(
  Math.ceil(CACHE_PROMPT_MIN_CHARS / CACHE_PROMPT_FILLER_SENTENCE.length),
);

const RESOLUTION_MAX_CALLS_PER_MODEL = 20;
const RESOLUTION_TARGET_CHARS = 24_000;
const RESOLUTION_MAX_TOKENS = 16;
const RESOLUTION_SEED_SENTENCE =
  "Dieser Testtext dient ausschliesslich der Aufloesungsmessung des Guthaben-Endpunkts. ";

const BALANCE_POLL_COUNT = 12;
const BALANCE_POLL_INTERVAL_SECONDS = 60;
const BALANCE_POLL_INTERVAL_MS = BALANCE_POLL_INTERVAL_SECONDS * MS_PER_SECOND;

const BLOCK_E_MAX_TOKENS = 64;
const BLOCK_E_PROMPT =
  "Ein Anrufer sagt: Bitte richten Sie aus, dass ich um 15 Uhr zurueckgerufen werden moechte. " +
  "Nutze bei Bedarf das verfuegbare Werkzeug, um eine Nachricht zu hinterlassen.";

function buildBlockECombos() {
  const combos = [];
  for (const stream of [false, true]) {
    for (const withTool of [false, true]) {
      for (const includeUsage of [false, true]) combos.push({ stream, withTool, includeUsage });
    }
  }
  return combos;
}
const BLOCK_E_COMBOS_COUNT = buildBlockECombos().length;

const ERROR_PROBE_MODEL = MODEL_FLASH;

const BLOCK_F_MODEL = MODEL_FLASH;
const BLOCK_F_CALLS = 24;
const HOURS_PER_BLOCK_F_STEP = 1;
const MINUTES_PER_HOUR = 60;
const BLOCK_F_INTERVAL_MS = HOURS_PER_BLOCK_F_STEP * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

const SEAM_TIMEOUT_MS = 3500;
const PERCENTILE_MEDIAN = 50;
const PERCENTILE_P95 = 95;
const PERCENTILE_MIN_RELIABLE_N = 20;
const INVALID_MAX_TOKENS = -1;

const OUTPUT_TOKEN_ESTIMATE_RATIO = 0.02;
const APPROX_INPUT_TOKENS_BLOCK_A =
  (BLOCK_A_TARGET_CHARS * BLOCK_A_CALLS_PER_MODEL * CONFIGURED_MODELS.length) / CHARS_PER_TOKEN_ESTIMATE;
const APPROX_INPUT_TOKENS_BLOCK_B =
  (CACHE_PROMPT_MIN_CHARS * BLOCK_B_CALLS_PER_MODEL * CONFIGURED_MODELS.length) / CHARS_PER_TOKEN_ESTIMATE;
const APPROX_INPUT_TOKENS_BLOCK_C =
  (RESOLUTION_TARGET_CHARS * RESOLUTION_MAX_CALLS_PER_MODEL * CONFIGURED_MODELS.length) / CHARS_PER_TOKEN_ESTIMATE;
const APPROX_INPUT_TOKENS_BLOCK_E =
  (BLOCK_E_PROMPT.length * BLOCK_E_COMBOS_COUNT * CONFIGURED_MODELS.length) / CHARS_PER_TOKEN_ESTIMATE;
const APPROX_INPUT_TOKENS_BLOCK_F = (BLOCK_A_TARGET_CHARS * BLOCK_F_CALLS) / CHARS_PER_TOKEN_ESTIMATE;

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_SECRET_CHECK_FAILED = 2;
const EXIT_BUDGET_STOPPED = 3;

const TOOL_CALL_PFAD_FAILED = "nicht ermittelbar (Aufruf gescheitert)";

function decimalPartsOf(str) {
  const trimmed = String(str).trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  return { negative, intPart: intPart || "0", fracPart };
}

const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$|^\.\d+$/;

function decimalStringToMinorUnits(str, scale) {
  const trimmed = String(str).trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (!DECIMAL_STRING_PATTERN.test(unsigned)) {
    throw new Error(`Ungueltiges Zahlenformat fuer Guthaben-Wert: "${str}"`);
  }
  const [intPart, fracPart = ""] = unsigned.split(".");
  const paddedFrac = fracPart.padEnd(scale, "0").slice(0, scale);
  const value = BigInt(`${intPart || "0"}${paddedFrac}`);
  return negative ? -value : value;
}

export function isParseableDecimalString(str) {
  const trimmed = String(str).trim();
  const unsigned = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
  return DECIMAL_STRING_PATTERN.test(unsigned);
}

export function minorUnitsDelta(beforeStr, afterStr) {
  try {
    const scale = Math.max(decimalPartsOf(beforeStr).fracPart.length, decimalPartsOf(afterStr).fracPart.length);
    const before = decimalStringToMinorUnits(beforeStr, scale);
    const after = decimalStringToMinorUnits(afterStr, scale);
    return { deltaMinorUnits: after - before, scale, parseError: null };
  } catch (err) {
    return {
      deltaMinorUnits: null,
      scale: null,
      parseError: `nicht parsebar: "${beforeStr}" -> "${afterStr}" (${err.message})`,
    };
  }
}

export function computeDeltasByCurrency(beforeInfos, afterInfos) {
  const result = {};
  for (const before of beforeInfos || []) {
    const after = (afterInfos || []).find((entry) => entry.currency === before.currency);
    if (!after) continue;
    result[before.currency] = minorUnitsDelta(before.total_balance, after.total_balance);
  }
  return result;
}

export function mapDeltasToRecords(deltas) {
  const out = {};
  for (const [currency, delta] of Object.entries(deltas)) {
    out[currency] = delta.parseError ?? { minor_units: delta.deltaMinorUnits.toString(), scale: delta.scale };
  }
  return out;
}

export function checkPromptEquation(usage) {
  const promptTokens = Number(usage.prompt_tokens || 0);
  const hit = Number(usage.prompt_cache_hit_tokens || 0);
  const miss = Number(usage.prompt_cache_miss_tokens || 0);
  return promptTokens === hit + miss;
}

export function checkTotalEquation(usage) {
  const total = Number(usage.total_tokens || 0);
  const prompt = Number(usage.prompt_tokens || 0);
  const completion = Number(usage.completion_tokens || 0);
  return total === prompt + completion;
}

export function estimateCostUsd(usage, prices, promptChars = 0) {
  const hit = Number(usage.prompt_cache_hit_tokens || 0);
  const hasMiss = usage.prompt_cache_miss_tokens != null;
  const hasPromptTokens = usage.prompt_tokens != null;
  let miss;
  let inputUnbekannt = false;
  if (hasMiss) {
    miss = Number(usage.prompt_cache_miss_tokens);
  } else if (hasPromptTokens) {
    miss = Math.max(Number(usage.prompt_tokens) - hit, 0);
  } else {
    miss = promptChars / CHARS_PER_TOKEN_ESTIMATE;
    inputUnbekannt = true;
  }
  const completion = Number(usage.completion_tokens || 0);
  const usd =
    (hit / TOKENS_PER_MILLION) * prices.cacheHit +
    (miss / TOKENS_PER_MILLION) * prices.cacheMiss +
    (completion / TOKENS_PER_MILLION) * prices.output;
  return { usd, inputUnbekannt };
}

export function collectKeyPaths(obj, prefix = "") {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix] : [];
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(currentPath, ...collectKeyPaths(value, currentPath));
    } else {
      paths.push(currentPath);
    }
  }
  return paths;
}

export function createRedactor(secrets) {
  const list = (secrets || []).filter(Boolean);
  if (list.length === 0) return (value) => value;
  return function redact(value) {
    if (typeof value === "string") {
      return list.reduce((text, secret) => text.split(secret).join(REDACTED_PLACEHOLDER), value);
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, v] of Object.entries(value)) out[key] = redact(v);
      return out;
    }
    return value;
  };
}

function deriveWrongApiKey(apiKey) {
  if (apiKey.length === 0) return apiKey;
  const lastChar = apiKey[apiKey.length - 1];
  const replacement = lastChar === "0" ? "1" : "0";
  return apiKey.slice(0, -1) + replacement;
}

function buildFillerPrompt(seedSentence, targetChars) {
  const repeatCount = Math.ceil(targetChars / seedSentence.length);
  return seedSentence.repeat(repeatCount).slice(0, targetChars);
}

const BLOCK_A_PROMPT = buildFillerPrompt(BLOCK_A_SEED_SENTENCE, BLOCK_A_TARGET_CHARS);
const RESOLUTION_PROMPT = buildFillerPrompt(RESOLUTION_SEED_SENTENCE, RESOLUTION_TARGET_CHARS);

export function buildCachePrompt(variant) {
  const first = variant === "control-b" ? CACHE_PROMPT_FIRST_SENTENCE_ALT : CACHE_PROMPT_FIRST_SENTENCE;
  const last = variant === "control-a" ? CACHE_PROMPT_LAST_SENTENCE_ALT : CACHE_PROMPT_LAST_SENTENCE;
  return `${first}${CACHE_PROMPT_BODY}${last}`;
}

export function sharedPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function parseArgs(argv) {
  const has = (name) => argv.includes(name);
  const kvPairs = argv
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const [key, ...rest] = a.slice(2).split("=");
      return [key, rest.join("=")];
    });
  const kv = Object.fromEntries(kvPairs);
  const blocks = kv.blocks
    ? kv.blocks.split(",").map((b) => b.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_BLOCKS];
  return {
    help: has("--help"),
    selftest: has("--selftest"),
    dryRun: has("--dry-run"),
    maxUsd: kv["max-usd"] !== undefined ? Number(kv["max-usd"]) : DEFAULT_MAX_USD,
    blocks,
  };
}

function validateOptions(options) {
  const unknown = options.blocks.filter((b) => !ALL_BLOCK_LETTERS.includes(b));
  if (unknown.length > 0) throw new Error(`Unbekannte Bloecke in --blocks: ${unknown.join(", ")}`);
  if (!Number.isFinite(options.maxUsd) || options.maxUsd <= 0) {
    throw new Error(`--max-usd muss eine positive Zahl sein, erhalten: ${options.maxUsd}`);
  }
}

const HELP_TEXT = `
DeepSeek B1-Messskript (Wegwerf-Skript, tasks/b1-spec.md)

Aufruf:
  node scripts/deepseek-b1-messung.mjs [Optionen]

Optionen:
  --dry-run         Plant alle Bloecke, gibt geschaetzte Kosten aus, KEIN Netzaufruf.
  --max-usd=<zahl>  Harte Kostenobergrenze (Vorgabe ${DEFAULT_MAX_USD}).
  --blocks=<liste>  Kommagetrennte Blockliste aus ${ALL_BLOCK_LETTERS.join(",")} (Vorgabe ${DEFAULT_BLOCKS.join(",")}).
                     F (Off-Peak, ${BLOCK_F_CALLS} Aufrufe) laeuft NUR bei ausdruecklicher Anforderung.
  --selftest        Prueft die reinen Hilfsfunktionen ohne Netz und ohne Schluessel.
  --help            Diese Hilfe.

Schluessel kommt aus DEEPSEEK_API_KEY in der Repo-.env (siehe tasks/b1-spec.md 6.1).
Ausgefuehrte Blockreihenfolge ist IMMER ${FIXED_BLOCK_ORDER.join(",")} (gefiltert auf --blocks),
unabhaengig von der Reihenfolge in --blocks: Block D lauft per Definition nach dem letzten
Aufruf der Bloecke A/B/C/E.
`;

function printHelp() {
  console.log(HELP_TEXT);
}

function runChecks(assertions) {
  let checked = 0;
  let failed = 0;
  for (const assertion of assertions) {
    checked += 1;
    try {
      assertion();
    } catch (err) {
      failed += 1;
      console.error(`  FEHLER: ${err.message}`);
    }
  }
  return { checked, failed };
}

function selftestMoneyDelta() {
  return runChecks([
    () => assert.strictEqual(minorUnitsDelta("10.00", "10.05").deltaMinorUnits, 5n),
    () => assert.strictEqual(minorUnitsDelta("10.5", "10.55").deltaMinorUnits, 5n),
    () => assert.strictEqual(minorUnitsDelta("10.05", "10.00").deltaMinorUnits, -5n),
    () => assert.strictEqual(minorUnitsDelta("10.00", "10.00").deltaMinorUnits, 0n),
    () =>
      assert.strictEqual(
        minorUnitsDelta("123456789012345.67", "123456789012346.67").deltaMinorUnits,
        100n,
      ),
    () => {
      assert.notStrictEqual(parseFloat("0.30") - parseFloat("0.10"), 0.2);
      assert.strictEqual(minorUnitsDelta("0.10", "0.30").deltaMinorUnits, 20n);
    },
    () => assert.strictEqual(minorUnitsDelta("10.00", "10.05").scale, 2),
    () => assert.strictEqual(minorUnitsDelta("10.00", "10.00000001").scale, 8),
    () => assert.ok(minorUnitsDelta("1,234.56", "1,234.55").parseError?.startsWith("nicht parsebar:")),
    () => assert.strictEqual(minorUnitsDelta("1,234.56", "1,234.55").deltaMinorUnits, null),
    () => assert.ok(minorUnitsDelta("", "10.00").parseError !== null),
  ]);
}

function selftestEquations() {
  return runChecks([
    () =>
      assert.strictEqual(
        checkPromptEquation({ prompt_tokens: 100, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 }),
        true,
      ),
    () =>
      assert.strictEqual(
        checkPromptEquation({ prompt_tokens: 100, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 50 }),
        false,
      ),
    () => assert.strictEqual(checkTotalEquation({ total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 }), true),
    () => assert.strictEqual(checkTotalEquation({ total_tokens: 999, prompt_tokens: 100, completion_tokens: 50 }), false),
  ]);
}

function selftestCurrencySelection() {
  const before = [
    { currency: "CNY", total_balance: "700.00" },
    { currency: "USD", total_balance: "100.00" },
  ];
  const after = [
    { currency: "CNY", total_balance: "693.00" },
    { currency: "USD", total_balance: "100.01" },
  ];
  const deltas = computeDeltasByCurrency(before, after);
  return runChecks([
    () => assert.strictEqual(deltas.USD.deltaMinorUnits, 1n),
    () => assert.strictEqual(deltas.CNY.deltaMinorUnits, -700n),
    () => assert.notStrictEqual(deltas.USD, deltas.CNY),
    () => assert.strictEqual(Object.keys(deltas).length, 2),
  ]);
}

function selftestRedaction() {
  const secret = "sk-realkeyXYZ";
  const wrongKey = deriveWrongApiKey(secret);
  const redact = createRedactor([secret, wrongKey]);
  return runChecks([
    () => assert.strictEqual(redact({ a: { b: secret } }).a.b, REDACTED_PLACEHOLDER),
    () => assert.strictEqual(redact(`Bearer ${secret} failed`), `Bearer ${REDACTED_PLACEHOLDER} failed`),
    () => assert.strictEqual(redact(wrongKey), REDACTED_PLACEHOLDER),
    () => assert.ok(!JSON.stringify(redact({ nested: [secret, wrongKey] })).includes(secret)),
  ]);
}

function selftestCostEstimate() {
  const prices = DOC_PRICES_USD_PER_MTOK[MODEL_FLASH];
  const withCacheFields = { prompt_cache_hit_tokens: 1_000_000, prompt_cache_miss_tokens: 0, completion_tokens: 1_000_000 };
  const withoutCacheFieldsButPromptTokens = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };
  const totallyUnknown = { completion_tokens: 0 };
  return runChecks([
    () => assert.strictEqual(estimateCostUsd(withCacheFields, prices).usd, prices.cacheHit + prices.output),
    () => assert.strictEqual(estimateCostUsd(withCacheFields, prices).inputUnbekannt, false),
    () =>
      assert.strictEqual(
        estimateCostUsd(withoutCacheFieldsButPromptTokens, prices).usd,
        prices.cacheMiss + prices.output,
      ),
    () => assert.strictEqual(estimateCostUsd(withoutCacheFieldsButPromptTokens, prices).inputUnbekannt, false),
    () => assert.ok(estimateCostUsd(totallyUnknown, prices, 4000).usd > 0),
    () => assert.strictEqual(estimateCostUsd(totallyUnknown, prices, 4000).inputUnbekannt, true),
  ]);
}

function selftestPrefixControls() {
  const base = buildCachePrompt("base");
  const controlA = buildCachePrompt("control-a");
  const controlB = buildCachePrompt("control-b");
  const expectedSharedWithA = CACHE_PROMPT_FIRST_SENTENCE.length + CACHE_PROMPT_BODY.length;
  return runChecks([
    () => assert.ok(base.length >= CACHE_PROMPT_MIN_CHARS),
    () => assert.strictEqual(sharedPrefixLength(base, controlA), expectedSharedWithA),
    () => assert.strictEqual(sharedPrefixLength(base, controlB), 0),
  ]);
}

function selftestKeyPaths() {
  const usage = {
    prompt_tokens: 100,
    completion_tokens_details: { reasoning_tokens: 5, cost_usd: "0.000123" },
  };
  const paths = collectKeyPaths(usage);
  return runChecks([
    () => assert.ok(paths.includes("prompt_tokens")),
    () => assert.ok(paths.includes("completion_tokens_details")),
    () => assert.ok(paths.includes("completion_tokens_details.reasoning_tokens")),
    () => assert.ok(paths.includes("completion_tokens_details.cost_usd")),
    () => assert.ok(!DOCUMENTED_USAGE_KEYS.has("completion_tokens_details.cost_usd")),
  ]);
}

function selftestOverallComparisonSign() {
  const increase = { USD: { deltaMinorUnits: 500n, scale: 2, parseError: null } };
  const decrease = { USD: { deltaMinorUnits: -500n, scale: 2, parseError: null } };
  const resultIncrease = buildOverallComparison(increase, 1.23);
  const resultDecrease = buildOverallComparison(decrease, 1.23);
  return runChecks([
    () => assert.ok(resultIncrease.USD.delta_usd_approx > 0),
    () => assert.ok(String(resultIncrease.USD.richtung).includes("erhoeht")),
    () => assert.ok(resultDecrease.USD.delta_usd_approx < 0),
    () => assert.ok(String(resultDecrease.USD.richtung).includes("gesunken")),
  ]);
}

function selftestBalanceResolutionClassification() {
  return runChecks([
    () =>
      assert.deepStrictEqual(classifyBalanceEntryForResolution({ currency: "USD", total_balance: "12.34" }), {
        currency: "USD",
        parseable: true,
        scale: 2,
      }),
    () =>
      assert.strictEqual(
        classifyBalanceEntryForResolution({ currency: "USD", total_balance: "1,234.56" }).parseable,
        false,
      ),
    () =>
      assert.strictEqual(
        classifyBalanceEntryForResolution({ currency: "USD", total_balance: "1,234.56" }).currency,
        "USD",
      ),
    () => assert.strictEqual(classifyBalanceEntryForResolution({ currency: "CNY", total_balance: "" }).parseable, false),
  ]);
}

function selftestDeltaOutcomeClassification() {
  const bewegt = { delta_minor_units: { USD: { minor_units: "5", scale: 2 } } };
  const nullAberMessbar = { delta_minor_units: { USD: { minor_units: "0", scale: 2 } } };
  const nichtMessbarGanz = { delta_minor_units: "nicht messbar" };
  const nichtMessbarParseFehler = { delta_minor_units: { USD: 'nicht parsebar: "1,234.56" -> "1,234.57"' } };
  return runChecks([
    () => assert.strictEqual(classifyDeltaOutcome(bewegt), "bewegt"),
    () => assert.strictEqual(classifyDeltaOutcome(nullAberMessbar), "null-aber-messbar"),
    () => assert.strictEqual(classifyDeltaOutcome(nichtMessbarGanz), "nicht-messbar"),
    () => assert.strictEqual(classifyDeltaOutcome(nichtMessbarParseFehler), "nicht-messbar"),
    () =>
      assert.strictEqual(
        classifyDeltaOutcome({
          delta_minor_units: { USD: { minor_units: "5", scale: 2 }, CNY: "nicht parsebar: x" },
        }),
        "bewegt",
      ),
  ]);
}

function selftestM1CrossCoverage() {
  const call = (model, stream) => ({ model_requested: model, stream, usage_raw: { prompt_tokens: 1 }, usage_keys: [] });
  const [flash, pro] = CONFIGURED_MODELS;
  const alleZellen = [];
  for (const m of CONFIGURED_MODELS) for (const s of [false, true]) alleZellen.push(call(m, s));
  const vollstaendig = Array.from({ length: M1_MIN_SAMPLES }, (unused, i) => alleZellen[i % alleZellen.length]);
  const zelleFehlt = vollstaendig.map((c) => (c.model_requested === pro && c.stream ? call(flash, true) : c));
  return runChecks([
    () => assert.strictEqual(typeof computeM1Answer(vollstaendig), "object"),
    () => assert.strictEqual(Object.keys(crossCoverage(alleZellen)).length, CONFIGURED_MODELS.length * OPERATING_MODES.length),
    () => assert.ok(Object.values(crossCoverage(alleZellen)).every((n) => n > 0)),
    () => assert.strictEqual(typeof computeM1Answer(zelleFehlt), "string"),
    () => assert.ok(computeM1Answer(zelleFehlt).includes(`${pro} x ${MODE_STREAM}`)),
    () => assert.ok(computeM1Answer([]).startsWith("nicht beantwortet")),
  ]);
}

function runSelftest() {
  const groups = [
    ["Ganzzahl-Delta aus Guthaben-Strings", selftestMoneyDelta],
    ["M1-Gleichungen (eq_prompt, eq_total)", selftestEquations],
    ["Waehrungswahl ueber currency", selftestCurrencySelection],
    ["Redaktionsfilter", selftestRedaction],
    ["Kostenschaetzung aus usage", selftestCostEstimate],
    ["Praefix-Kontrollen Block B", selftestPrefixControls],
    ["Rekursive Schluesselpfade (M1/F10)", selftestKeyPaths],
    ["Vorzeichen in buildOverallComparison (M2/F11)", selftestOverallComparisonSign],
    ["Aufloesungs-Klassifikation je Guthaben-Eintrag (S2-2)", selftestBalanceResolutionClassification],
    ["Delta-Ausgang bewegt/null-aber-messbar/nicht-messbar (S2-3)", selftestDeltaOutcomeClassification],
    ["M1-Kreuzabdeckung Modell x Betriebsart", selftestM1CrossCoverage],
  ];
  let checked = 0;
  let failed = 0;
  for (const [label, fn] of groups) {
    const result = fn();
    checked += result.checked;
    failed += result.failed;
    console.log(`[selftest] ${label}: ${result.checked} geprueft, ${result.failed} Fehler`);
  }
  console.log(`selftest: ${checked} Zusicherungen, ${failed} Fehler`);
  return { checked, failed };
}

function preflightKeyCheck() {
  const key = process.env.DEEPSEEK_API_KEY || "";
  if (!key) {
    console.error("DEEPSEEK_API_KEY fehlt in .env - Abbruch vor jedem Netzzugriff.");
    process.exit(EXIT_ERROR);
  }
  console.log(`DEEPSEEK_API_KEY gefunden, Laenge ${key.length} Zeichen (Wert wird nie ausgegeben).`);
  return key;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

async function queryBalance(apiKey) {
  const res = await fetch(`${DEEPSEEK_API_BASE}${USER_BALANCE_PATH}`, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function buildChatRequestBody({ model, prompt, maxTokens, stream, includeUsage, withTool }) {
  const body = { model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, stream };
  if (stream) body.stream_options = { include_usage: includeUsage };
  if (withTool) {
    body.tools = [TAKE_MESSAGE_TOOL];
    body.tool_choice = "auto";
  }
  return body;
}

async function postChatNonStream({ apiKey, body }) {
  const startedAt = performance.now();
  const res = await fetch(`${DEEPSEEK_API_BASE}${CHAT_COMPLETIONS_PATH}`, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const ttfbMs = performance.now() - startedAt;
  const text = await res.text();
  const totalMs = performance.now() - startedAt;
  return { status: res.status, ttfbMs, totalMs, json: safeJsonParse(text), rawText: text, chunks: [] };
}

async function readSseChunks(res, startedAt) {
  const chunks = [];
  let ttfbMs = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (ttfbMs === null) ttfbMs = performance.now() - startedAt;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex = buffer.indexOf("\n\n");
    while (sepIndex >= 0) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      if (rawEvent.trim()) chunks.push(rawEvent);
      sepIndex = buffer.indexOf("\n\n");
    }
  }
  return { chunks, ttfbMs };
}

async function postChatStream({ apiKey, body }) {
  const startedAt = performance.now();
  const res = await fetch(`${DEEPSEEK_API_BASE}${CHAT_COMPLETIONS_PATH}`, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    const totalMs = performance.now() - startedAt;
    return { status: res.status, ttfbMs: totalMs, totalMs, chunks: [], rawText: text, json: safeJsonParse(text) };
  }
  const { chunks, ttfbMs } = await readSseChunks(res, startedAt);
  const totalMs = performance.now() - startedAt;
  return { status: res.status, ttfbMs: ttfbMs ?? totalMs, totalMs, chunks, rawText: null, json: null };
}

function parseSseDataLines(rawEvent) {
  return rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
}

function forEachStreamEvent(chunks, cb) {
  for (const rawEvent of chunks) {
    for (const dataLine of parseSseDataLines(rawEvent)) {
      if (dataLine === "[DONE]") continue;
      const parsed = safeJsonParse(dataLine);
      if (!parsed) continue;
      cb(parsed);
    }
  }
}

function extractStreamSummary(chunks) {
  let usage = null;
  let model = null;
  forEachStreamEvent(chunks, (parsed) => {
    if (parsed.model) model = parsed.model;
    if (parsed.usage) usage = parsed.usage;
  });
  return { usage, model };
}

function extractToolCallInfo(message) {
  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const first = toolCalls[0];
  return {
    feldpfad: "choices[0].message.tool_calls[0].function.name",
    name: first?.function?.name ?? null,
    argumente: first?.function?.arguments ?? null,
  };
}

function extractStreamToolCallInfo(chunks) {
  let name = null;
  let argumentsText = "";
  let found = false;
  forEachStreamEvent(chunks, (parsed) => {
    const toolCalls = parsed?.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;
    found = true;
    for (const call of toolCalls) {
      if (call?.function?.name) name = call.function.name;
      if (call?.function?.arguments) argumentsText += call.function.arguments;
    }
  });
  if (!found) return null;
  return {
    feldpfad: "choices[0].delta.tool_calls[0].function.(name|arguments), ueber Chunks akkumuliert",
    name,
    argumente: argumentsText,
  };
}

function normalizeChatResult(raw, stream) {
  if (!stream) {
    return {
      status: raw.status,
      ttfbMs: raw.ttfbMs,
      totalMs: raw.totalMs,
      model: raw.json?.model ?? null,
      usage: raw.json?.usage ?? null,
      toolCall: extractToolCallInfo(raw.json?.choices?.[0]?.message),
    };
  }
  const summary = extractStreamSummary(raw.chunks);
  return {
    status: raw.status,
    ttfbMs: raw.ttfbMs,
    totalMs: raw.totalMs,
    model: summary.model,
    usage: summary.usage,
    toolCall: extractStreamToolCallInfo(raw.chunks),
  };
}

async function validateModelsAvailable(apiKey) {
  const res = await fetch(`${DEEPSEEK_API_BASE}${MODELS_PATH}`, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== HTTP_OK || !json) {
    throw new Error(`GET /models antwortete HTTP ${res.status} - Modellliste nicht abrufbar, Abbruch (fail-closed).`);
  }
  const availableIds = (json.data || []).map((entry) => entry.id);
  const missing = CONFIGURED_MODELS.filter((id) => !availableIds.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `Konfigurierte Modell-IDs fehlen in GET /models. Konfiguriert: [${CONFIGURED_MODELS.join(", ")}]. ` +
        `Verfuegbar: [${availableIds.join(", ")}]. Fehlend: [${missing.join(", ")}]. ` +
        `Die Preistabelle passt evtl. nicht mehr zum Modell - Abbruch statt stiller Fehlbuchung.`,
    );
  }
  console.log(`Modell-Vorpruefung OK: [${CONFIGURED_MODELS.join(", ")}] sind in GET /models vorhanden.`);
  return json.data;
}

async function appendJsonLine(outputDir, filename, obj, redact) {
  const line = `${JSON.stringify(redact(obj))}\n`;
  await appendFile(path.join(outputDir, filename), line, "utf8");
}

async function writeJsonFile(filePath, obj, redact) {
  await writeFile(filePath, JSON.stringify(redact(obj), null, 2), "utf8");
}

async function prepareOutputDir() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(REPO_ROOT, "data", "evidence", "deepseek-probe", runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

class BudgetExceededError extends Error {}

function createRunState({ outputDir, redact, maxUsd, apiKey, wrongApiKey }) {
  return {
    outputDir,
    redact,
    maxUsd,
    apiKey,
    wrongApiKey,
    cumEstUsd: 0,
    calls: [],
    failedCallCount: 0,
    firstBalanceInfos: null,
    lastBalanceInfos: null,
    balanceQueryCount: 0,
    balanceQuerySuccessCount: 0,
    blockDPollCount: 0,
    blockDSeries: [],
    resolutionObservedByCurrency: {},
    resolutionUnparseableByCurrency: {},
    resolutionFindings: null,
    comparableWindow: { start_utc: null, end_utc: null },
    modelsRaw: null,
    wrongKeyError: null,
    invalidParamError: null,
    budgetAbortReason: null,
  };
}

function assertBudgetNotExceeded(state) {
  if (state.cumEstUsd >= state.maxUsd) {
    throw new BudgetExceededError(
      `Kostenobergrenze erreicht: cum_est_usd=${state.cumEstUsd.toFixed(4)} USD >= --max-usd=${state.maxUsd}. ` +
        `Abbruch VOR dem naechsten Aufruf.`,
    );
  }
}

export function classifyBalanceEntryForResolution(entry) {
  if (!isParseableDecimalString(entry.total_balance)) {
    return { currency: entry.currency, parseable: false };
  }
  return { currency: entry.currency, parseable: true, scale: decimalPartsOf(entry.total_balance).fracPart.length };
}

async function queryBalanceLogged(state, { block, seq, purpose }) {
  const { status, json } = await queryBalance(state.apiKey);
  const balanceInfos = json?.balance_infos ?? [];
  const success = status === HTTP_OK && balanceInfos.length > 0;
  state.balanceQueryCount += 1;
  if (success) {
    state.balanceQuerySuccessCount += 1;
    if (!state.firstBalanceInfos) state.firstBalanceInfos = balanceInfos;
    state.lastBalanceInfos = balanceInfos;
    for (const entry of balanceInfos) {
      const classified = classifyBalanceEntryForResolution(entry);
      if (!classified.parseable) {
        state.resolutionUnparseableByCurrency[classified.currency] =
          (state.resolutionUnparseableByCurrency[classified.currency] || 0) + 1;
        continue;
      }
      if (!state.resolutionObservedByCurrency[classified.currency]) {
        state.resolutionObservedByCurrency[classified.currency] = new Set();
      }
      state.resolutionObservedByCurrency[classified.currency].add(classified.scale);
    }
  }
  if (block === "D") state.blockDPollCount += 1;
  await appendJsonLine(
    state.outputDir,
    "balance.jsonl",
    {
      ts_utc: new Date().toISOString(),
      block,
      seq,
      purpose,
      http_status: status,
      is_available: json?.is_available ?? null,
      balance_infos: balanceInfos,
    },
    state.redact,
  );
  return { balance_infos: balanceInfos, http_status: status };
}

async function recordCallError(state, { block, seq, status, body }) {
  await appendJsonLine(
    state.outputDir,
    "errors.jsonl",
    { ts_utc: new Date().toISOString(), block, seq, http_status: status, error_body_redacted: body },
    state.redact,
  );
}

async function writeStreamChunks(state, { block, seq, chunks }) {
  for (let i = 0; i < chunks.length; i += 1) {
    await appendJsonLine(
      state.outputDir,
      "stream-chunks.jsonl",
      { ts_utc: new Date().toISOString(), block, seq, chunk_index: i, raw_event: chunks[i] },
      state.redact,
    );
  }
}

function balanceMeasurable(before, after) {
  return (
    before.http_status === HTTP_OK &&
    after.http_status === HTTP_OK &&
    before.balance_infos.length > 0 &&
    after.balance_infos.length > 0
  );
}

function computeDeltaFields(before, after) {
  if (!balanceMeasurable(before, after)) return { delta_minor_units: "nicht messbar", currency: [] };
  const deltas = computeDeltasByCurrency(before.balance_infos, after.balance_infos);
  const delta_minor_units = mapDeltasToRecords(deltas);
  return { delta_minor_units, currency: Object.keys(delta_minor_units) };
}

function buildCallRecord({
  block,
  seq,
  modelRequested,
  normalized,
  stream,
  includeUsage,
  withTool,
  balanceBefore,
  balanceAfter,
  error,
  promptChars,
  variante,
}) {
  const usage = normalized?.usage ?? null;
  const { delta_minor_units, currency } = computeDeltaFields(balanceBefore, balanceAfter);
  const prices = DOC_PRICES_USD_PER_MTOK[modelRequested] ?? DOC_PRICES_USD_PER_MTOK[MODEL_PRO];
  const costEstimate = usage ? estimateCostUsd(usage, prices, promptChars) : { usd: 0, inputUnbekannt: false };
  return {
    ts_utc: new Date().toISOString(),
    block,
    seq,
    variante: variante ?? null,
    model_requested: modelRequested,
    model_returned: normalized?.model ?? null,
    stream,
    include_usage: includeUsage,
    tools: withTool,
    http_status: normalized?.status ?? null,
    fehler: error ? `${error.name}: ${error.message}` : null,
    ttfb_ms: normalized ? Math.round(normalized.ttfbMs) : null,
    total_ms: normalized ? Math.round(normalized.totalMs) : null,
    usage_raw: usage,
    usage_keys: usage ? collectKeyPaths(usage).sort() : [],
    eq_prompt: usage ? checkPromptEquation(usage) : null,
    eq_total: usage ? checkTotalEquation(usage) : null,
    tool_call_pfad: normalized?.toolCall?.feldpfad ?? null,
    tool_call_name: normalized?.toolCall?.name ?? null,
    tool_call_argumente: normalized?.toolCall?.argumente ?? null,
    balance_before_http_status: balanceBefore.http_status,
    balance_after_http_status: balanceAfter.http_status,
    balance_before: balanceBefore.balance_infos,
    balance_after: balanceAfter.balance_infos,
    delta_minor_units,
    currency,
    est_usd_from_doc_prices: costEstimate.usd,
    est_usd_input_unbekannt: costEstimate.inputUnbekannt,
    cum_est_usd: 0,
  };
}

async function performChatMeasurement(state, args) {
  assertBudgetNotExceeded(state);
  const { block, seq, model, prompt, maxTokens, stream, includeUsage, withTool, variante, apiKeyOverride } = args;
  const apiKey = apiKeyOverride ?? state.apiKey;
  const balanceBefore = await queryBalanceLogged(state, { block, seq, purpose: "vor_aufruf" });
  const body = buildChatRequestBody({ model, prompt, maxTokens, stream, includeUsage, withTool });

  let raw = null;
  let error = null;
  try {
    raw = stream ? await postChatStream({ apiKey, body }) : await postChatNonStream({ apiKey, body });
  } catch (err) {
    error = err;
  }

  const balanceAfter = await queryBalanceLogged(state, { block, seq, purpose: error ? "nach_fehlversuch" : "nach_aufruf" });

  if (raw) {
    if (stream && raw.chunks.length > 0) await writeStreamChunks(state, { block, seq, chunks: raw.chunks });
    if (raw.status >= HTTP_ERROR_THRESHOLD) {
      await recordCallError(state, { block, seq, status: raw.status, body: raw.json ?? raw.rawText });
    }
  }

  const normalized = raw ? normalizeChatResult(raw, stream) : null;
  const record = buildCallRecord({
    block,
    seq,
    modelRequested: model,
    normalized,
    stream,
    includeUsage: stream ? includeUsage : null,
    withTool,
    balanceBefore,
    balanceAfter,
    error,
    promptChars: prompt.length,
    variante,
  });
  if (error) state.failedCallCount += 1;
  state.cumEstUsd += record.est_usd_from_doc_prices;
  record.cum_est_usd = state.cumEstUsd;
  await appendJsonLine(state.outputDir, "calls.jsonl", record, state.redact);
  state.calls.push(record);
  return record;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runErrorProbes(state) {
  const wrongKeyRecord = await performChatMeasurement(state, {
    block: "ERR",
    seq: "wrong_key",
    model: ERROR_PROBE_MODEL,
    prompt: BLOCK_A_PROMPT,
    maxTokens: BLOCK_A_MAX_TOKENS,
    stream: false,
    includeUsage: null,
    withTool: false,
    apiKeyOverride: state.wrongApiKey,
  });
  state.wrongKeyError = { http_status: wrongKeyRecord.http_status, fehlerkoerper_hinweis: "siehe errors.jsonl (block=ERR, seq=wrong_key)" };

  const invalidParamRecord = await performChatMeasurement(state, {
    block: "ERR",
    seq: "invalid_param",
    model: ERROR_PROBE_MODEL,
    prompt: BLOCK_A_PROMPT,
    maxTokens: INVALID_MAX_TOKENS,
    stream: false,
    includeUsage: null,
    withTool: false,
  });
  state.invalidParamError = {
    http_status: invalidParamRecord.http_status,
    fehlerkoerper_hinweis: "siehe errors.jsonl (block=ERR, seq=invalid_param)",
  };

  console.log(
    `M5-Fehlerproben: falscher Schluessel -> HTTP ${wrongKeyRecord.http_status}, ` +
      `ungueltiger Parameter -> HTTP ${invalidParamRecord.http_status}.`,
  );
}

async function runBlockA(state) {
  let count = 0;
  for (const model of CONFIGURED_MODELS) {
    for (let i = 1; i <= BLOCK_A_CALLS_PER_MODEL; i += 1) {
      await performChatMeasurement(state, {
        block: "A",
        seq: count + 1,
        model,
        prompt: BLOCK_A_PROMPT,
        maxTokens: BLOCK_A_MAX_TOKENS,
        stream: false,
        includeUsage: null,
        withTool: false,
      });
      count += 1;
    }
  }
  console.log(`Block A: ${count} Aufrufe abgeschlossen.`);
}

function cacheCallArgs({ model, seq, contentVariant, labelVariante }) {
  return {
    block: "B",
    seq,
    model,
    prompt: buildCachePrompt(contentVariant),
    maxTokens: CACHE_MAX_TOKENS,
    stream: false,
    includeUsage: null,
    withTool: false,
    variante: labelVariante,
  };
}

function hasCacheHit(record) {
  return Number(record.usage_raw?.prompt_cache_hit_tokens || 0) > 0;
}

async function runBlockB(state) {
  let seq = 0;
  let cacheHits = 0;
  for (const model of CONFIGURED_MODELS) {
    for (let i = 1; i <= CACHE_REPEATS_IMMEDIATE; i += 1) {
      seq += 1;
      const label = i === 1 ? "base" : "wiederholung";
      const args = cacheCallArgs({ model, seq, contentVariant: "base", labelVariante: label });
      if (hasCacheHit(await performChatMeasurement(state, args))) cacheHits += 1;
    }
  }
  await delay(CACHE_REPEAT_DELAY_MS);
  for (const model of CONFIGURED_MODELS) {
    seq += 1;
    const nach30min = cacheCallArgs({ model, seq, contentVariant: "base", labelVariante: "nach-30min" });
    if (hasCacheHit(await performChatMeasurement(state, nach30min))) cacheHits += 1;
    seq += 1;
    const kontrolleA = cacheCallArgs({ model, seq, contentVariant: "control-a", labelVariante: "kontrolle-a" });
    if (hasCacheHit(await performChatMeasurement(state, kontrolleA))) cacheHits += 1;
    seq += 1;
    const kontrolleB = cacheCallArgs({ model, seq, contentVariant: "control-b", labelVariante: "kontrolle-b" });
    if (hasCacheHit(await performChatMeasurement(state, kontrolleB))) cacheHits += 1;
  }
  console.log(`Block B: ${seq} Aufrufe, ${cacheHits} mit Cache-Treffer (prompt_cache_hit_tokens > 0).`);
}

export function classifyDeltaOutcome(record) {
  const delta = record.delta_minor_units;
  if (typeof delta !== "object" || delta === null) return "nicht-messbar";
  const measurable = Object.values(delta).filter(
    (entry) => entry && typeof entry === "object" && entry.minor_units !== undefined,
  );
  if (measurable.length === 0) return "nicht-messbar";
  return measurable.some((entry) => entry.minor_units !== "0") ? "bewegt" : "null-aber-messbar";
}

async function runBlockC(state) {
  let seq = 0;
  const resolutionFindings = {};
  for (const model of CONFIGURED_MODELS) {
    let movedAtIteration = null;
    let messbareIterationen = 0;
    let nichtMessbareIterationen = 0;
    for (let i = 1; i <= RESOLUTION_MAX_CALLS_PER_MODEL; i += 1) {
      seq += 1;
      const record = await performChatMeasurement(state, {
        block: "C",
        seq,
        model,
        prompt: RESOLUTION_PROMPT,
        maxTokens: RESOLUTION_MAX_TOKENS,
        stream: false,
        includeUsage: null,
        withTool: false,
      });
      const outcome = classifyDeltaOutcome(record);
      if (outcome === "nicht-messbar") nichtMessbareIterationen += 1;
      else messbareIterationen += 1;
      if (outcome === "bewegt") {
        movedAtIteration = i;
        break;
      }
    }
    resolutionFindings[model] = {
      bewegt_bei_iteration: movedAtIteration,
      messbare_iterationen: messbareIterationen,
      nicht_messbare_iterationen: nichtMessbareIterationen,
    };
  }
  state.resolutionFindings = resolutionFindings;
  console.log(`Block C: ${seq} Aufrufe. Guthaben-Bewegung je Modell: ${JSON.stringify(resolutionFindings)}.`);
}

async function runBlockD(state) {
  let previousInfos = null;
  for (let i = 1; i <= BALANCE_POLL_COUNT; i += 1) {
    const result = await queryBalanceLogged(state, { block: "D", seq: i, purpose: "periodisch" });
    const deltaSincePrevious = previousInfos
      ? mapDeltasToRecords(computeDeltasByCurrency(previousInfos, result.balance_infos))
      : null;
    state.blockDSeries.push({
      ts_utc: new Date().toISOString(),
      http_status: result.http_status,
      balance_infos: result.balance_infos,
      delta_seit_vorherigem_minor_units: deltaSincePrevious,
    });
    if (result.balance_infos.length > 0) previousInfos = result.balance_infos;
    if (i < BALANCE_POLL_COUNT) await delay(BALANCE_POLL_INTERVAL_MS);
  }
  const minutesSpanned = ((BALANCE_POLL_COUNT - 1) * BALANCE_POLL_INTERVAL_MS) / MS_PER_SECOND / SECONDS_PER_MINUTE;
  console.log(`Block D: ${BALANCE_POLL_COUNT} Guthaben-Abfragen ueber ${minutesSpanned} Minuten, 0 Chat-Aufrufe.`);
}

async function runBlockE(state) {
  let seq = 0;
  for (const model of CONFIGURED_MODELS) {
    for (const combo of buildBlockECombos()) {
      seq += 1;
      await performChatMeasurement(state, {
        block: "E",
        seq,
        model,
        prompt: BLOCK_E_PROMPT,
        maxTokens: BLOCK_E_MAX_TOKENS,
        stream: combo.stream,
        includeUsage: combo.includeUsage,
        withTool: combo.withTool,
      });
    }
  }
  console.log(
    `Block E: ${seq} Aufrufe (Stream x Werkzeug x include_usage, je Modell: ${CONFIGURED_MODELS.join(", ")}).`,
  );
}

async function runBlockF(state) {
  for (let i = 1; i <= BLOCK_F_CALLS; i += 1) {
    await performChatMeasurement(state, {
      block: "F",
      seq: i,
      model: BLOCK_F_MODEL,
      prompt: BLOCK_A_PROMPT,
      maxTokens: BLOCK_A_MAX_TOKENS,
      stream: false,
      includeUsage: null,
      withTool: false,
    });
    if (i < BLOCK_F_CALLS) await delay(BLOCK_F_INTERVAL_MS);
  }
  console.log(`Block F: ${BLOCK_F_CALLS} Aufrufe ueber 24 Stunden, einer je Stunde, Modell ${BLOCK_F_MODEL}.`);
}

const BLOCK_RUNNERS = Object.freeze({ A: runBlockA, B: runBlockB, C: runBlockC, D: runBlockD, E: runBlockE, F: runBlockF });

async function runRequestedBlocks(state, options) {
  const toRun = FIXED_BLOCK_ORDER.filter((b) => options.blocks.includes(b));
  const notRequested = FIXED_BLOCK_ORDER.filter((b) => !options.blocks.includes(b));
  for (const block of notRequested) {
    console.log(`Block ${block}: uebersprungen, Grund: nicht in --blocks angefordert.`);
  }
  const lastComparable = [...toRun].reverse().find((b) => COMPARABLE_BLOCKS.includes(b));
  for (let i = 0; i < toRun.length; i += 1) {
    const block = toRun[i];
    if (COMPARABLE_BLOCKS.includes(block) && !state.comparableWindow.start_utc) {
      state.comparableWindow.start_utc = new Date().toISOString();
    }
    try {
      await BLOCK_RUNNERS[block](state);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.log(`ABBRUCH: ${err.message}`);
        state.budgetAbortReason = err.message;
        for (const skipped of toRun.slice(i + 1)) {
          console.log(`Block ${skipped}: uebersprungen, Grund: Budget-Abbruch vor diesem Block.`);
        }
        break;
      }
      throw err;
    }
    if (block === lastComparable) state.comparableWindow.end_utc = new Date().toISOString();
  }
}

const M1_MIN_SAMPLES = 30;

const MODE_STREAM = "stream";
const MODE_NON_STREAM = "nicht-stream";
const OPERATING_MODES = Object.freeze([MODE_STREAM, MODE_NON_STREAM]);

function operatingModeLabel(call) {
  return call.stream ? MODE_STREAM : MODE_NON_STREAM;
}

function crossCoverage(withUsage) {
  const zellen = {};
  for (const model of CONFIGURED_MODELS) {
    for (const mode of OPERATING_MODES) zellen[`${model} x ${mode}`] = 0;
  }
  for (const c of withUsage) zellen[`${c.model_requested} x ${operatingModeLabel(c)}`] += 1;
  return zellen;
}

function computeM1Answer(calls) {
  const withUsage = calls.filter((c) => c.usage_raw);
  const jeModell = {};
  for (const model of CONFIGURED_MODELS) jeModell[model] = withUsage.filter((c) => c.model_requested === model).length;
  const jeBetriebsart = {};
  for (const mode of OPERATING_MODES) jeBetriebsart[mode] = 0;
  for (const c of withUsage) jeBetriebsart[operatingModeLabel(c)] += 1;
  const zellen = crossCoverage(withUsage);
  const leereZellen = Object.entries(zellen).filter(([, n]) => n === 0).map(([k]) => k);
  if (withUsage.length < M1_MIN_SAMPLES || leereZellen.length > 0) {
    return (
      `nicht beantwortet, Grund: ${withUsage.length} Antworten mit usage (Minimum ${M1_MIN_SAMPLES}), ` +
      `Abdeckung je Modell x Betriebsart: ${JSON.stringify(zellen)}` +
      (leereZellen.length > 0 ? `, ohne jede Antwort: ${leereZellen.join(", ")}` : "")
    );
  }
  const eqPromptViolations = withUsage.filter((c) => c.eq_prompt === false);
  const eqTotalViolations = withUsage.filter((c) => c.eq_total === false);
  const unexpectedKeys = new Set();
  for (const c of withUsage) for (const k of c.usage_keys) if (!DOCUMENTED_USAGE_KEYS.has(k)) unexpectedKeys.add(k);
  return {
    samples: withUsage.length,
    abdeckung_je_modell: jeModell,
    abdeckung_je_betriebsart: jeBetriebsart,
    abdeckung_modell_x_betriebsart: zellen,
    eq_prompt_violations: eqPromptViolations.length,
    eq_prompt_beispiel: eqPromptViolations[0]?.usage_raw ?? null,
    eq_total_violations: eqTotalViolations.length,
    eq_total_beispiel: eqTotalViolations[0]?.usage_raw ?? null,
    unerwartete_usage_keys: [...unexpectedKeys],
  };
}

export function buildOverallComparison(deltas, formulaSumUsd) {
  const out = {};
  for (const [currency, delta] of Object.entries(deltas)) {
    if (delta.parseError) {
      out[currency] = `nicht vergleichbar (${delta.parseError})`;
      continue;
    }
    if (currency !== "USD") {
      out[currency] = "nicht vergleichbar (Waehrung ungleich USD, kein Wechselkurs im Skript - Spec Nicht-Ziele)";
      continue;
    }
    const deltaUsdApprox = Number(delta.deltaMinorUnits) / 10 ** delta.scale;
    const ausgabeUsd = -deltaUsdApprox;
    const abweichungProzent = formulaSumUsd === 0 ? null : ((ausgabeUsd - formulaSumUsd) / formulaSumUsd) * 100;
    out[currency] = {
      delta_usd_approx: deltaUsdApprox,
      richtung:
        deltaUsdApprox > 0
          ? "guthaben_erhoeht (vermutlich Aufladung waehrend des Laufs)"
          : deltaUsdApprox < 0
            ? "guthaben_gesunken (Ausgabe)"
            : "unveraendert",
      formel_summe_usd: formulaSumUsd,
      abweichung_prozent: abweichungProzent,
    };
  }
  return out;
}

function computeM2Answer(state) {
  const balanceFailures = state.balanceQueryCount - state.balanceQuerySuccessCount;
  if (state.balanceQuerySuccessCount === 0) {
    return (
      `nicht beantwortet, Grund: Guthaben-Endpunkt lieferte in ${balanceFailures} von ` +
      `${state.balanceQueryCount} Abfragen keinen Erfolg`
    );
  }
  if (!state.firstBalanceInfos || !state.lastBalanceInfos) {
    return "nicht beantwortet, Grund: keine verwertbaren Guthaben-Abfragen protokolliert";
  }
  const overallDeltas = computeDeltasByCurrency(state.firstBalanceInfos, state.lastBalanceInfos);
  const formulaSumUsd = state.calls.reduce((sum, c) => sum + (c.est_usd_from_doc_prices || 0), 0);
  const aufloesungJeWaehrung = {};
  for (const [currency, scales] of Object.entries(state.resolutionObservedByCurrency)) {
    aufloesungJeWaehrung[currency] = [...scales].sort((a, b) => a - b);
  }
  return {
    aufloesung_nachkommastellen_je_waehrung_beobachtet: aufloesungJeWaehrung,
    aufloesung_nicht_parsebar_je_waehrung: { ...state.resolutionUnparseableByCurrency },
    einzelaufruf_bewegt_bei_iteration_je_modell: state.resolutionFindings ?? "nicht beantwortet, Grund: Block C nicht gelaufen",
    block_d_abfragen: state.blockDPollCount,
    nachbuchungs_zeitreihe: state.blockDSeries.length > 0 ? state.blockDSeries : "nicht beantwortet, Grund: Block D nicht gelaufen",
    guthaben_abfragen_erfolgreich: state.balanceQuerySuccessCount,
    guthaben_abfragen_gesamt: state.balanceQueryCount,
    gesamt_delta_je_waehrung: mapDeltasToRecords(overallDeltas),
    hinweis_delta_0:
      '"unterhalb der Aufloesung ODER noch nicht gebucht" - NIE als "kostet nichts" zu lesen (bindende Auswertungsregel)',
    formel_summe_usd: formulaSumUsd,
    vergleich_delta_gegen_formel: buildOverallComparison(overallDeltas, formulaSumUsd),
  };
}

function cachePriceDifferenceUsd(calls, model) {
  const prices = DOC_PRICES_USD_PER_MTOK[model];
  let allMissUsd = 0;
  let measuredUsd = 0;
  for (const c of calls) {
    const hit = Number(c.usage_raw?.prompt_cache_hit_tokens || 0);
    const miss = Number(c.usage_raw?.prompt_cache_miss_tokens || 0);
    allMissUsd += ((hit + miss) / TOKENS_PER_MILLION) * prices.cacheMiss;
    measuredUsd += (hit / TOKENS_PER_MILLION) * prices.cacheHit + (miss / TOKENS_PER_MILLION) * prices.cacheMiss;
  }
  return { alles_fehltreffer_usd: allMissUsd, gemessener_split_usd: measuredUsd, differenz_usd: allMissUsd - measuredUsd };
}

function summarizeCacheCalls(calls, model) {
  if (calls.length === 0) {
    return "nicht beantwortet, Grund: 0 Aufrufe fuer dieses Modell (Budget-Abbruch oder Block nicht gelaufen)";
  }
  const successCalls = calls.filter((c) => c.http_status === HTTP_OK && c.usage_raw);
  if (successCalls.length === 0) {
    return `nicht beantwortet, Grund: ${calls.length} Aufrufe, aber keiner lieferte usage (HTTP-Fehler oder unvollstaendige Antwort)`;
  }
  const hitTokens = successCalls.map((c) => Number(c.usage_raw?.prompt_cache_hit_tokens || 0));
  const anyHit = hitTokens.some((v) => v > 0);
  return {
    aufrufe: calls.length,
    erfolgreiche_aufrufe: successCalls.length,
    hit_tokens_je_aufruf: hitTokens,
    treffer_beobachtet: anyHit,
    hinweis: anyHit
      ? null
      : "0 Treffer - gueltiges Ergebnis, Cache ist laut Doku best-effort (nur unter erfolgreichen Aufrufen bewertet)",
    preisdifferenz: cachePriceDifferenceUsd(successCalls, model),
  };
}

function computeM3Answer(calls) {
  const blockBCalls = calls.filter((c) => c.block === "B");
  if (blockBCalls.length === 0) return "nicht beantwortet, Grund: Block B nicht gelaufen";
  const perModel = {};
  for (const model of CONFIGURED_MODELS) {
    perModel[model] = summarizeCacheCalls(
      blockBCalls.filter((c) => c.model_requested === model),
      model,
    );
  }
  return perModel;
}

function computeM4Answer(state, options) {
  if (!options.blocks.includes("F")) {
    return (
      `nicht beantwortet, Grund: Block F nicht angefordert (optional). Doku-Vorpruefung: ` +
      `${PRICE_SOURCE_URL} nennt aktuell kein Rabattfenster, abgerufen ${PRICE_SOURCE_RETRIEVED}.`
    );
  }
  const blockF = state.calls.filter((c) => c.block === "F");
  if (blockF.length === 0) return "nicht beantwortet, Grund: Block F angefordert, aber keine Aufrufe protokolliert";
  const stundenwerte = blockF.map((c) => c.est_usd_from_doc_prices);
  return { stundenwerte, groesster_unterschied_usd: Math.max(...stundenwerte) - Math.min(...stundenwerte) };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length));
  return sortedValues[index];
}

function computeDistribution(durations) {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const overThreshold = sorted.filter((v) => v > SEAM_TIMEOUT_MS).length;
  const p95Unreliable = sorted.length < PERCENTILE_MIN_RELIABLE_N;
  return {
    n: sorted.length,
    min_ms: sorted[0],
    median_ms: percentile(sorted, PERCENTILE_MEDIAN),
    p95_ms: p95Unreliable ? null : percentile(sorted, PERCENTILE_P95),
    p95_unzuverlaessig_n_zu_klein: p95Unreliable,
    max_ms: sorted[sorted.length - 1],
    anteil_ueber_3500ms: overThreshold / sorted.length,
  };
}

function computeM5Answer(state) {
  const successCalls = state.calls.filter((c) => c.http_status === HTTP_OK && c.total_ms != null);
  const failedCalls = state.calls.length - successCalls.length;
  if (successCalls.length === 0) return "nicht beantwortet, Grund: keine erfolgreichen Aufrufe mit Zeitmessung vorhanden";

  const jeModellUndBetriebsart = {};
  for (const model of CONFIGURED_MODELS) {
    for (const mode of ["stream", "nicht-stream"]) {
      const subset = successCalls.filter((c) => c.model_requested === model && operatingModeLabel(c) === mode);
      if (subset.length > 0) jeModellUndBetriebsart[`${model}__${mode}`] = computeDistribution(subset.map((c) => c.total_ms));
    }
  }

  return {
    je_modell_und_betriebsart: jeModellUndBetriebsart,
    gepoolt_alle_erfolgreichen_aufrufe: computeDistribution(successCalls.map((c) => c.total_ms)),
    ausgeschlossen_gescheiterte_aufrufe: failedCalls,
    falscher_schluessel: state.wrongKeyError ?? "nicht beantwortet, Grund: Fehlerprobe nicht ausgefuehrt",
    ungueltiger_parameter: state.invalidParamError ?? "nicht beantwortet, Grund: Fehlerprobe nicht ausgefuehrt",
  };
}

function computeM6Answer(state) {
  if (state.calls.length === 0) return "nicht beantwortet, Grund: keine Aufrufe protokolliert";
  const comparable = state.calls.filter((c) => c.http_status === HTTP_OK);
  if (comparable.length === 0) {
    return `nicht beantwortet, Grund: 0 von ${state.calls.length} Aufrufen mit HTTP 200`;
  }
  const pairs = comparable.map((c) => ({ requested: c.model_requested, returned: c.model_returned }));
  const mismatches = pairs.filter((p) => p.requested !== p.returned);
  return {
    anzahl_aufrufe: state.calls.length,
    vergleichbare_aufrufe: comparable.length,
    nicht_vergleichbar: state.calls.length - comparable.length,
    abweichungen: mismatches.length,
    beispiel_abweichung: mismatches[0] ?? null,
    models_endpoint_raw: state.modelsRaw,
  };
}

function buildM7ComboRecord(call) {
  const failed = call.http_status !== HTTP_OK;
  return {
    stream: call.stream,
    include_usage: call.include_usage,
    tools: call.tools,
    http_status: call.http_status,
    usage_vorhanden: !!call.usage_raw,
    usage_raw: call.usage_raw,
    tool_call_pfad: failed
      ? TOOL_CALL_PFAD_FAILED
      : call.tools
        ? (call.tool_call_pfad ?? "kein Werkzeugaufruf beobachtet (Feld im Antwortobjekt fehlt)")
        : "nicht angefordert (tools:false)",
    tool_call_name: call.tool_call_name ?? null,
    tool_call_argumente: call.tool_call_argumente ?? null,
  };
}

function computeM7Answer(calls) {
  const blockE = calls.filter((c) => c.block === "E");
  if (blockE.length === 0) return "nicht beantwortet, Grund: Block E nicht gelaufen";
  const perCall = blockE.map(buildM7ComboRecord);
  const requiredCombos = [
    { stream: false, tools: false },
    { stream: false, tools: true },
    { stream: true, tools: false },
    { stream: true, tools: true },
  ];
  const unresolved = requiredCombos.filter((req) => {
    const matches = perCall.filter((c) => c.stream === req.stream && c.tools === req.tools);
    return matches.length === 0 || matches.every((c) => c.tool_call_pfad === TOOL_CALL_PFAD_FAILED);
  });
  if (unresolved.length > 0) {
    return (
      `nicht beantwortet, Grund: ${unresolved.length} von 4 Stream x Werkzeug-Kombinationen ` +
      `ohne Pfad oder ausdrueckliches Fehlen (${JSON.stringify(unresolved)})`
    );
  }
  return { kombinationen: perCall };
}

function computeM8Answer(calls) {
  const withReasoning = calls.filter((c) => Number(c.usage_raw?.completion_tokens_details?.reasoning_tokens || 0) > 0);
  if (withReasoning.length === 0) {
    return "bei diesem Aufrufprofil nie beobachtet (completion_tokens_details.reasoning_tokens war in allen Aufrufen 0 oder fehlend)";
  }
  const example = withReasoning[0];
  const reasoningTokens = Number(example.usage_raw.completion_tokens_details.reasoning_tokens);
  const completionTokens = Number(example.usage_raw.completion_tokens);
  const promptTokens = Number(example.usage_raw.prompt_tokens);
  const totalTokens = Number(example.usage_raw.total_tokens);
  const eqEnthalten = totalTokens === promptTokens + completionTokens;
  const eqAdditiv = totalTokens === promptTokens + completionTokens + reasoningTokens;
  let zugehoerigkeit;
  if (eqEnthalten && !eqAdditiv) {
    zugehoerigkeit = "enthalten (total_tokens-Gleichung stimmt ohne Zusatzaddition)";
  } else if (eqAdditiv && !eqEnthalten) {
    zugehoerigkeit = "additiv (Gleichung stimmt nur mit reasoning_tokens addiert)";
  } else {
    zugehoerigkeit =
      `nicht entscheidbar, Grund: beide Gleichungen stimmen gleichermassen ` +
      `(enthalten=${eqEnthalten}, additiv=${eqAdditiv})`;
  }
  return {
    beispiele: withReasoning.length,
    reasoning_tokens_beispiel: reasoningTokens,
    completion_tokens_beispiel: completionTokens,
    prompt_tokens_beispiel: promptTokens,
    total_tokens_beispiel: totalTokens,
    zugehoerigkeit,
  };
}

function buildSummary(state, options) {
  return {
    lauf_meta: {
      utc_fenster_vergleichbare_bloecke: state.comparableWindow,
      schluessel_kontext: { laenge: state.apiKey.length, wert: REDACTED_PLACEHOLDER },
      modell_ids: CONFIGURED_MODELS,
      preistabelle: { quelle: PRICE_SOURCE_URL, abgerufen: PRICE_SOURCE_RETRIEVED, preise_usd_je_mtok: DOC_PRICES_USD_PER_MTOK },
      guthaben_zusammensetzung_start: state.firstBalanceInfos,
      max_usd: state.maxUsd,
      cum_est_usd_final: state.cumEstUsd,
      budget_abbruch: state.budgetAbortReason,
      fehlgeschlagene_aufrufe: state.failedCallCount,
      angeforderte_bloecke: options.blocks,
    },
    M1: { frage: "Stimmen die Verbrauchsfelder mit der Doku ueberein?", answer: computeM1Answer(state.calls) },
    M2: { frage: "Taugt das Guthaben als Quelle fuer tatsaechlich abgebucht?", answer: computeM2Answer(state) },
    M3: { frage: "Cache-Verhalten und Preisdifferenz, reproduzierbar?", answer: computeM3Answer(state.calls) },
    M4: { frage: "Off-Peak-Preisfenster?", answer: computeM4Answer(state, options) },
    M5: { frage: "Latenz, Timeout und Fehlerform am Seam?", answer: computeM5Answer(state) },
    M6: { frage: "Ist die geantwortete Modell-ID die angeforderte?", answer: computeM6Answer(state) },
    M7: { frage: "Streaming, Werkzeuge und usage im Stream?", answer: computeM7Answer(state.calls) },
    M8: { frage: "Denk-Token: enthalten oder additiv?", answer: computeM8Answer(state.calls) },
  };
}

function isHollowAnswer(value) {
  if (typeof value === "string") return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isHollowAnswer);
  if (value && typeof value === "object") {
    const entries = Object.values(value);
    if (entries.length === 0) return true;
    return entries.every(isHollowAnswer);
  }
  return false;
}

function printConsoleSummary(summary) {
  console.log("\n=== B1-Zusammenfassung ===");
  for (const key of ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"]) {
    const entry = summary[key];
    let short;
    if (typeof entry.answer === "string") short = entry.answer;
    else if (isHollowAnswer(entry.answer)) short = "nicht beantwortet (Antwortobjekt ohne verwertbaren Inhalt, siehe summary.json)";
    else short = "beantwortet (siehe summary.json)";
    console.log(`${key}: ${short}`);
  }
}

async function keyLeakCheck(outputDir, secrets) {
  let entries;
  try {
    entries = await readdir(outputDir, { withFileTypes: true });
  } catch (err) {
    return { status: "unueberprueft", grund: `Verzeichnis nicht lesbar: ${err.message}`, dateien_geprueft: 0, bytes_geprueft: 0 };
  }
  const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  let filesChecked = 0;
  let bytesChecked = 0;
  for (const file of files) {
    let content;
    try {
      content = await readFile(path.join(outputDir, file), "utf8");
    } catch {
      continue;
    }
    filesChecked += 1;
    bytesChecked += Buffer.byteLength(content, "utf8");
    for (const secret of secrets.filter(Boolean)) {
      if (content.includes(secret)) {
        return { status: "DIRTY", grund: `Fund in ${file}`, dateien_geprueft: filesChecked, bytes_geprueft: bytesChecked };
      }
    }
  }
  if (filesChecked === 0) {
    return {
      status: "unueberprueft",
      grund: "0 Dateien im Ausgabeverzeichnis - ein Null-Befund ist nicht von einer kaputten Probe zu unterscheiden",
      dateien_geprueft: 0,
      bytes_geprueft: 0,
    };
  }
  return { status: "clean", dateien_geprueft: filesChecked, bytes_geprueft: bytesChecked };
}

function estimateBlockCostUsd(approxInputTokens) {
  const prices = DOC_PRICES_USD_PER_MTOK[MODEL_PRO];
  const inputCost = (approxInputTokens / TOKENS_PER_MILLION) * prices.cacheMiss;
  const outputCost = ((approxInputTokens * OUTPUT_TOKEN_ESTIMATE_RATIO) / TOKENS_PER_MILLION) * prices.output;
  return inputCost + outputCost;
}

function plannedCallsForBlock(block) {
  switch (block) {
    case "A":
      return {
        count: BLOCK_A_CALLS_PER_MODEL * CONFIGURED_MODELS.length,
        note: "3 je Modell",
        estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_A),
      };
    case "B":
      return {
        count: BLOCK_B_CALLS_PER_MODEL * CONFIGURED_MODELS.length,
        note: "10 Wiederholungen + 1 nach 30min + 2 Praefix-Kontrollen, je Modell",
        estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_B),
      };
    case "C":
      return {
        count: RESOLUTION_MAX_CALLS_PER_MODEL * CONFIGURED_MODELS.length,
        note: "Obergrenze - bricht frueher ab, sobald die Guthaben-Einheit bewegt wurde",
        estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_C),
      };
    case "D":
      return { count: 0, note: `${BALANCE_POLL_COUNT} Guthaben-Abfragen, keine Chat-Aufrufe`, estUsd: 0 };
    case "E":
      return {
        count: BLOCK_E_COMBOS_COUNT * CONFIGURED_MODELS.length,
        note: "Stream x Werkzeug x include_usage, je Modell",
        estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_E),
      };
    case "F":
      return {
        count: BLOCK_F_CALLS,
        note: `ein Aufruf je Stunde ueber 24h, Modell ${BLOCK_F_MODEL}`,
        estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_F),
      };
    default:
      return { count: 0, note: "unbekannter Block", estUsd: 0 };
  }
}

function printBlockPlan(options) {
  const ordered = FIXED_BLOCK_ORDER.filter((b) => options.blocks.includes(b));
  console.log(`Geplante Bloecke (feste Ausfuehrungsreihenfolge, gefiltert auf --blocks): ${ordered.join(", ")}`);
  let totalCost = 0;
  for (const block of ordered) {
    const plan = plannedCallsForBlock(block);
    totalCost += plan.estUsd;
    console.log(`  Block ${block}: ${plan.count} Aufrufe geplant (${plan.note}) - geschaetzt ~${plan.estUsd.toFixed(4)} USD`);
  }
  console.log(`Geschaetzte Gesamtkosten: ~${totalCost.toFixed(4)} USD (Obergrenze --max-usd=${options.maxUsd}).`);
  if (totalCost > options.maxUsd) {
    console.log("WARNUNG: geschaetzte Kosten liegen ueber --max-usd - der Lauf wuerde vorzeitig abbrechen.");
  }
}

function printDryRunPlan(options) {
  console.log("Trockenlauf: 0 Netzaufrufe.");
  printBlockPlan(options);
  console.log("Trockenlauf beendet - keine Ausgabedatei wurde angelegt.");
}

async function main(options) {
  if (options.help) {
    printHelp();
    return;
  }
  if (options.selftest) {
    const result = runSelftest();
    process.exit(result.failed === 0 ? EXIT_OK : EXIT_ERROR);
    return;
  }

  validateOptions(options);

  if (options.dryRun) {
    printDryRunPlan(options);
    process.exit(EXIT_OK);
    return;
  }

  const apiKey = preflightKeyCheck();
  const wrongApiKey = deriveWrongApiKey(apiKey);
  const redact = createRedactor([apiKey, wrongApiKey]);
  const outputDir = await prepareOutputDir();
  console.log(`Ausgabeverzeichnis: ${outputDir}`);
  console.log("Scharfer Lauf - Plan:");
  printBlockPlan(options);

  const state = createRunState({ outputDir, redact, maxUsd: options.maxUsd, apiKey, wrongApiKey });

  let runError = null;
  let leakResult = { status: "unueberprueft", grund: "keyLeakCheck nicht erreicht", dateien_geprueft: 0, bytes_geprueft: 0 };
  try {
    state.modelsRaw = await validateModelsAvailable(apiKey);
    await runErrorProbes(state);
    await runRequestedBlocks(state, options);
  } catch (err) {
    runError = err;
    console.error(`Lauf abgebrochen: ${err.name}: ${err.message}`);
  } finally {
    const summary = buildSummary(state, options);
    if (runError) summary.lauf_meta.abbruch_grund = `${runError.name}: ${runError.message}`;
    await writeJsonFile(path.join(state.outputDir, "summary.json"), summary, redact);
    printConsoleSummary(summary);
    leakResult = await keyLeakCheck(state.outputDir, [apiKey, wrongApiKey]);
    console.log(
      `key_leak_check: ${leakResult.status} (${leakResult.dateien_geprueft} Dateien, ${leakResult.bytes_geprueft} Bytes geprueft)` +
        (leakResult.grund ? ` - ${leakResult.grund}` : ""),
    );
  }

  if (leakResult.status !== "clean") process.exit(EXIT_SECRET_CHECK_FAILED);
  if (runError) process.exit(EXIT_ERROR);
  process.exit(state.budgetAbortReason ? EXIT_BUDGET_STOPPED : EXIT_OK);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const options = parseArgs(process.argv.slice(2));
  main(options).catch((err) => {
    console.error(`Unerwarteter Fehler ausserhalb der Lauf-Absicherung: ${err.name}: ${err.message}\n${err.stack}`);
    process.exit(EXIT_ERROR);
  });
}
