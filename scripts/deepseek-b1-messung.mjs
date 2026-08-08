#!/usr/bin/env node
// B1 (tasks/b1-spec.md): Wegwerf-Messskript gegen die echte DeepSeek-API. Beantwortet
// acht falsifizierbare Messfragen (M1-M8) darueber, was der API-Schluessel tatsaechlich
// abgebucht bekommt - NICHT ueber die Form der Preistabelle (das war die verworfene
// Praemisse, s. Spec Abschnitt 1).
//
// Kein Produktionspfad: von nichts importiert, importiert selbst nichts aus src/.
// Nebenlaeufigkeit 1, KEIN Retry - ein Fehlversuch wird gezaehlt, nicht geheilt (Spec 6.2).
//
// Aufruf:
//   node scripts/deepseek-b1-messung.mjs --selftest
//   node scripts/deepseek-b1-messung.mjs --dry-run
//   node scripts/deepseek-b1-messung.mjs [--blocks=A,B,C,D,E] [--max-usd=1.00]
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
// Gleicher Mechanismus wie src/config.js:15 - aber Env-Zugriff bewusst NICHT ueber
// src/config.js (Begruendung: tasks/b1-spec.md Abschnitt 6.1, Punkte 1-3).
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

// ============================================================================
// Verifizierte API-Fakten (Momentaufnahme, abgerufen 2026-08-08). Jede Zahl hier
// gilt NUR fuer diesen Abrufzeitpunkt - deshalb validiert das Skript die Modell-IDs
// beim scharfen Lauf frisch gegen GET /models (fail-closed, s. validateModelsAvailable).
// ============================================================================

// Quelle: https://api-docs.deepseek.com/api/create-chat-completion (abgerufen 2026-08-08)
const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
// Quelle: https://api-docs.deepseek.com/api/get-user-balance (abgerufen 2026-08-08)
const USER_BALANCE_PATH = "/user/balance";
// Quelle: https://api-docs.deepseek.com/api/list-models (abgerufen 2026-08-08)
const MODELS_PATH = "/models";

// Quelle: https://api-docs.deepseek.com/quick_start/pricing (abgerufen 2026-08-08)
const MODEL_FLASH = "deepseek-v4-flash";
const MODEL_PRO = "deepseek-v4-pro";
const CONFIGURED_MODELS = Object.freeze([MODEL_FLASH, MODEL_PRO]);

// Preise in USD je 1 Million Token, dieselbe Quelle wie oben, abgerufen 2026-08-08.
// Kein Off-Peak-/Rabattfenster auf der Seite dokumentiert (-> M4 optional).
const PRICE_SOURCE_URL = "https://api-docs.deepseek.com/quick_start/pricing";
const PRICE_SOURCE_RETRIEVED = "2026-08-08";
const DOC_PRICES_USD_PER_MTOK = Object.freeze({
  [MODEL_FLASH]: Object.freeze({ cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 }),
  [MODEL_PRO]: Object.freeze({ cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 }),
});

// usage-Objekt laut Doku (Quelle wie oben): 5 flache Felder + ein verschachteltes
// completion_tokens_details mit reasoning_tokens (-> M8).
const DOCUMENTED_USAGE_KEYS = new Set([
  "prompt_tokens",
  "completion_tokens",
  "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens",
  "total_tokens",
  "completion_tokens_details",
]);

// Fehlercodes laut https://api-docs.deepseek.com/quick_start/error_codes (abgerufen 2026-08-08):
// 400 invalid request body, 401 wrong API key, 402 Insufficient Balance,
// 422 invalid parameters, 429 Rate Limit, 500 Server Error, 503 Server Overloaded.

const TOKENS_PER_MILLION = 1_000_000;
const REDACTED_PLACEHOLDER = "***";
const HTTP_OK = 200;
const HTTP_ERROR_THRESHOLD = 400;
const HTTP_TIMEOUT_MS = 60_000;

// ============================================================================
// Kopie der Produktions-Werkzeugdefinition (src/claude.js:465-477, take_message).
// KEIN Import - B1 haengt an keinem Produktionsmodul (Spec M7-Messverfahren).
// Von Hand nach DeepSeeks Chat-Completions-Werkzeugform uebersetzt:
// { type: "function", function: { name, description, parameters } } - dieselbe
// input_schema -> parameters-Abbildung, die auch realtimeTools() (src/bridge.js:78-85)
// fuer die Realtime-API macht, hier aber in DeepSeeks (verschachtelter) Form statt
// der flachen Realtime-Form.
// ============================================================================
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

// ============================================================================
// Block-Konstanten (Spec 6.2). Jede Schwelle/Groesse benannt, keine Magic Numbers.
// ============================================================================

const ALL_BLOCK_LETTERS = Object.freeze(["A", "B", "C", "D", "E", "F"]);
const DEFAULT_BLOCKS = Object.freeze(["A", "B", "C", "D", "E"]);
// Feste Ausfuehrungsreihenfolge, UNABHAENGIG von der Reihenfolge in --blocks: Block D
// ("nach dem letzten Aufruf", M2-Messverfahren Punkt 3) muss nach A/B/C/E laufen, F ist
// optional/lang und laeuft zuletzt. --blocks waehlt nur die MENGE, nicht die Reihenfolge.
const FIXED_BLOCK_ORDER = Object.freeze(["A", "B", "C", "E", "D", "F"]);
const COMPARABLE_BLOCKS = Object.freeze(["A", "B", "C", "E"]);

const DEFAULT_MAX_USD = 1.0;

// Block A - Grundlinie (M1, M6, M8)
const BLOCK_A_CALLS_PER_MODEL = 3;
const BLOCK_A_TARGET_CHARS = 800; // ~200 Token bei ~4 Zeichen/Token
const BLOCK_A_MAX_TOKENS = 64;
const BLOCK_A_SEED_SENTENCE =
  "Bitte nenne in einem Satz einen Vorteil von horizontaler Skalierung verteilter Systeme. ";

// Block B - Cache (M3)
const CACHE_PROMPT_MIN_CHARS = 12_000;
const CACHE_REPEATS_IMMEDIATE = 10;
const CACHE_CONTROL_AND_DELAYED_CALLS = 3; // 30-Min-Wiederholung + Kontrolle A + Kontrolle B
const BLOCK_B_CALLS_PER_MODEL = CACHE_REPEATS_IMMEDIATE + CACHE_CONTROL_AND_DELAYED_CALLS;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CACHE_REPEAT_DELAY_MINUTES = 30;
const CACHE_REPEAT_DELAY_MS = CACHE_REPEAT_DELAY_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const CACHE_MAX_TOKENS = 16;
// Erste/letzte Saetze der Kontroll-Varianten muessen an POSITION 0 divergieren, damit
// sharedPrefixLength() im Selftest eine exakte, unbestreitbare Zusicherung treffen kann.
const CACHE_PROMPT_FIRST_SENTENCE = "Alpha-Start: Dies ist ein Testprotokoll fuer Cache-Verhalten. ";
const CACHE_PROMPT_FIRST_SENTENCE_ALT = "Zeta-Start: Dies ist ein Testprotokoll fuer Cache-Verhalten. ";
const CACHE_PROMPT_LAST_SENTENCE = "ENDE-A bitte antworte mit einem einzigen Wort.";
const CACHE_PROMPT_LAST_SENTENCE_ALT = "ZIEL-B bitte antworte mit einem einzigen Wort.";
const CACHE_PROMPT_FILLER_SENTENCE =
  "Dieser Fuelltext dient ausschliesslich dazu, den Prompt lang genug fuer eine Cache-Einheit zu machen. ";
const CACHE_PROMPT_BODY = CACHE_PROMPT_FILLER_SENTENCE.repeat(
  Math.ceil(CACHE_PROMPT_MIN_CHARS / CACHE_PROMPT_FILLER_SENTENCE.length),
);

// Block C - Aufloesung (M2a, M2c)
const RESOLUTION_MAX_CALLS_PER_MODEL = 20;
const RESOLUTION_TARGET_CHARS = 24_000; // ~6000 Token bei ~4 Zeichen/Token
const RESOLUTION_MAX_TOKENS = 16;
const RESOLUTION_SEED_SENTENCE =
  "Dieser Testtext dient ausschliesslich der Aufloesungsmessung des Guthaben-Endpunkts. ";

// Block D - Nachbuchung (M2b)
const BALANCE_POLL_COUNT = 12;
const BALANCE_POLL_INTERVAL_SECONDS = 60;
const BALANCE_POLL_INTERVAL_MS = BALANCE_POLL_INTERVAL_SECONDS * MS_PER_SECOND;

// Block E - Stream + Werkzeug (M7). Kreuzprodukt {Stream, kein Stream} x {Werkzeug, kein
// Werkzeug} x {include_usage, kein include_usage} = 8 Aufrufe. Modell FLASH (guenstigstes) -
// die Mechanik (usage im Stream, tool_calls-Feldpfad) ist modellunabhaengig, s. Bericht.
const BLOCK_E_MODEL = MODEL_FLASH;
const BLOCK_E_MAX_TOKENS = 64;
const BLOCK_E_PROMPT =
  "Ein Anrufer sagt: Bitte richten Sie aus, dass ich um 15 Uhr zurueckgerufen werden moechte. " +
  "Nutze bei Bedarf das verfuegbare Werkzeug, um eine Nachricht zu hinterlassen.";

// Block F - Off-Peak (M4, optional)
const BLOCK_F_MODEL = MODEL_FLASH;
const BLOCK_F_CALLS = 24;
const HOURS_PER_BLOCK_F_STEP = 1;
const MINUTES_PER_HOUR = 60;
const BLOCK_F_INTERVAL_MS = HOURS_PER_BLOCK_F_STEP * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

// M5 - Latenz/Fehlerform (keine eigene Blockbuchstabe: Verteilung aggregiert ueber ALLE
// Aufrufe; die beiden Fehlerproben laufen einmal separat, s. runErrorProbes)
const SEAM_TIMEOUT_MS = 3500;
const PERCENTILE_MEDIAN = 50;
const PERCENTILE_P95 = 95;
const INVALID_MAX_TOKENS = -1; // -1 ist per Ausnahme erlaubte Zahl (0/1/-1)

// Grobe Dry-Run-Kostenschaetzung: konservativ auf v4-pro-Cache-Fehltreffer gerechnet
// (Spec 6.4), Ausgabeseite als kleiner Anteil der Eingabeseite angenommen.
const OUTPUT_TOKEN_ESTIMATE_RATIO = 0.02;
const APPROX_INPUT_TOKENS_BLOCK_A = BLOCK_A_TARGET_CHARS * BLOCK_A_CALLS_PER_MODEL * CONFIGURED_MODELS.length / 4;
const APPROX_INPUT_TOKENS_BLOCK_B =
  (CACHE_PROMPT_MIN_CHARS * BLOCK_B_CALLS_PER_MODEL * CONFIGURED_MODELS.length) / 4;
const APPROX_INPUT_TOKENS_BLOCK_C =
  (RESOLUTION_TARGET_CHARS * RESOLUTION_MAX_CALLS_PER_MODEL * CONFIGURED_MODELS.length) / 4;
const APPROX_INPUT_TOKENS_BLOCK_E = (BLOCK_E_PROMPT.length * 8) / 4;
const APPROX_INPUT_TOKENS_BLOCK_F = (BLOCK_A_TARGET_CHARS * BLOCK_F_CALLS) / 4;

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_KEY_LEAK = 2;
const EXIT_BUDGET_STOPPED = 3;

// ============================================================================
// Reine Hilfsfunktionen - keine I/O, keine Zeit-/Zufallsabhaengigkeit. Das ist die
// Menge, die --selftest ohne Netz und ohne Schluessel prueft.
// ============================================================================

// Zerlegt einen Dezimalstring in Vorzeichen/Ganzzahl-/Nachkommateil, OHNE parseFloat.
function decimalPartsOf(str) {
  const trimmed = String(str).trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  return { negative, intPart: intPart || "0", fracPart };
}

function decimalStringToMinorUnits(str, scale) {
  const { negative, intPart, fracPart } = decimalPartsOf(str);
  const paddedFrac = fracPart.padEnd(scale, "0").slice(0, scale);
  const value = BigInt(`${intPart}${paddedFrac}`);
  return negative ? -value : value;
}

// Ganzzahl-Differenz zweier Guthaben-Strings in der kleinsten Einheit. NIE parseFloat/
// Number auf Geldbetraege (Spec M2 + Pre-Mortem 3) - sonst IEEE-Rauschen statt Abbuchung.
export function minorUnitsDelta(beforeStr, afterStr) {
  const scale = Math.max(decimalPartsOf(beforeStr).fracPart.length, decimalPartsOf(afterStr).fracPart.length);
  const before = decimalStringToMinorUnits(beforeStr, scale);
  const after = decimalStringToMinorUnits(afterStr, scale);
  return { deltaMinorUnits: after - before, scale };
}

// Zugriff auf balance_infos AUSSCHLIESSLICH ueber currency, nie ueber Index
// (Pre-Mortem 3: CNY an Index 0, USD an Index 1 - ein Index-Zugriff waere Faktor ~7 falsch).
export function pickBalanceByCurrency(balanceInfos, currency) {
  const match = (balanceInfos || []).find((entry) => entry.currency === currency);
  if (!match) throw new Error(`Keine Guthaben-Eintrag fuer Waehrung ${currency}`);
  return match;
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

function mapDeltasToMinorUnitStrings(deltas) {
  const out = {};
  for (const [currency, delta] of Object.entries(deltas)) out[currency] = delta.deltaMinorUnits.toString();
  return out;
}

function balanceResolutionByCurrency(balanceInfos) {
  const result = {};
  for (const entry of balanceInfos || []) result[entry.currency] = decimalPartsOf(entry.total_balance).fracPart.length;
  return result;
}

// M1-Gleichungen. usage-Felder sind laut Doku Zahlen (nur Guthaben ist String) - normale
// Arithmetik ist hier zulaessig, anders als bei Geldbetraegen.
export function checkPromptEquation(usage) {
  const hit = Number(usage.prompt_cache_hit_tokens || 0);
  const miss = Number(usage.prompt_cache_miss_tokens || 0);
  return usage.prompt_tokens === hit + miss;
}

export function checkTotalEquation(usage) {
  return usage.total_tokens === usage.prompt_tokens + usage.completion_tokens;
}

// Kostenschaetzung aus einem usage-Objekt gegen die Doku-Preistabelle. Dies ist die
// SCHAETZUNG (est_usd_from_doc_prices), nie die Ist-Quelle - die ist die Guthaben-
// Differenz aus minorUnitsDelta.
export function estimateCostUsd(usage, prices) {
  const hit = Number(usage.prompt_cache_hit_tokens || 0);
  const miss = Number(usage.prompt_cache_miss_tokens || 0);
  const completion = Number(usage.completion_tokens || 0);
  return (
    (hit / TOKENS_PER_MILLION) * prices.cacheHit +
    (miss / TOKENS_PER_MILLION) * prices.cacheMiss +
    (completion / TOKENS_PER_MILLION) * prices.output
  );
}

// Redaktionsfilter (Spec 6.5): jede Datei-/Konsolenausgabe laeuft an der Schreibstelle
// durch diese Funktion, nicht an den Aufrufstellen. Nimmt mehrere Geheimnisse
// (echter Schluessel UND der absichtlich falsche aus M5), damit beide gefiltert werden.
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

function deepStringifyBigInt(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(deepStringifyBigInt);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = deepStringifyBigInt(v);
    return out;
  }
  return value;
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

// Block-B-Prompt-Varianten (Spec M3). "base" fuer die 10 Wiederholungen + die 30-Min-
// Wiederholung; "control-a" aendert nur den letzten Satz (erwartet: Treffer auf dem
// gemeinsamen Praefix); "control-b" aendert nur den ersten Satz (erwartet: 0 Treffer).
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

// ============================================================================
// CLI
// ============================================================================

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

// ============================================================================
// Selftest - node:assert gegen die reinen Hilfsfunktionen, ohne Netz und ohne Schluessel.
// ============================================================================

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
    // ungleiche Nachkommastellen
    () => assert.strictEqual(minorUnitsDelta("10.5", "10.55").deltaMinorUnits, 5n),
    // negatives Delta
    () => assert.strictEqual(minorUnitsDelta("10.05", "10.00").deltaMinorUnits, -5n),
    // Delta 0
    () => assert.strictEqual(minorUnitsDelta("10.00", "10.00").deltaMinorUnits, 0n),
    // sehr grosser Betrag, ueber Number.MAX_SAFE_INTEGER hinaus
    () =>
      assert.strictEqual(
        minorUnitsDelta("123456789012345.67", "123456789012346.67").deltaMinorUnits,
        100n,
      ),
    // Fall, der mit parseFloat nachweislich falsch waere: 0.3 - 0.1 !== 0.2 in IEEE-754
    () => {
      assert.notStrictEqual(parseFloat("0.30") - parseFloat("0.10"), 0.2);
      assert.strictEqual(minorUnitsDelta("0.10", "0.30").deltaMinorUnits, 20n);
    },
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
  // Pre-Mortem 3: CNY an Index 0, USD an Index 1 - ein Index-Zugriff waere falsch.
  const balanceInfos = [
    { currency: "CNY", total_balance: "700.00" },
    { currency: "USD", total_balance: "100.00" },
  ];
  return runChecks([
    () => assert.strictEqual(pickBalanceByCurrency(balanceInfos, "USD").total_balance, "100.00"),
    () => assert.strictEqual(pickBalanceByCurrency(balanceInfos, "CNY").total_balance, "700.00"),
    () => assert.notStrictEqual(pickBalanceByCurrency(balanceInfos, "USD"), balanceInfos[0]),
    () => assert.throws(() => pickBalanceByCurrency(balanceInfos, "EUR")),
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
  const usage = { prompt_cache_hit_tokens: 1_000_000, prompt_cache_miss_tokens: 0, completion_tokens: 1_000_000 };
  const prices = DOC_PRICES_USD_PER_MTOK[MODEL_FLASH];
  const expected = prices.cacheHit + prices.output;
  return runChecks([() => assert.strictEqual(estimateCostUsd(usage, prices), expected)]);
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

function runSelftest() {
  const groups = [
    ["Ganzzahl-Delta aus Guthaben-Strings", selftestMoneyDelta],
    ["M1-Gleichungen (eq_prompt, eq_total)", selftestEquations],
    ["Waehrungswahl ueber currency", selftestCurrencySelection],
    ["Redaktionsfilter", selftestRedaction],
    ["Kostenschaetzung aus usage", selftestCostEstimate],
    ["Praefix-Kontrollen Block B", selftestPrefixControls],
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

// ============================================================================
// Schluessel-Vorflug (Spec 6.1): meldet ausschliesslich Vorhandensein und Laenge,
// bricht VOR jedem Netzzugriff ab.
// ============================================================================

function preflightKeyCheck() {
  const key = process.env.DEEPSEEK_API_KEY || "";
  if (!key) {
    console.error("DEEPSEEK_API_KEY fehlt in .env - Abbruch vor jedem Netzzugriff.");
    process.exit(EXIT_ERROR);
  }
  console.log(`DEEPSEEK_API_KEY gefunden, Laenge ${key.length} Zeichen (Wert wird nie ausgegeben).`);
  return key;
}

// ============================================================================
// HTTP-Schicht
// ============================================================================

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
  // stream_options ist laut Doku nur fuer stream:true gedacht - fuer Nicht-Stream-Aufrufe
  // wird das Feld gar nicht erst mitgeschickt (siehe Bericht: Block-E-Designentscheidung).
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

function extractStreamSummary(chunks) {
  let usage = null;
  let model = null;
  for (const rawEvent of chunks) {
    for (const dataLine of parseSseDataLines(rawEvent)) {
      if (dataLine === "[DONE]") continue;
      const parsed = safeJsonParse(dataLine);
      if (!parsed) continue;
      if (parsed.model) model = parsed.model;
      if (parsed.usage) usage = parsed.usage;
    }
  }
  return { usage, model };
}

function normalizeChatResult(raw, stream) {
  if (!stream) {
    return { status: raw.status, ttfbMs: raw.ttfbMs, totalMs: raw.totalMs, model: raw.json?.model ?? null, usage: raw.json?.usage ?? null };
  }
  const summary = extractStreamSummary(raw.chunks);
  return { status: raw.status, ttfbMs: raw.ttfbMs, totalMs: raw.totalMs, model: summary.model, usage: summary.usage };
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

// ============================================================================
// Ausgabe (Spec 6.3): JSONL-Dateien unter data/evidence/deepseek-probe/<ts>/.
// Jede Schreibstelle laeuft durch redact() - das ist die Schutzlinie, nicht die
// Aufrufstellen (Spec 6.5).
// ============================================================================

async function appendJsonLine(outputDir, filename, obj, redact) {
  const line = `${JSON.stringify(redact(deepStringifyBigInt(obj)))}\n`;
  await appendFile(path.join(outputDir, filename), line, "utf8");
}

async function writeJsonFile(filePath, obj, redact) {
  await writeFile(filePath, JSON.stringify(redact(deepStringifyBigInt(obj)), null, 2), "utf8");
}

async function prepareOutputDir() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(REPO_ROOT, "data", "evidence", "deepseek-probe", runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ============================================================================
// Lauf-Zustand + Budget-Notbremse (Spec 6.4)
// ============================================================================

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
    firstBalanceInfos: null,
    lastBalanceInfos: null,
    balancePollCount: 0,
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

async function queryBalanceLogged(state, { block, seq, purpose }) {
  const { status, json } = await queryBalance(state.apiKey);
  const balanceInfos = json?.balance_infos ?? [];
  if (!state.firstBalanceInfos) state.firstBalanceInfos = balanceInfos;
  state.lastBalanceInfos = balanceInfos;
  state.balancePollCount += 1;
  await appendJsonLine(
    state.outputDir,
    "balance.jsonl",
    { ts_utc: new Date().toISOString(), block, seq, purpose, http_status: status, is_available: json?.is_available ?? null, balance_infos: balanceInfos },
    state.redact,
  );
  return { balance_infos: balanceInfos };
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

// calls.jsonl-Feld-Allowlist (Spec 6.3) - NIE das Anfrageobjekt samt Kopfzeilen.
function buildCallRecord({ block, seq, modelRequested, normalized, stream, includeUsage, withTool, balanceBefore, balanceAfter }) {
  const usage = normalized.usage;
  const deltas = computeDeltasByCurrency(balanceBefore.balance_infos, balanceAfter.balance_infos);
  const prices = DOC_PRICES_USD_PER_MTOK[modelRequested] ?? DOC_PRICES_USD_PER_MTOK[MODEL_PRO];
  return {
    ts_utc: new Date().toISOString(),
    block,
    seq,
    model_requested: modelRequested,
    model_returned: normalized.model ?? null,
    stream,
    include_usage: includeUsage,
    tools: withTool,
    http_status: normalized.status,
    ttfb_ms: Math.round(normalized.ttfbMs),
    total_ms: Math.round(normalized.totalMs),
    usage_raw: usage,
    usage_keys: usage ? Object.keys(usage).sort() : [],
    eq_prompt: usage ? checkPromptEquation(usage) : null,
    eq_total: usage ? checkTotalEquation(usage) : null,
    balance_before: balanceBefore.balance_infos,
    balance_after: balanceAfter.balance_infos,
    delta_minor_units: mapDeltasToMinorUnitStrings(deltas),
    currency: Object.keys(deltas),
    est_usd_from_doc_prices: usage ? estimateCostUsd(usage, prices) : 0,
    cum_est_usd: 0, // wird direkt nach dem Aufruf in performChatMeasurement gesetzt
  };
}

// EINZIGER Choke-Point fuer echte Chat-Aufrufe: Budget-Pruefung -> Guthaben vorher ->
// Aufruf -> Guthaben nachher -> Protokoll. Kein Retry (Spec 6.2).
async function performChatMeasurement(state, args) {
  assertBudgetNotExceeded(state);
  const { block, seq, model, prompt, maxTokens, stream, includeUsage, withTool } = args;
  const balanceBefore = await queryBalanceLogged(state, { block, seq, purpose: "vor_aufruf" });
  const body = buildChatRequestBody({ model, prompt, maxTokens, stream, includeUsage, withTool });
  const raw = stream ? await postChatStream({ apiKey: state.apiKey, body }) : await postChatNonStream({ apiKey: state.apiKey, body });
  const balanceAfter = await queryBalanceLogged(state, { block, seq, purpose: "nach_aufruf" });

  if (stream && raw.chunks.length > 0) await writeStreamChunks(state, { block, seq, chunks: raw.chunks });
  if (raw.status >= HTTP_ERROR_THRESHOLD) {
    await recordCallError(state, { block, seq, status: raw.status, body: raw.json ?? raw.rawText });
  }

  const normalized = normalizeChatResult(raw, stream);
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
  });
  state.cumEstUsd += record.est_usd_from_doc_prices;
  record.cum_est_usd = state.cumEstUsd;
  await appendJsonLine(state.outputDir, "calls.jsonl", record, state.redact);
  state.calls.push(record);
  return record;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// M5-Fehlerproben: absichtlich falscher Schluessel, absichtlich ungueltiger Parameter.
// Laufen einmal, unabhaengig von --blocks (M5 hat keine eigene Blockbuchstabe).
// ============================================================================

async function runErrorProbes(state) {
  const wrongKeyResult = await postChatNonStream({
    apiKey: state.wrongApiKey,
    body: buildChatRequestBody({ model: BLOCK_E_MODEL, prompt: BLOCK_A_PROMPT, maxTokens: BLOCK_A_MAX_TOKENS, stream: false, withTool: false }),
  });
  const wrongKeyBody = state.redact(wrongKeyResult.json ?? wrongKeyResult.rawText ?? null);
  await recordCallError(state, { block: "ERR", seq: "wrong_key", status: wrongKeyResult.status, body: wrongKeyBody });
  state.wrongKeyError = { status: wrongKeyResult.status, body: wrongKeyBody };

  const invalidParamResult = await postChatNonStream({
    apiKey: state.apiKey,
    body: { model: BLOCK_E_MODEL, messages: [{ role: "user", content: BLOCK_A_PROMPT }], max_tokens: INVALID_MAX_TOKENS },
  });
  const invalidParamBody = state.redact(invalidParamResult.json ?? invalidParamResult.rawText ?? null);
  await recordCallError(state, { block: "ERR", seq: "invalid_param", status: invalidParamResult.status, body: invalidParamBody });
  state.invalidParamError = { status: invalidParamResult.status, body: invalidParamBody };

  console.log(`M5-Fehlerproben: falscher Schluessel -> HTTP ${wrongKeyResult.status}, ungueltiger Parameter -> HTTP ${invalidParamResult.status}.`);
}

// ============================================================================
// Block-Runner (Spec 6.2). Jeder Block gibt am Ende eine Zeile aus, auch bei
// null Befunden - Stille als Erfolgssignal ist verboten (tasks/lessons.md).
// ============================================================================

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

function cacheCallArgs(model, seq, variant) {
  return { block: "B", seq, model, prompt: buildCachePrompt(variant), maxTokens: CACHE_MAX_TOKENS, stream: false, includeUsage: null, withTool: false };
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
      if (hasCacheHit(await performChatMeasurement(state, cacheCallArgs(model, seq, "base")))) cacheHits += 1;
    }
    await delay(CACHE_REPEAT_DELAY_MS);
    seq += 1;
    if (hasCacheHit(await performChatMeasurement(state, cacheCallArgs(model, seq, "base")))) cacheHits += 1;
    seq += 1;
    if (hasCacheHit(await performChatMeasurement(state, cacheCallArgs(model, seq, "control-a")))) cacheHits += 1;
    seq += 1;
    if (hasCacheHit(await performChatMeasurement(state, cacheCallArgs(model, seq, "control-b")))) cacheHits += 1;
  }
  console.log(`Block B: ${seq} Aufrufe, ${cacheHits} mit Cache-Treffer (prompt_cache_hit_tokens > 0).`);
}

function hasNonZeroDelta(record) {
  return Object.values(record.delta_minor_units || {}).some((v) => v !== "0");
}

async function runBlockC(state) {
  let seq = 0;
  const resolutionFindings = {};
  for (const model of CONFIGURED_MODELS) {
    let movedAtIteration = null;
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
      if (hasNonZeroDelta(record)) {
        movedAtIteration = i;
        break;
      }
    }
    resolutionFindings[model] = movedAtIteration;
  }
  state.resolutionFindings = resolutionFindings;
  console.log(`Block C: ${seq} Aufrufe. Guthaben-Einheit bewegt bei Iteration je Modell: ${JSON.stringify(resolutionFindings)}.`);
}

async function runBlockD(state) {
  for (let i = 1; i <= BALANCE_POLL_COUNT; i += 1) {
    await queryBalanceLogged(state, { block: "D", seq: i, purpose: "periodisch" });
    if (i < BALANCE_POLL_COUNT) await delay(BALANCE_POLL_INTERVAL_MS);
  }
  const minutesSpanned = ((BALANCE_POLL_COUNT - 1) * BALANCE_POLL_INTERVAL_MS) / MS_PER_SECOND / SECONDS_PER_MINUTE;
  console.log(`Block D: ${BALANCE_POLL_COUNT} Guthaben-Abfragen ueber ${minutesSpanned} Minuten, 0 Chat-Aufrufe.`);
}

async function runBlockE(state) {
  let seq = 0;
  for (const combo of buildBlockECombos()) {
    seq += 1;
    await performChatMeasurement(state, {
      block: "E",
      seq,
      model: BLOCK_E_MODEL,
      prompt: BLOCK_E_PROMPT,
      maxTokens: BLOCK_E_MAX_TOKENS,
      stream: combo.stream,
      includeUsage: combo.includeUsage,
      withTool: combo.withTool,
    });
  }
  console.log(`Block E: ${seq} Aufrufe (Stream x Werkzeug x include_usage, Modell ${BLOCK_E_MODEL}).`);
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
  const lastComparable = [...toRun].reverse().find((b) => COMPARABLE_BLOCKS.includes(b));
  for (const block of toRun) {
    if (COMPARABLE_BLOCKS.includes(block) && !state.comparableWindow.start_utc) {
      state.comparableWindow.start_utc = new Date().toISOString();
    }
    try {
      await BLOCK_RUNNERS[block](state);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.log(`ABBRUCH: ${err.message}`);
        state.budgetAbortReason = err.message;
        break;
      }
      throw err;
    }
    if (block === lastComparable) state.comparableWindow.end_utc = new Date().toISOString();
  }
}

// ============================================================================
// Zusammenfassung (Spec 6.3, Pre-Mortem 6): je Messfrage ein answer-Feld, entweder
// Zahl/Struktur ODER "nicht beantwortet, Grund: ...".
// ============================================================================

const M1_MIN_SAMPLES = 30;

function computeM1Answer(calls) {
  const withUsage = calls.filter((c) => c.usage_raw);
  if (withUsage.length < M1_MIN_SAMPLES) {
    return `nicht beantwortet, Grund: nur ${withUsage.length} Antworten mit usage vorliegend (< ${M1_MIN_SAMPLES})`;
  }
  const eqPromptViolations = withUsage.filter((c) => c.eq_prompt === false);
  const eqTotalViolations = withUsage.filter((c) => c.eq_total === false);
  const unexpectedKeys = new Set();
  for (const c of withUsage) for (const k of c.usage_keys) if (!DOCUMENTED_USAGE_KEYS.has(k)) unexpectedKeys.add(k);
  return {
    samples: withUsage.length,
    eq_prompt_violations: eqPromptViolations.length,
    eq_prompt_beispiel: eqPromptViolations[0]?.usage_raw ?? null,
    eq_total_violations: eqTotalViolations.length,
    eq_total_beispiel: eqTotalViolations[0]?.usage_raw ?? null,
    unerwartete_usage_keys: [...unexpectedKeys],
  };
}

function buildOverallComparison(deltas, formulaSumUsd) {
  const out = {};
  for (const [currency, delta] of Object.entries(deltas)) {
    if (currency !== "USD") {
      out[currency] = "nicht vergleichbar (Waehrung ungleich USD, kein Wechselkurs im Skript - Spec Nicht-Ziele)";
      continue;
    }
    // Naeherung NUR fuer die menschenlesbare Prozent-Gegenprobe - die exakte Ganzzahl-
    // Differenz bleibt in delta.deltaMinorUnits (BigInt) unangetastet erhalten.
    const deltaUsdApprox = Number(delta.deltaMinorUnits) / 10 ** delta.scale;
    const abweichungProzent = formulaSumUsd === 0 ? null : ((Math.abs(deltaUsdApprox) - formulaSumUsd) / formulaSumUsd) * 100;
    out[currency] = { delta_usd_approx: deltaUsdApprox, formel_summe_usd: formulaSumUsd, abweichung_prozent: abweichungProzent };
  }
  return out;
}

function computeM2Answer(state) {
  if (!state.firstBalanceInfos || !state.lastBalanceInfos) {
    return "nicht beantwortet, Grund: keine Guthaben-Abfragen protokolliert (Bloecke A/B/C/D nicht gelaufen)";
  }
  const overallDeltas = computeDeltasByCurrency(state.firstBalanceInfos, state.lastBalanceInfos);
  const formulaSumUsd = state.calls.reduce((sum, c) => sum + (c.est_usd_from_doc_prices || 0), 0);
  return {
    aufloesung_nachkommastellen_je_waehrung: balanceResolutionByCurrency(state.firstBalanceInfos),
    einzelaufruf_bewegt_bei_iteration_je_modell: state.resolutionFindings ?? "nicht beantwortet, Grund: Block C nicht gelaufen",
    block_d_anzahl_abfragen: state.balancePollCount,
    gesamt_delta_je_waehrung: mapDeltasToMinorUnitStrings(overallDeltas),
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
  const hitTokens = calls.map((c) => Number(c.usage_raw?.prompt_cache_hit_tokens || 0));
  const anyHit = hitTokens.some((v) => v > 0);
  return {
    aufrufe: calls.length,
    hit_tokens_je_aufruf: hitTokens,
    treffer_beobachtet: anyHit,
    hinweis: anyHit ? null : "0 Treffer - gueltiges Ergebnis, Cache ist laut Doku best-effort",
    preisdifferenz: cachePriceDifferenceUsd(calls, model),
  };
}

function computeM3Answer(calls) {
  const blockBCalls = calls.filter((c) => c.block === "B");
  if (blockBCalls.length === 0) return "nicht beantwortet, Grund: Block B nicht gelaufen";
  const perModel = {};
  for (const model of CONFIGURED_MODELS) perModel[model] = summarizeCacheCalls(blockBCalls.filter((c) => c.model_requested === model), model);
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

function computeM5Answer(state) {
  const durations = state.calls.map((c) => c.total_ms).sort((a, b) => a - b);
  if (durations.length === 0) return "nicht beantwortet, Grund: keine Aufrufe mit Zeitmessung vorhanden";
  const overThreshold = durations.filter((v) => v > SEAM_TIMEOUT_MS).length;
  return {
    min_ms: durations[0],
    median_ms: percentile(durations, PERCENTILE_MEDIAN),
    p95_ms: percentile(durations, PERCENTILE_P95),
    max_ms: durations[durations.length - 1],
    anteil_ueber_3500ms: overThreshold / durations.length,
    falscher_schluessel: state.wrongKeyError ?? "nicht beantwortet, Grund: Fehlerprobe nicht ausgefuehrt",
    ungueltiger_parameter: state.invalidParamError ?? "nicht beantwortet, Grund: Fehlerprobe nicht ausgefuehrt",
  };
}

function computeM6Answer(state) {
  const pairs = state.calls.map((c) => ({ requested: c.model_requested, returned: c.model_returned }));
  if (pairs.length === 0) return "nicht beantwortet, Grund: keine Aufrufe protokolliert";
  const mismatches = pairs.filter((p) => p.requested !== p.returned);
  return { anzahl_aufrufe: pairs.length, abweichungen: mismatches.length, beispiel_abweichung: mismatches[0] ?? null, models_endpoint_raw: state.modelsRaw };
}

function computeM7Answer(calls) {
  const blockE = calls.filter((c) => c.block === "E");
  if (blockE.length === 0) return "nicht beantwortet, Grund: Block E nicht gelaufen";
  return blockE.map((c) => ({ stream: c.stream, include_usage: c.include_usage, tools: c.tools, usage_vorhanden: !!c.usage_raw, usage_raw: c.usage_raw }));
}

function computeM8Answer(calls) {
  const withReasoning = calls.filter((c) => Number(c.usage_raw?.completion_tokens_details?.reasoning_tokens || 0) > 0);
  if (withReasoning.length === 0) {
    return "bei diesem Aufrufprofil nie beobachtet (completion_tokens_details.reasoning_tokens war in allen Aufrufen 0 oder fehlend)";
  }
  const example = withReasoning[0];
  return {
    beispiele: withReasoning.length,
    reasoning_tokens_beispiel: example.usage_raw.completion_tokens_details.reasoning_tokens,
    completion_tokens_beispiel: example.usage_raw.completion_tokens,
    // Die total_tokens-Gleichung aus M1 entscheidet die Zugehoerigkeit (Spec M8-Messverfahren).
    zugehoerigkeit: example.eq_total ? "enthalten (total_tokens-Gleichung stimmt ohne Zusatzaddition)" : "additiv (Gleichung stimmt nur mit reasoning_tokens addiert)",
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

function printConsoleSummary(summary) {
  console.log("\n=== B1-Zusammenfassung ===");
  for (const key of ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"]) {
    const entry = summary[key];
    const short = typeof entry.answer === "string" ? entry.answer : "beantwortet (siehe summary.json)";
    console.log(`${key}: ${short}`);
  }
}

// ============================================================================
// Selbstpruefung Secret-Schutz (Spec 6.5): eigene Ausgabedateien lesen, auf den
// echten und den absichtlich falschen Schluessel pruefen.
// ============================================================================

async function keyLeakCheck(outputDir, secrets) {
  const files = ["calls.jsonl", "balance.jsonl", "stream-chunks.jsonl", "errors.jsonl", "summary.json"];
  for (const file of files) {
    let content;
    try {
      content = await readFile(path.join(outputDir, file), "utf8");
    } catch {
      continue; // Datei wurde in diesem Lauf nicht angelegt (z.B. kein Fehler -> errors.jsonl fehlt)
    }
    for (const secret of secrets.filter(Boolean)) {
      if (content.includes(secret)) return "DIRTY";
    }
  }
  return "clean";
}

// ============================================================================
// Trockenlauf (Spec 6.4): plant alle Bloecke, KEIN Netzaufruf, keine Ausgabedatei.
// ============================================================================

function estimateBlockCostUsd(approxInputTokens) {
  // Konservativ: teuerstes Modell (v4-pro), Cache-Fehltreffer-Satz (Spec 6.4).
  const prices = DOC_PRICES_USD_PER_MTOK[MODEL_PRO];
  const inputCost = (approxInputTokens / TOKENS_PER_MILLION) * prices.cacheMiss;
  const outputCost = ((approxInputTokens * OUTPUT_TOKEN_ESTIMATE_RATIO) / TOKENS_PER_MILLION) * prices.output;
  return inputCost + outputCost;
}

function plannedCallsForBlock(block) {
  switch (block) {
    case "A":
      return { count: BLOCK_A_CALLS_PER_MODEL * CONFIGURED_MODELS.length, note: "3 je Modell", estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_A) };
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
      return { count: BLOCK_E_COMBOS_COUNT, note: `Stream x Werkzeug x include_usage, Modell ${BLOCK_E_MODEL}`, estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_E) };
    case "F":
      return { count: BLOCK_F_CALLS, note: `ein Aufruf je Stunde ueber 24h, Modell ${BLOCK_F_MODEL}`, estUsd: estimateBlockCostUsd(APPROX_INPUT_TOKENS_BLOCK_F) };
    default:
      return { count: 0, note: "unbekannter Block", estUsd: 0 };
  }
}

function printDryRunPlan(options) {
  console.log("Trockenlauf: 0 Netzaufrufe.");
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
    console.log("WARNUNG: geschaetzte Kosten liegen ueber --max-usd - der echte Lauf wuerde vorzeitig abbrechen.");
  }
  console.log("Trockenlauf beendet - keine Ausgabedatei wurde angelegt.");
}

// ============================================================================
// Hauptorchestrierung
// ============================================================================

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
  const apiKey = preflightKeyCheck();

  if (options.dryRun) {
    printDryRunPlan(options);
    process.exit(EXIT_OK);
    return;
  }

  const wrongApiKey = deriveWrongApiKey(apiKey);
  const redact = createRedactor([apiKey, wrongApiKey]);
  const outputDir = await prepareOutputDir();
  console.log(`Ausgabeverzeichnis: ${outputDir}`);

  const state = createRunState({ outputDir, redact, maxUsd: options.maxUsd, apiKey, wrongApiKey });
  state.modelsRaw = await validateModelsAvailable(apiKey); // fail-closed bei Modell-Drift

  await runErrorProbes(state);
  await runRequestedBlocks(state, options);

  const summary = buildSummary(state, options);
  await writeJsonFile(path.join(state.outputDir, "summary.json"), summary, redact);
  printConsoleSummary(summary);

  const leak = await keyLeakCheck(state.outputDir, [apiKey, wrongApiKey]);
  console.log(`key_leak_check: ${leak}`);
  if (leak === "DIRTY") process.exit(EXIT_KEY_LEAK);
  process.exit(state.budgetAbortReason ? EXIT_BUDGET_STOPPED : EXIT_OK);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const options = parseArgs(process.argv.slice(2));
  main(options).catch((err) => {
    console.error(err.message);
    process.exit(EXIT_ERROR);
  });
}
