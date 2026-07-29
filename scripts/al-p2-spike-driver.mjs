#!/usr/bin/env node
// AL-P2b (WEGWERF, nie nach master): Treiber fuer den SSE-Spike aus AL-P2. Fuehrt die
// Messung in drei Kommandos, read-mostly und idempotent, mit Dry-Run als DEFAULT:
//
//   --arm      Ist-Zustand der beteiligten Telnyx-Objekte lesen, EINMALIG als Snapshot
//              wegschreiben (Vorher-Zustand ist die Grundlage des Rueckbaus, nicht
//              Gedaechtnis) und - nur mit --apply - beide Wegwerf-DIDs auf die
//              Wegwerf-TeXML-App sowie den Wegwerf-Assistant auf den Wegwerf-Shim setzen.
//   --measure  Anruf ueber die REGULAERE POST /api/calls ausloesen (alle Safety-Gates
//              laufen, Absolute Regel 1 - kein Bypass, kein neuer Endpunkt), auf das
//              Gespraechsende warten und das Urteil ueber die in AL-P2 gebaute
//              sseSpikeVerdict faellen (kein zweites Urteil, G5).
//   --restore  Snapshot zurueckschreiben und per Objekt-GET VERIFIZIEREN, dass beide DIDs
//              wieder auf die Hermes-TeXML-App zeigen - behauptet es nicht, prueft es.
//
// HARTE GRENZEN (Spec tasks/assistant-leap-chain.md, AL-P2b):
//   - Die live genutzte DID +17067101188 wird NIE angefasst: taucht sie in IRGENDEINEM
//     Argument auf, verweigert das Skript vor jedem Netzzugriff den Dienst.
//   - Kein Schreibzugriff auf den Live-Assistant (Praefix assistant-dcf48d08).
//   - scripts/telnyx-assistant-provision.mjs wird weder importiert noch veraendert (es
//     schriebe die GANZE Live-Config aus der lokalen .env).
//   - Secrets werden gebaut, aber NIE gedruckt (Regel 4/5); assertTelnyxOk bleibt der
//     EINE Fehler-Parser (allowlisted code/title). Rufnummern/IDs/URLs duerfen laut Spec
//     im Klartext stehen - es sind unsere eigenen.
//
// Konventionen wie scripts/telnyx-call-latency.mjs: config.js als einzige Konfig-Quelle,
// isMain-Guard (kein Netz/process.exit beim Import), reine Funktionen exportiert.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { telnyxRequest } from "../src/telephony/adapters/telnyx/http-client.js";
import { sleepMs } from "../src/utils/timer.js";
import { SPIKE_SILENCE_PATH } from "../src/routes/voice-spike.js";
import {
  SPIKE_FLAG,
  assistantTurnRowsFor,
  conversationIdForCall,
  sseSpikeVerdict,
} from "./telnyx-call-latency.mjs";

// ---- Unantastbare Live-Objekte (Refusal-Grundlage) ---------------------------------
export const LIVE_DID = "+17067101188"; // NIE anfassen (Outbound 2026-07-27)
export const LIVE_ASSISTANT_PREFIX = "assistant-dcf48d08";
// Die Bestands-TeXML-App "Hermes", auf die beide Wegwerf-DIDs zurueckmuessen.
export const HERMES_TEXML_APP_ID = "2982643896460248193";
// Die zwei ungenutzten Wegwerf-DIDs: KONSTANTEN, keine freien Argumente - ein Tippfehler
// darf nicht auf eine fremde Nummer zeigen koennen.
export const SPIKE_SENDER = "+18643028341";
export const SPIKE_CALLEE = "+15739090177";
const FORBIDDEN_TOKENS = Object.freeze([LIVE_DID, LIVE_ASSISTANT_PREFIX]);

// ---- Argumentform ------------------------------------------------------------------
const ARM = "--arm";
const MEASURE = "--measure";
const RESTORE = "--restore";
const COMMANDS = Object.freeze([ARM, MEASURE, RESTORE]);
const APPLY_FLAG = "--apply";
const SERVICE_FLAG = "--service";
const ASSISTANT_FLAG = "--assistant";
const TEXML_APP_FLAG = "--texml-app";
// Flag -> Feldname im Ergebnis von parseDriverArgs (EINE Karte, G5).
const VALUE_FLAGS = Object.freeze({
  [SERVICE_FLAG]: "service",
  [ASSISTANT_FLAG]: "assistantId",
  [TEXML_APP_FLAG]: "texmlAppId",
  [SPIKE_FLAG]: "spikeDelayMs",
});
const REQUIRED_FLAGS_BY_COMMAND = Object.freeze({
  [ARM]: [SERVICE_FLAG, ASSISTANT_FLAG, TEXML_APP_FLAG],
  [MEASURE]: [SERVICE_FLAG, SPIKE_FLAG],
  [RESTORE]: [],
});

// ---- Telnyx-/Dienst-Endpunkte + Betriebswerte --------------------------------------
const SNAPSHOT_FILE = "al-p2-spike-snapshot.json"; // -> config.server.dataDir (gitignored)
const SHIM_BASE_SUFFIX = "/v1"; // Telnyx haengt /chat/completions selbst an
const NUMBERS_PATH = "/v2/phone_numbers";
const ASSISTANTS_PATH = "/v2/ai/assistants";
const TEXML_APPS_PATH = "/v2/texml_applications";
const CALLS_PATH = "/api/calls";
const DASHBOARD_USER = "admin";
const CALL_POLL_INTERVAL_MS = 5_000;
const CALL_POLL_MAX_MS = 240_000;
// Nicht-terminale Call-Zustaende (store/state-ops.js): solange einer davon steht, laeuft
// der Anruf noch. Benannt statt zweier nackter String-Vergleiche im Poll (G25/G28).
const ONGOING_CALL_STATUSES = Object.freeze(["dialing", "active"]);
// Fester Mess-Auftrag: der Spike misst die Chunk-Sequenz, nicht die Gespraechsqualitaet.
const SPIKE_OBJECTIVE =
  "AL-P2b Messanruf: Sprich zwei bis drei vollstaendige Saetze und beende das Gespraech danach.";
const NO_VALUE = "-"; // Platzhalter in der Ausgabe (Muster telnyx-call-latency.mjs)

// ---- Reine Funktionen (offline testbar, P11) ---------------------------------------

// Erster verbotener Token in der GANZEN Argumentliste (nicht nur in den bekannten Flags):
// ein Tippfehler an beliebiger Position darf den Live-Betrieb nicht treffen. Teil-Treffer
// zaehlen (assistant-dcf48d08-<suffix> ist derselbe Live-Assistant).
export function forbiddenTokenIn(argv) {
  for (const arg of argv) {
    const hit = FORBIDDEN_TOKENS.find((token) => String(arg).includes(token));
    if (hit) return hit;
  }
  return null;
}

// Rohe Token-Sammlung: Kommandos, Wert-Flags, --apply. Unbekanntes Token -> Fehler
// (kein stilles Ignorieren - ein verschlucktes Argument waere eine falsche Messung).
function collectDriverTokens(args) {
  const commands = [];
  const values = {};
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (COMMANDS.includes(token)) {
      commands.push(token);
      continue;
    }
    if (token === APPLY_FLAG) {
      apply = true;
      continue;
    }
    const field = VALUE_FLAGS[token];
    if (!field) return { error: `unbekanntes Argument: ${token}` };
    const value = args[++i];
    if (value === undefined) return { error: `${token} braucht einen Wert` };
    values[field] = value;
  }
  return { commands, values, apply };
}

// Die Verzoegerung ist die Bezugsgroesse des Urteils - ein ungueltiger Wert druckte ein
// Urteil ohne Bezug (Muster extractSpikeDelay in telnyx-call-latency.mjs).
function spikeDelayFrom(raw) {
  if (raw === undefined) return {};
  const ms = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(ms) || ms <= 0)
    return { error: `${SPIKE_FLAG} braucht eine positive Ganzzahl in Millisekunden` };
  return { spikeDelayMs: ms };
}

// process.argv -> {command, service, assistantId, texmlAppId, spikeDelayMs, apply}
// oder {error}. OHNE --apply ist apply:false (Dry-Run) der Default.
export function parseDriverArgs(argv) {
  const collected = collectDriverTokens(argv.slice(2));
  if (collected.error) return { error: collected.error };
  const { commands, values, apply } = collected;
  if (commands.length === 0) return { error: `kein Kommando uebergeben (${COMMANDS.join(" | ")})` };
  if (commands.length > 1)
    return { error: `genau EIN Kommando erlaubt, erhalten: ${commands.join(" ")}` };
  const command = commands[0];
  const missing = REQUIRED_FLAGS_BY_COMMAND[command].filter((flag) => !values[VALUE_FLAGS[flag]]);
  if (missing.length) return { error: `${command} braucht ${missing.join(" ")}` };
  const delay = spikeDelayFrom(values.spikeDelayMs);
  if (delay.error) return { error: delay.error };
  return { command, ...values, ...delay, apply };
}

// Serialisierbarer Vorher-Zustand als ALLOWLIST-PROJEKTION, kein Roh-Dump: assistant
// traegt {id, externalLlm} mit dem ROHEN Telnyx-external_llm-Block (u.a.
// llm_api_key_ref) - uebernommen wird daraus NUR base_url (Regel 4/5).
export function spikeSnapshot({ numbers, assistant }) {
  return {
    numbers: numbers.map(({ e164, id, connectionId }) => ({ e164, id, connectionId })),
    assistant: { id: assistant.id, baseUrl: assistant.externalLlm?.base_url ?? null },
  };
}

// e164-Liste der Nummern, deren Connection NICHT der erwarteten entspricht (leer = alles
// haengt, wo es hingehoert). Grundlage des Rueckbau-Urteils - gemessen, nicht behauptet.
export function connectionMismatches(numbers, expectedConnectionId) {
  return numbers.filter((n) => n.connectionId !== expectedConnectionId).map((n) => n.e164);
}

// ---- Abbruch + Ausgabe --------------------------------------------------------------

function refuse(reason) {
  console.error(`Grund: ${reason}`);
  console.error(
    `Aufruf: node scripts/al-p2-spike-driver.mjs ${ARM} ${SERVICE_FLAG} <url> ${ASSISTANT_FLAG} <id> ${TEXML_APP_FLAG} <id> [${APPLY_FLAG}]`,
  );
  console.error(
    `        node scripts/al-p2-spike-driver.mjs ${MEASURE} ${SERVICE_FLAG} <url> ${SPIKE_FLAG} <ms> [${APPLY_FLAG}]`,
  );
  console.error(`        node scripts/al-p2-spike-driver.mjs ${RESTORE} [${APPLY_FLAG}]`);
  process.exit(1);
}

// ---- Telnyx-IO (je eine Aufgabe, <=1 Objekt-Argument) -------------------------------
// telnyxRequest kommt aus dem geteilten Baustein (src/telephony/adapters/telnyx/http-
// client.js, AL-P2b-Fix1/S2-1) - dieselbe Fetch-/Fehlerstelle wie telnyx-call-latency.mjs
// und telnyx-assistant-provision.mjs, kein eigener Bearer-Header/fetch mehr hier.

function spikeDriverOp(method, apiPath) {
  return `spikeDriver ${method} ${apiPath}`;
}

async function numberResource(e164) {
  const query = new URLSearchParams({ "filter[phone_number]": e164 });
  const data = await telnyxRequest({
    method: "GET",
    path: `${NUMBERS_PATH}?${query}`,
    op: spikeDriverOp("GET", `${NUMBERS_PATH}?${query}`),
  });
  const found = (Array.isArray(data) ? data : []).find((d) => d && d.phone_number === e164);
  if (!found) throw new Error(`Telnyx kennt die Nummer ${e164} nicht (kein phone_number-Record)`);
  return { e164, id: found.id, connectionId: String(found.connection_id ?? "") };
}

async function assistantExternalLlm(assistantId) {
  const path = `${ASSISTANTS_PATH}/${assistantId}`;
  const data = await telnyxRequest({ method: "GET", path, op: spikeDriverOp("GET", path) });
  return data?.external_llm ?? null;
}

async function texmlAppVoiceUrl(texmlAppId) {
  const path = `${TEXML_APPS_PATH}/${texmlAppId}`;
  const data = await telnyxRequest({ method: "GET", path, op: spikeDriverOp("GET", path) });
  return data?.voice_url ?? null;
}

async function setNumberConnection({ numberId, connectionId }) {
  const path = `${NUMBERS_PATH}/${numberId}`;
  await telnyxRequest({
    method: "PATCH",
    path,
    body: { connection_id: connectionId },
    op: spikeDriverOp("PATCH", path),
  });
}

// Sendet den VOLLSTAENDIGEN external_llm-Block: Telnyx' Deep-Merge-Verhalten ist live
// unbestaetigt (dokumentierte Repo-Lehre: nur der Objekt-GET zaehlt), ein Teil-Objekt
// waere kein sicherer Weg.
async function setAssistantExternalLlm({ assistantId, baseUrl }) {
  const path = `${ASSISTANTS_PATH}/${assistantId}`;
  await telnyxRequest({
    method: "POST",
    path,
    body: {
      external_llm: {
        base_url: baseUrl,
        model: config.llm.claudeModel,
        llm_api_key_ref: config.telnyx.telnyxAssistant.shimApiKeyRef,
        forward_metadata: true,
      },
    },
    op: spikeDriverOp("POST", path),
  });
}

// ---- Dienst-IO (unsere eigene API) ---------------------------------------------------

// Basic-Header wird gebaut, nie gedruckt (Regel 4/5).
function dashboardAuthHeader() {
  return (
    "Basic " + Buffer.from(`${DASHBOARD_USER}:${config.auth.dashboardPassword}`).toString("base64")
  );
}

// Der REGULAERE Outbound-Endpunkt: alle Safety-Gates laufen (Absolute Regel 1).
async function placeSpikeCall(service) {
  const res = await fetch(`${service}${CALLS_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: dashboardAuthHeader() },
    body: JSON.stringify({ to: SPIKE_CALLEE, objective: SPIKE_OBJECTIVE }),
  });
  const json = await res.json().catch(() => ({}));
  // Kein Roh-Body in der Meldung (kann Provider-/Konfig-Fragmente tragen) - nur der Status.
  if (!res.ok || !json.callId)
    throw new Error(`POST ${CALLS_PATH} hat keinen Anruf gestartet (HTTP ${res.status})`);
  return json.callId;
}

// Gedeckelter Poll bis zum terminalen Call-Zustand. Liefert den Endstatus oder null
// (Deckel erreicht) - null ist KEIN Erfolg, der Aufrufer meldet es.
async function waitForCallEnd({ service, callId }) {
  const deadline = Date.now() + CALL_POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleepMs(CALL_POLL_INTERVAL_MS);
    const res = await fetch(`${service}${CALLS_PATH}/${callId}`, {
      headers: { Authorization: dashboardAuthHeader() },
    });
    const json = await res.json().catch(() => ({}));
    if (json.status && !ONGOING_CALL_STATUSES.includes(json.status)) return json.status;
  }
  return null;
}

// ---- Snapshot ------------------------------------------------------------------------

function snapshotFilePath() {
  return path.join(config.server.dataDir, SNAPSHOT_FILE);
}

// Schreibt den Vorher-Zustand NUR, wenn noch keiner liegt -> idempotent, und ein zweiter
// --arm kann den Rueckbau nicht mit dem ARMIERT-Zustand vergiften. true = jetzt geschrieben.
function writeSnapshotIfAbsent(snapshotPath, snapshot) {
  if (fs.existsSync(snapshotPath)) return false;
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return true;
}

// ---- Kommandos -----------------------------------------------------------------------

// Fail-closed VOR jedem Netzzugriff (Muster telnyx-call-latency.mjs): kein Key -> kein
// Fetch-Versuch, kein irrefuehrender Netzwerkfehler.
function requireTelnyxKey() {
  if (!config.telephony.telnyxApiKey)
    refuse("kein TELNYX_API_KEY konfiguriert (kein Netzzugriff versucht)");
}

// Ist-Zustand beider Wegwerf-DIDs + des Wegwerf-Assistants. Nur GETs.
async function readSpikeState(assistantId) {
  const numbers = [await numberResource(SPIKE_SENDER), await numberResource(SPIKE_CALLEE)];
  const externalLlm = await assistantExternalLlm(assistantId);
  return { numbers, assistant: { id: assistantId, externalLlm } };
}

async function armCommand({ service, assistantId, texmlAppId, apply }) {
  // Zweiter, gezielter Riegel neben forbiddenTokenIn: der Live-Assistant wird nie beschrieben.
  if (assistantId.startsWith(LIVE_ASSISTANT_PREFIX))
    refuse(`${assistantId} ist der Live-Assistant (Praefix ${LIVE_ASSISTANT_PREFIX}) - verweigert`);
  requireTelnyxKey();

  const state = await readSpikeState(assistantId);
  // Vorbedingung fail-closed: zeigt die Wegwerf-App noch woanders hin, liefe der Testanruf
  // in einen fremden/live Handler und waere verbrannt.
  const expectedVoiceUrl = `${service}${SPIKE_SILENCE_PATH}`;
  const voiceUrl = await texmlAppVoiceUrl(texmlAppId);
  if (voiceUrl !== expectedVoiceUrl)
    refuse(
      `TeXML-App ${texmlAppId} hat voice_url=${voiceUrl ?? NO_VALUE}, erwartet ${expectedVoiceUrl}`,
    );

  const snapshotPath = snapshotFilePath();
  const written = writeSnapshotIfAbsent(snapshotPath, spikeSnapshot(state));
  console.log(
    `snapshot ${written ? "geschrieben" : "bereits vorhanden (unveraendert)"} ${snapshotPath}`,
  );

  const baseUrl = `${service}${SHIM_BASE_SUFFIX}`;
  if (!apply) {
    for (const n of state.numbers)
      console.log(`plan: ${n.e164} connection ${n.connectionId} -> ${texmlAppId}`);
    console.log(`plan: assistant ${assistantId} external_llm.base_url -> ${baseUrl}`);
    return;
  }

  for (const n of state.numbers)
    await setNumberConnection({ numberId: n.id, connectionId: texmlAppId });
  await setAssistantExternalLlm({ assistantId, baseUrl });

  // Verifikation per Objekt-GET, nicht Behauptung.
  const after = await readSpikeState(assistantId);
  const mismatches = connectionMismatches(after.numbers, texmlAppId);
  const liveBaseUrl = after.assistant.externalLlm?.base_url ?? null;
  const armed = mismatches.length === 0 && liveBaseUrl === baseUrl;
  console.log(
    `armed=${armed} mismatches=${mismatches.join(",") || NO_VALUE} assistantBaseUrl=${liveBaseUrl ?? NO_VALUE}`,
  );
  if (!armed) process.exit(1);
}

async function measureCommand({ service, spikeDelayMs, apply }) {
  requireTelnyxKey(); // die Auswertung liest die Conversation ueber die Telnyx-API
  if (!apply) {
    console.log(
      `plan: POST ${service}${CALLS_PATH} to=${SPIKE_CALLEE}, danach Urteil mit ${SPIKE_FLAG}=${spikeDelayMs}`,
    );
    return;
  }
  if (!config.auth.dashboardPassword)
    refuse(`kein DASHBOARD_PASSWORD konfiguriert (Basic-Auth fuer POST ${CALLS_PATH})`);

  const callId = await placeSpikeCall(service);
  const endStatus = await waitForCallEnd({ service, callId });
  if (!endStatus)
    console.warn(
      `Anruf ${callId} nach ${CALL_POLL_MAX_MS} ms noch nicht beendet - werte trotzdem aus`,
    );

  const conversationId = await conversationIdForCall(callId);
  if (!conversationId) refuse(`kein telnyxConversationId am Call ${callId} hinterlegt`);
  const rows = await assistantTurnRowsFor(conversationId);
  const { medianMs, status } = sseSpikeVerdict(rows, spikeDelayMs);
  console.log(
    `sse-spike callId=${callId} conversation=${conversationId} median=${medianMs ?? NO_VALUE} status=${status}`,
  );
}

async function restoreCommand({ apply }) {
  requireTelnyxKey();
  const snapshotPath = snapshotFilePath();
  if (!fs.existsSync(snapshotPath))
    refuse(`kein Snapshot unter ${snapshotPath} - ohne Vorher-Zustand kein Rueckbau`);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  // Derselbe Riegel wie fuer die Argumente (G5): ein manipulierter/fremder Snapshot darf
  // den Live-Bestand nicht umhaengen.
  const forbidden = forbiddenTokenIn([
    ...snapshot.numbers.map((n) => n.e164),
    snapshot.assistant.id,
  ]);
  if (forbidden)
    refuse(`Snapshot enthaelt ${forbidden} (Live-DID/Live-Assistant) - Rueckbau verweigert`);

  if (!apply) {
    for (const n of snapshot.numbers)
      console.log(`plan: ${n.e164} connection -> ${HERMES_TEXML_APP_ID}`);
    console.log(
      `plan: assistant ${snapshot.assistant.id} external_llm.base_url -> ${snapshot.assistant.baseUrl ?? NO_VALUE}`,
    );
    return;
  }

  for (const n of snapshot.numbers)
    await setNumberConnection({ numberId: n.id, connectionId: HERMES_TEXML_APP_ID });
  await setAssistantExternalLlm({
    assistantId: snapshot.assistant.id,
    baseUrl: snapshot.assistant.baseUrl,
  });

  const after = await readSpikeState(snapshot.assistant.id);
  const mismatches = connectionMismatches(after.numbers, HERMES_TEXML_APP_ID);
  const liveBaseUrl = after.assistant.externalLlm?.base_url ?? null;
  const restored = mismatches.length === 0 && liveBaseUrl === snapshot.assistant.baseUrl;
  console.log(
    `restored=${restored} mismatches=${mismatches.join(",") || NO_VALUE} assistantBaseUrl=${liveBaseUrl ?? NO_VALUE}`,
  );
  if (!restored) process.exit(1);
}

const COMMAND_HANDLERS = Object.freeze({
  [ARM]: armCommand,
  [MEASURE]: measureCommand,
  [RESTORE]: restoreCommand,
});

async function main() {
  const forbidden = forbiddenTokenIn(process.argv);
  if (forbidden) refuse(`verbotenes Argument: ${forbidden} (Live-DID/Live-Assistant)`);
  const args = parseDriverArgs(process.argv);
  if (args.error) refuse(args.error);
  await COMMAND_HANDLERS[args.command](args);
}

// Nur als Skript ausfuehren, NICHT beim Import (Muster telnyx-call-latency.mjs - der
// Offline-Test importiert nur die reinen Funktionen, kein Netz-Call/process.exit).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => refuse(`Spike-Treiber fehlgeschlagen: ${err.message}`));
