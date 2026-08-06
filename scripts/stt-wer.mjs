#!/usr/bin/env node
// B-7 (tasks/todo.md, Messgrundlage): read-only Messung der Spracherkennungs-Guete eines
// echten Anrufs. Beantwortet die Frage, die ohne Zahl nur gefuehlt beantwortbar ist:
// "versteht der Agent den Menschen am Telefon?"
//
// Aufbau: Telnyx zeichnet DUAL-CHANNEL auf (Gegenstelle und Agent auf getrennten Kanaelen).
// Wir isolieren beide Kanaele, lassen sie von einem ZWEITEN, unabhaengigen Erkenner
// abschreiben und rechnen die Wortfehlerrate (WER) gegen das, was Telnyx' eigener Erkenner
// verstanden hat (GET /v2/ai/conversations/{id}/messages, Rolle user).
//
// Der Agentenkanal traegt eine ECHTE Ground Truth - wir wissen aus demselben Protokoll, was
// der Agent gesagt hat. Die WER dort ist die Messgenauigkeit der Referenz selbst und wird
// immer mit ausgegeben: ohne diese Kontrolle ist die Hauptzahl nicht interpretierbar.
// (Einschraenkung, bewusst: der Agentenkanal ist TTS-Audio und damit leichter als
// menschliche Sprache - die Kontrollzahl ist eine UNTERGRENZE des Referenzfehlers.)
//
// NUR GET/POST-lesend: keine Aenderung am Live-Assistant, kein Call. Die Aufnahme ist ein
// echtes Gespraech mit einem echten Menschen (Absolute Regel 5): sie landet in einem
// temporaeren Verzeichnis AUSSERHALB des Repos und wird am Ende geloescht (--keep-audio
// haelt sie bewusst, dann nennt das Skript den Pfad und die Loeschpflicht).
//
// Aufruf: node scripts/stt-wer.mjs <call_session_id> [--keep-audio]
//         node scripts/stt-wer.mjs --recording <aufnahme-id>
//         node scripts/stt-wer.mjs <...> --conversation <telnyx-conversation-uuid>
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";
import { assertTelnyxOk } from "../src/telephony/adapters/telnyx/errors.js";

const execFileAsync = promisify(execFile);

const RECORDINGS_PATH = "/v2/recordings";
const AI_CONVERSATIONS_PATH = "/v2/ai/conversations";
const USER_ROLE = "user";
const ASSISTANT_ROLE = "assistant";

// Die Referenz. scribe_v1 ist der Batch-Erkenner von ElevenLabs; er sieht die ganze
// Aeusserung statt eines Streams und ist damit bewusst NICHT vergleichbar mit einem
// Echtzeit-Erkenner - genau deshalb taugt er als Messlatte.
const REFERENCE_MODEL = "scribe_v1";
const REFERENCE_LANGUAGE = "deu";
const SPEECH_TO_TEXT_PATH = "/v1/speech-to-text";

// Die Aufnahme kommt als 8-kHz-MP3; 16 kHz mono je Kanal ist das, was der Referenz-Erkenner
// erwartet. Hochtasten fuegt keine Information hinzu, vermeidet aber eine Resampling-Stufe
// im fremden Dienst, die wir nicht beobachten koennen.
const REFERENCE_SAMPLE_RATE_HZ = 16000;
const CHANNEL_LABELS = Object.freeze(["links", "rechts"]);

// Telnyx' Konversations-Liste kennt keinen Filter auf metadata.call_session_id - wir blaettern.
// Die Grenze ist eine Notbremse gegen eine Endlosschleife bei einem API-Wechsel, kein Tuning.
const CONVERSATION_PAGE_SIZE = 25;
const MAX_CONVERSATION_PAGES = 20;

// Der Zeitanker der Zuordnung: Aufnahme-Start = created_at minus Dauer. Faellt er weiter als
// diese Schranke vom Konversations-Start weg, stimmt die Annahme ueber created_at nicht mehr
// und die Turn-Zuordnung waere geraten - dann warnt das Skript, statt still falsch zuzuordnen.
const MAX_ANCHOR_DRIFT_SECS = 3;
// Ein Wort, das knapp vor dem Ende des Vorgaenger-Fensters beginnt, gehoert noch zum
// naechsten Turn (Telnyx' ended_at ist der Erkennungs-, nicht der Sprech-Zeitpunkt).
const TURN_WINDOW_LEAD_SECS = 0.4;

const HTTP_TIMEOUT_MS = 300_000;

// Satzzeichen weg, Kleinschreibung - Umlaute BLEIBEN, sie sind bedeutungstragend
// ("Vaters" vs. "Vater"). Ein Erkenner, der Umlaute verliert, soll dafuer bestraft werden.
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;

// Telnyx mischt zwei Zeitstempel-Formate: Aufnahmen liefern "2026-08-06T09:41:32" OHNE
// Zeitzone, Konversations-Nachrichten "…Z". `Date.parse` liest den ersten als ORTSZEIT - in
// Europa/Berlin also 2 h daneben. Alles laeuft deshalb durch EINE Stelle (G5), die einen
// fehlenden Zonenanteil als UTC liest. Ohne das war die Turn-Zuordnung um 7200 s verschoben,
// und die Anker-Pruefung hat es nicht gefangen, weil sie zwei gleich falsch geparste Werte
// verglich - ein Selbsttest, der denselben Fehler macht wie der Code, prueft nichts.
export function parseProviderTime(value) {
  const text = String(value || "");
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(text);
  return Date.parse(hasZone ? text : `${text}Z`);
}

export function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(PUNCTUATION, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Editierdistanz auf Wortebene, aufgeschluesselt nach Fehlerart. Die drei Zaehler kosten
// nichts extra und sagen mehr als die Summe: viele "fehlend" heisst abgeschnitten, viele
// "ersetzt" heisst falsch verstanden - zwei verschiedene Wurzeln.
export function wordErrorRate(reference, hypothesis) {
  const rows = reference.length;
  const cols = hypothesis.length;
  let previous = Array.from({ length: cols + 1 }, (_, j) => ({
    distance: j,
    substitutions: 0,
    insertions: j,
    deletions: 0,
  }));
  for (let i = 1; i <= rows; i += 1) {
    const current = [{ distance: i, substitutions: 0, insertions: 0, deletions: i }];
    for (let j = 1; j <= cols; j += 1) {
      if (reference[i - 1] === hypothesis[j - 1]) {
        current[j] = previous[j - 1];
        continue;
      }
      current[j] = cheapestEdit(previous[j - 1], current[j - 1], previous[j]);
    }
    previous = current;
  }
  const result = previous[cols];
  return { ...result, rate: rows ? result.distance / rows : NaN, referenceWords: rows };
}

function cheapestEdit(substitute, insert, remove) {
  const best = [substitute, insert, remove].reduce((a, b) => (a.distance <= b.distance ? a : b));
  if (best === substitute) {
    return { ...best, distance: best.distance + 1, substitutions: best.substitutions + 1 };
  }
  if (best === insert) {
    return { ...best, distance: best.distance + 1, insertions: best.insertions + 1 };
  }
  return { ...best, distance: best.distance + 1, deletions: best.deletions + 1 };
}

// Die Kanal-Zuordnung wird GEMESSEN, nicht angenommen: der Kanal, dessen Abschrift dem
// bekannten Agententext aehnlicher ist, IST der Agentenkanal. Eine feste Annahme ("links ist
// immer die Gegenstelle") waere eine Konvention, die bei einem Anbieter-Wechsel still kippt.
export function pickCounterpartChannel(agentSimilarityByChannel) {
  const agentChannel = agentSimilarityByChannel.indexOf(Math.min(...agentSimilarityByChannel));
  return agentChannel === 0 ? 1 : 0;
}

// Ordnet jeder erkannten Aeusserung das Zeitfenster zu, in dem sie gesprochen wurde, und
// sammelt die Referenzwoerter darin. Telnyx liefert ended_at je Nachricht; der Anfang ist das
// Ende der vorigen.
export function assignTurnWindows(userMessages, referenceWords, recordingStartMs) {
  const turns = [];
  let windowStart = 0;
  for (const message of userMessages) {
    const windowEnd = (parseProviderTime(message.ended_at) - recordingStartMs) / 1000;
    const spoken = referenceWords.filter(
      (word) => word.start >= windowStart - TURN_WINDOW_LEAD_SECS && word.start < windowEnd,
    );
    turns.push({
      windowStart,
      windowEnd,
      spoken: spoken.map((word) => word.text).join(" "),
      recognized: message.text || "",
    });
    windowStart = windowEnd;
  }
  const trailing = referenceWords.filter((word) => word.start >= windowStart);
  return { turns, trailing: trailing.map((word) => word.text).join(" ") };
}

async function telnyxGet(path, { apiKey, apiBase }) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  await assertTelnyxOk(res, `GET ${path}`);
  const body = await res.json();
  return body.data;
}

// call_session_id und recording_id sind BEIDE 36-stellige UUIDs - aus der Zeichenkette
// allein ist nicht entscheidbar, welche vorliegt. Deshalb wird es gesagt, nicht geraten:
// Positionsargument = call_session_id, --recording = Aufnahme-ID.
async function findRecording({ callSessionId, recordingId }, telnyx) {
  if (recordingId) return telnyxGet(`${RECORDINGS_PATH}/${recordingId}`, telnyx);
  const list = await telnyxGet(
    `${RECORDINGS_PATH}?filter%5Bcall_session_id%5D=${encodeURIComponent(callSessionId)}`,
    telnyx,
  );
  const recording = (list || []).find((entry) => entry.call_session_id === callSessionId);
  if (!recording) throw new Error(`Keine Aufnahme zu call_session_id ${callSessionId}`);
  return recording;
}

async function findConversation(callSessionId, telnyx) {
  for (let page = 1; page <= MAX_CONVERSATION_PAGES; page += 1) {
    const query = `page%5Bsize%5D=${CONVERSATION_PAGE_SIZE}&page%5Bnumber%5D=${page}`;
    const conversations = await telnyxGet(`${AI_CONVERSATIONS_PATH}?${query}`, telnyx);
    if (!conversations || conversations.length === 0) break;
    const hit = conversations.find((c) => (c.metadata || {}).call_session_id === callSessionId);
    if (hit) return hit.id;
  }
  throw new Error(`Keine Telnyx-Konversation mit call_session_id ${callSessionId} gefunden`);
}

async function splitChannels(mp3Path, workDir) {
  const [left, right] = CHANNEL_LABELS.map((_, i) => join(workDir, `kanal${i}.wav`));
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", "-i", mp3Path,
    "-filter_complex", "[0:a]channelsplit=channel_layout=stereo[L][R]",
    "-map", "[L]", "-ar", String(REFERENCE_SAMPLE_RATE_HZ), left,
    "-map", "[R]", "-ar", String(REFERENCE_SAMPLE_RATE_HZ), right,
  ]);
  return [left, right];
}

async function transcribeReference(wavPath, elevenLabs) {
  const form = new FormData();
  form.append("model_id", REFERENCE_MODEL);
  form.append("language_code", REFERENCE_LANGUAGE);
  form.append("timestamps_granularity", "word");
  form.append("file", new Blob([await readFile(wavPath)]), "kanal.wav");
  const res = await fetch(`${elevenLabs.apiBase}${SPEECH_TO_TEXT_PATH}`, {
    method: "POST",
    headers: { "xi-api-key": elevenLabs.apiKey },
    body: form,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  // Kein Roh-Body in die Meldung (er kann Gespraechsinhalt tragen) - Status reicht zur Diagnose.
  if (!res.ok) throw new Error(`Referenz-Erkenner antwortete HTTP ${res.status}`);
  const body = await res.json();
  return {
    text: body.text || "",
    words: (body.words || []).filter((word) => word.type === "word"),
  };
}

function messagesByRole(messages, role) {
  return messages
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((message) => message.role === role);
}

function formatRate({ rate, substitutions, insertions, deletions, referenceWords }) {
  const percent = Number.isNaN(rate) ? "n/a" : `${(rate * 100).toFixed(1)} %`;
  return `${percent}  (${referenceWords} Referenzwoerter; ersetzt ${substitutions}, eingefuegt ${insertions}, fehlend ${deletions})`;
}

function reportAnchor(recordingStartMs, conversationStartMs) {
  const driftSecs = Math.abs(recordingStartMs - conversationStartMs) / 1000;
  console.log(`Zeitanker-Abweichung Aufnahme/Konversation: ${driftSecs.toFixed(2)} s`);
  if (driftSecs > MAX_ANCHOR_DRIFT_SECS) {
    console.log(
      `WARNUNG: > ${MAX_ANCHOR_DRIFT_SECS} s - die Turn-Zuordnung unten ist NICHT belastbar.`,
    );
  }
}

function reportTurns(turns, trailing) {
  console.log("\n--- Turn fuer Turn ---");
  for (const turn of turns) {
    const reference = normalizeWords(turn.spoken);
    const suffix = reference.length
      ? ` [WER ${(wordErrorRate(reference, normalizeWords(turn.recognized)).rate * 100).toFixed(0)} %]`
      : "";
    console.log(`\n  [${turn.windowStart.toFixed(1)}s - ${turn.windowEnd.toFixed(1)}s]${suffix}`);
    console.log(`    GESPROCHEN : ${turn.spoken}`);
    console.log(`    ERKANNT    : ${turn.recognized}`);
  }
  if (trailing) {
    console.log("\n  [ohne zugeordnete Erkennung - vom Erkenner gar nicht geliefert]");
    console.log(`    GESPROCHEN : ${trailing}`);
  }
}

async function measure(options) {
  const { conversationOverride, keepAudio } = options;
  const telnyx = { apiKey: config.telephony.telnyxApiKey, apiBase: config.telephony.telnyxApiBase };
  const elevenLabs = config.voice.elevenLabsPlayTts;
  if (!telnyx.apiKey) throw new Error("TELNYX_API_KEY fehlt - ohne Key kein Netzzugriff.");
  if (!elevenLabs.apiKey) throw new Error("ELEVENLABS_API_KEY fehlt - ohne Referenz keine Messung.");

  const recording = await findRecording(options, telnyx);
  const conversationId =
    conversationOverride || (await findConversation(recording.call_session_id, telnyx));
  const messages = await telnyxGet(`${AI_CONVERSATIONS_PATH}/${conversationId}/messages`, telnyx);
  const conversation = await telnyxGet(`${AI_CONVERSATIONS_PATH}/${conversationId}`, telnyx);

  const recordingStartMs = parseProviderTime(recording.created_at) - recording.duration_millis;
  console.log(`Aufnahme      ${recording.id}  (${(recording.duration_millis / 1000).toFixed(1)} s, ${recording.channels})`);
  console.log(`Konversation  ${conversationId}`);
  reportAnchor(recordingStartMs, parseProviderTime(conversation.created_at));

  const workDir = await mkdtemp(join(tmpdir(), "hermes-stt-wer-"));
  try {
    const mp3Path = join(workDir, "aufnahme.mp3");
    const audio = await fetch(recording.download_urls.mp3, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!audio.ok) throw new Error(`Aufnahme-Download HTTP ${audio.status}`);
    await writeFile(mp3Path, Buffer.from(await audio.arrayBuffer()));

    const wavPaths = await splitChannels(mp3Path, workDir);
    const references = [];
    for (const wavPath of wavPaths) references.push(await transcribeReference(wavPath, elevenLabs));

    const agentTruth = normalizeWords(
      messagesByRole(messages, ASSISTANT_ROLE).map((m) => m.text || "").join(" "),
    );
    const controls = references.map((r) => wordErrorRate(agentTruth, normalizeWords(r.text)));
    const counterpart = pickCounterpartChannel(controls.map((c) => c.rate));

    console.log(`\nKanal-Zuordnung (gemessen): Gegenstelle = ${CHANNEL_LABELS[counterpart]}`);
    console.log(`KONTROLLE  Referenz gegen bekannten Agententext: ${formatRate(controls[1 - counterpart])}`);
    console.log("           (TTS-Audio - das ist die UNTERGRENZE des Referenzfehlers)");

    const userMessages = messagesByRole(messages, USER_ROLE);
    const main = wordErrorRate(
      normalizeWords(references[counterpart].text),
      normalizeWords(userMessages.map((m) => m.text || "").join(" ")),
    );
    console.log(`\nERGEBNIS   Anbieter-Erkenner auf der Gegenstelle: ${formatRate(main)}`);

    const { turns, trailing } = assignTurnWindows(
      userMessages,
      references[counterpart].words,
      recordingStartMs,
    );
    reportTurns(turns, trailing);
    return main;
  } finally {
    if (keepAudio) {
      console.log(`\nAudio BEHALTEN in ${workDir} - nach Gebrauch loeschen (Absolute Regel 5).`);
    } else {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

export function parseArgs(argv) {
  const flagValue = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] || "" : "";
  };
  return {
    callSessionId: argv.find((arg) => !arg.startsWith("--")) || "",
    recordingId: flagValue("--recording"),
    conversationOverride: flagValue("--conversation"),
    keepAudio: argv.includes("--keep-audio"),
  };
}

const USAGE =
  "Aufruf: node scripts/stt-wer.mjs <call_session_id> [--recording <id>] " +
  "[--conversation <uuid>] [--keep-audio]";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.callSessionId && !options.recordingId) {
    console.error(USAGE);
    process.exit(2);
  }
  measure(options).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
