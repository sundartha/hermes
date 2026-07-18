#!/usr/bin/env node
// K0 (PLAN-CONVERSATION-OPTIMIZATION.md, Messgrundlage): read-only Auswerte-Skript fuer die
// Telnyx-eigene Latenz-Zerlegung pro Conversation-Turn. Holt GET /v2/ai/conversations/{id}
// (Conversation-Metadaten, best-effort) und GET /v2/ai/conversations/{id}/messages (die
// eigentlichen Turns) und druckt pro assistant-Message die im metadata-Objekt gelieferten
// Latenz-Felder (transcription_duration_ms, llm_first_token_duration_ms,
// audio_first_token_duration_ms, end_user_perceived_latency_ms,
// start_speaking_plan_extra_wait_duration_ms) als Tabelle + Mediane. Belegt live in
// tasks/afix-testcall2-report.md (Zeile 20-24) - dort per GET verifizierte Feldnamen/Shape.
//
// NUR GET, niemals schreibend (Regel 1 - kein Call/keine Aenderung am Live-Assistant).
// Konventionen wie scripts/telnyx-assistant-provision.mjs: config.js als einzige
// Konfig-Quelle, assertTelnyxOk als EIN Fehler-Parser, fail-closed bei fehlendem
// TELNYX_API_KEY (kein Netzzugriff ohne Key).
//
// Aufruf: node scripts/telnyx-call-latency.mjs <telnyx_conversation_id>
// <telnyx_conversation_id> ist Telnyx' EIGENE Conversation-UUID (aus dem
// call.conversation.created-Webhook bzw. aus /v2/call_events eines Calls - siehe
// tasks/afix-testcall-report.md/afix-testcall2-report.md fuer zwei reale Beispiele), NICHT
// die interne Hermes-call.id. Telnyx kennt Letztere nicht - eine falsche/interne ID liefert
// HTTP 404 (fail-closed unten), kein stilles Leerergebnis.
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { assertTelnyxOk } from "../src/telephony/adapters/telnyx/errors.js";

const AI_CONVERSATIONS_PATH = "/v2/ai/conversations";
const ASSISTANT_ROLE = "assistant";
// K0 (Plan §2): die fuenf Latenz-Bestandteile, die Telnyx pro assistant-Message im
// metadata-Objekt mitliefert - EINE Liste (G5), sowohl fuer Tabellen-Spalten als auch fuer
// die Median-Berechnung.
const LATENCY_FIELDS = Object.freeze([
  "transcription_duration_ms",
  "llm_first_token_duration_ms",
  "audio_first_token_duration_ms",
  "end_user_perceived_latency_ms",
  "start_speaking_plan_extra_wait_duration_ms",
]);
const NO_VALUE = "-"; // Platzhalter fuer fehlende Metadaten-Felder in der Tabelle/Konsole
const COLUMN_WIDTH = 12; // feste Spaltenbreite (kein Table-Package, keine neue Dependency)

function headers() {
  return { Authorization: `Bearer ${config.telephony.telnyxApiKey}` };
}

// GET-only Fetch-Wrapper: EINE Fehlerstelle (G5), gleiche Konvention wie
// telnyx-assistant-provision.mjs (assertTelnyxOk, {data}-Envelope-Unwrap).
async function getJson(path, op) {
  const res = await fetch(`${config.telephony.telnyxApiBase}${path}`, { method: "GET", headers: headers() });
  await assertTelnyxOk(res, op, { attachStatus: true });
  const json = await res.json().catch(() => ({}));
  return json.data ?? json;
}

// Conversation-Metadaten (Kopfzeile) - best-effort: wirft NICHT, wenn die Ressource fehlt
// oder abweicht. Die eigentliche Auswertung braucht nur /messages; die Kopfzeile ist reine
// Orientierung fuer den Operator.
async function fetchConversationSummary(conversationId) {
  try {
    return await getJson(`${AI_CONVERSATIONS_PATH}/${conversationId}`, "fetchConversation");
  } catch (err) {
    console.warn(`Conversation-Metadaten nicht abrufbar (${err.message}) - fahre mit /messages fort.`);
    return null;
  }
}

// Die eigentlichen Turns. Wirft (fail-closed): ohne Messages gibt es nichts auszuwerten -
// der Aufrufer (main) faengt das ab und meldet den Grund, statt eine leere Tabelle zu drucken.
async function fetchMessages(conversationId) {
  const data = await getJson(`${AI_CONVERSATIONS_PATH}/${conversationId}/messages`, "fetchMessages");
  return Array.isArray(data) ? data : [];
}

// Reine Extraktion (P11 testbar, kein IO): EINE assistant-Message -> Zeile mit sent_at +
// den fuenf Latenz-Feldern. Fehlendes Feld -> undefined, NIE 0 (eine 0 waere eine erfundene
// Messung, G26). Exportiert fuer den Offline-Test.
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

// Alle assistant-Turns eines Messages-Arrays, in der von Telnyx gelieferten (chronologischen)
// Reihenfolge - siehe tasks/afix-testcall2-report.md. Exportiert fuer den Offline-Test.
export function assistantTurnRows(messages) {
  return messages.filter((m) => m && m.role === ASSISTANT_ROLE).map(turnRowFrom);
}

// Median einer Zahlenliste (undefined/NaN vorher rausgefiltert). Gerade Laenge -> Mittel der
// zwei mittleren Werte (Standard-Definition). Leere Liste -> undefined (keine erfundene 0).
// Exportiert fuer den Offline-Test.
export function median(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return undefined;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

// Medianzeile ueber alle LATENCY_FIELDS eines Zeilen-Arrays. Exportiert fuer den Offline-Test.
export function medianRow(rows) {
  const result = {};
  for (const field of LATENCY_FIELDS) {
    result[field] = median(rows.map((r) => r[field]));
  }
  return result;
}

function fmt(value) {
  return typeof value === "number" ? String(Math.round(value)) : NO_VALUE;
}

function padCol(text) {
  return String(text).padEnd(COLUMN_WIDTH);
}

// Kopf + je eine Zeile pro Turn + Median-Fusszeile. Reine Formatierung, kein IO - trennt
// Berechnung (medianRow, testbar) von Ausgabe (console.log, nicht testbar).
function printTable(rows) {
  const header = ["turn", "sent_at", ...LATENCY_FIELDS.map((f) => f.replace(/_ms$/, ""))];
  console.log(header.map(padCol).join(""));
  rows.forEach((row, i) => {
    const line = [String(i + 1), row.sentAt || NO_VALUE, ...LATENCY_FIELDS.map((f) => fmt(row[f]))];
    console.log(line.map(padCol).join(""));
  });
  const meds = medianRow(rows);
  console.log(["median", "", ...LATENCY_FIELDS.map((f) => fmt(meds[f]))].map(padCol).join(""));
}

function failClosed(reason) {
  console.error(`Grund: ${reason}`);
  console.error("Aufruf: node scripts/telnyx-call-latency.mjs <telnyx_conversation_id>");
  process.exit(1);
}

async function main() {
  // Fail-closed VOR jedem Netzzugriff (Muster telnyx-assistant-provision.mjs REQUIRED-Gate):
  // kein Key -> kein Fetch-Versuch, kein irrefuehrender Netzwerkfehler.
  if (!config.telephony.telnyxApiKey) failClosed("kein TELNYX_API_KEY konfiguriert (kein Netzzugriff versucht)");

  const conversationId = process.argv[2];
  if (!conversationId) failClosed("kein Argument uebergeben (Telnyx-Conversation-ID fehlt)");

  const summary = await fetchConversationSummary(conversationId);
  if (summary) console.log(`Conversation ${conversationId} (status=${summary.status ?? NO_VALUE})`);

  const messages = await fetchMessages(conversationId);
  const rows = assistantTurnRows(messages);
  if (rows.length === 0) failClosed(`keine assistant-Messages in Conversation ${conversationId} gefunden`);

  printTable(rows);
}

// Nur als Skript ausfuehren, NICHT beim Import (Muster telnyx-assistant-provision.mjs -
// Offline-Tests importieren nur die reinen Funktionen, kein echter Netz-Call/process.exit).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => failClosed(`Abruf fehlgeschlagen: ${err.message}`));
