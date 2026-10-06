#!/usr/bin/env node
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { assertTelnyxOk } from "../src/telephony/adapters/telnyx/errors.js";

const AI_CONVERSATIONS_PATH = "/v2/ai/conversations";
const ASSISTANT_ROLE = "assistant";
const ACCOUNTED_LATENCY_FIELDS = Object.freeze([
  "transcription_duration_ms",
  "llm_first_token_duration_ms",
  "audio_first_token_duration_ms",
  "start_speaking_plan_extra_wait_duration_ms",
]);
const TOTAL_LATENCY_FIELD = "end_user_perceived_latency_ms";
const LATENCY_FIELDS = Object.freeze([...ACCOUNTED_LATENCY_FIELDS, TOTAL_LATENCY_FIELD]);
const UNACCOUNTED_TOLERANCE_MS = 300;
const UNACCOUNTED_COLUMN = "unaccounted";
const NO_VALUE = "-";
const COLUMN_WIDTH = 12;

function headers() {
  return { Authorization: `Bearer ${config.telephony.telnyxApiKey}` };
}

async function getJson(path, op) {
  const res = await fetch(`${config.telephony.telnyxApiBase}${path}`, { method: "GET", headers: headers() });
  await assertTelnyxOk(res, op, { attachStatus: true });
  const json = await res.json().catch(() => ({}));
  return json.data ?? json;
}

async function fetchConversationSummary(conversationId) {
  try {
    return await getJson(`${AI_CONVERSATIONS_PATH}/${conversationId}`, "fetchConversation");
  } catch (err) {
    console.warn(`Conversation-Metadaten nicht abrufbar (${err.message}) - fahre mit /messages fort.`);
    return null;
  }
}

async function fetchMessages(conversationId) {
  const data = await getJson(`${AI_CONVERSATIONS_PATH}/${conversationId}/messages`, "fetchMessages");
  return Array.isArray(data) ? data : [];
}

export function turnRowFrom(message) {
  const metadata =
    message && typeof message.metadata === "object" && message.metadata !== null ? message.metadata : {};
  const row = { sentAt: (message && message.sent_at) || null };
  for (const field of LATENCY_FIELDS) {
    const value = metadata[field];
    row[field] = typeof value === "number" ? value : undefined;
  }
  return row;
}

export function assistantTurnRows(messages) {
  return messages.filter((m) => m && m.role === ASSISTANT_ROLE).map(turnRowFrom);
}

export function median(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return undefined;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

export function medianRow(rows) {
  const result = {};
  for (const field of LATENCY_FIELDS) {
    result[field] = median(rows.map((r) => r[field]));
  }
  return result;
}

export function unaccountedMsOf(row) {
  const total = row[TOTAL_LATENCY_FIELD];
  if (typeof total !== "number") return undefined;
  let sum = 0;
  for (const field of ACCOUNTED_LATENCY_FIELDS) {
    const value = row[field];
    if (typeof value !== "number") return undefined;
    sum += value;
  }
  return total - sum;
}

export function unaccountedVerdict(rows) {
  const medianMs = median(rows.map(unaccountedMsOf));
  const exceedsTolerance = typeof medianMs === "number" && Math.abs(medianMs) > UNACCOUNTED_TOLERANCE_MS;
  return { medianMs, exceedsTolerance };
}

function fmt(value) {
  return typeof value === "number" ? String(Math.round(value)) : NO_VALUE;
}

function padCol(text) {
  return String(text).padEnd(COLUMN_WIDTH);
}

function printTable(rows) {
  const header = ["turn", "sent_at", ...LATENCY_FIELDS.map((f) => f.replace(/_ms$/, "")), UNACCOUNTED_COLUMN];
  console.log(header.map(padCol).join(""));
  rows.forEach((row, i) => {
    const line = [
      String(i + 1),
      row.sentAt || NO_VALUE,
      ...LATENCY_FIELDS.map((f) => fmt(row[f])),
      fmt(unaccountedMsOf(row)),
    ];
    console.log(line.map(padCol).join(""));
  });
  const meds = medianRow(rows);
  console.log(
    ["median", "", ...LATENCY_FIELDS.map((f) => fmt(meds[f])), fmt(median(rows.map(unaccountedMsOf)))]
      .map(padCol)
      .join(""),
  );
  const verdict = unaccountedVerdict(rows);
  const status = typeof verdict.medianMs !== "number" ? "no_data" : verdict.exceedsTolerance ? "unknown_component" : "ok";
  console.log(
    `verdict  unaccounted-median=${fmt(verdict.medianMs)} ms  tolerance=${UNACCOUNTED_TOLERANCE_MS} ms  status=${status}`,
  );
}

function failClosed(reason) {
  console.error(`Grund: ${reason}`);
  console.error("Aufruf: node scripts/telnyx-call-latency.mjs <telnyx_conversation_id> | --call <hermes-call-id>");
  process.exit(1);
}

export function parseLatencyArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) return { error: "kein Argument uebergeben (Telnyx-Conversation-ID fehlt)" };
  if (args[0] === "--call") {
    const hermesCallId = args[1];
    if (!hermesCallId) return { error: "--call braucht die interne Hermes-call.id als Argument" };
    return { hermesCallId };
  }
  return { conversationId: args[0] };
}

async function conversationIdForCall(hermesCallId) {
  const { pgBackendActive, readAcrossTenants } = await import("./prod-read.mjs");
  if (!pgBackendActive()) failClosed("--call ist nur im pg-Backend (STORE_BACKEND=pg) aufloesbar");
  const rows = await readAcrossTenants((client) =>
    client
      .query(`SELECT telnyx_conversation_id FROM call WHERE id = $1`, [hermesCallId])
      .then((r) => r.rows),
  );
  return rows.find((r) => r.telnyx_conversation_id)?.telnyx_conversation_id ?? null;
}

async function main() {
  if (!config.telephony.telnyxApiKey) failClosed("kein TELNYX_API_KEY konfiguriert (kein Netzzugriff versucht)");

  const args = parseLatencyArgs(process.argv);
  if (args.error) failClosed(args.error);
  const conversationId = args.conversationId ?? (await conversationIdForCall(args.hermesCallId));
  if (!conversationId) failClosed(`kein telnyxConversationId am Call ${args.hermesCallId} hinterlegt`);

  const summary = await fetchConversationSummary(conversationId);
  if (summary) console.log(`Conversation ${conversationId} (status=${summary.status ?? NO_VALUE})`);

  const messages = await fetchMessages(conversationId);
  const rows = assistantTurnRows(messages);
  if (rows.length === 0) failClosed(`keine assistant-Messages in Conversation ${conversationId} gefunden`);

  printTable(rows);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => failClosed(`Abruf fehlgeschlagen: ${err.message}`));
