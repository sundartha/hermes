#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { config } from "../src/config.js";
import { assertTelnyxOk } from "../src/telephony/adapters/telnyx/errors.js";

const execFileAsync = promisify(execFile);

const RECORDINGS_PATH = "/v2/recordings";
const AI_CONVERSATIONS_PATH = "/v2/ai/conversations";
const USER_ROLE = "user";
const ASSISTANT_ROLE = "assistant";

const REFERENCE_MODEL = "scribe_v1";
const REFERENCE_LANGUAGE = "deu";
const SPEECH_TO_TEXT_PATH = "/v1/speech-to-text";

const REFERENCE_SAMPLE_RATE_HZ = 16000;
const CHANNEL_LABELS = Object.freeze(["links", "rechts"]);

const CONVERSATION_PAGE_SIZE = 25;
const MAX_CONVERSATION_PAGES = 20;

const MAX_ANCHOR_DRIFT_SECS = 3;
const TURN_WINDOW_LEAD_SECS = 0.4;

const HTTP_TIMEOUT_MS = 300_000;

const LIVE_STT_WS_PATH = "/v2/speech-to-text/transcription";
const LIVE_STT_ENGINE = "Deepgram";
const LIVE_STT_MODEL = "nova-3";
const LIVE_STT_LANGUAGE = "de";
const PCM16_BYTES_PER_SAMPLE = 2;
const LIVE_STT_CHUNK_BYTES = 4096;
const LIVE_STT_CONNECT_TIMEOUT_MS = 15_000;
const LIVE_STT_TRAILING_WAIT_MS = 2_500;
const LIVE_STT_OVERALL_TIMEOUT_MS = 120_000;

export function fingerprint(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 12);
}

export function hasPunctuation(text) {
  return /[.,!?]/.test(String(text || ""));
}
export function hasUppercase(text) {
  return /\p{Lu}/u.test(String(text || ""));
}

async function transcribeLiveWs(wavPath, { apiKey, apiBase, smartFormat, numerals }) {
  const wsBase = apiBase.replace(/^http/, "ws");
  const url = new URL(`${wsBase}${LIVE_STT_WS_PATH}`);
  url.searchParams.set("transcription_engine", LIVE_STT_ENGINE);
  url.searchParams.set("model", LIVE_STT_MODEL);
  url.searchParams.set("input_format", "wav");
  url.searchParams.set("language", LIVE_STT_LANGUAGE);
  url.searchParams.set("interim_results", "true");
  if (smartFormat) url.searchParams.set("smart_format", "true");
  if (numerals) url.searchParams.set("numerals", "true");

  const audio = await readFile(wavPath);
  const bytesPerSecond = REFERENCE_SAMPLE_RATE_HZ * PCM16_BYTES_PER_SAMPLE;
  const chunkDelayMs = (LIVE_STT_CHUNK_BYTES / bytesPerSecond) * 1000;

  return new Promise((resolve, reject) => {
    const finals = [];
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      fn(value);
    };
    const overallTimeout = setTimeout(() => {
      done(reject, new Error("Live-STT-WebSocket: Timeout ohne Abschluss"));
      ws.terminate();
    }, LIVE_STT_OVERALL_TIMEOUT_MS);

    const ws = new WebSocket(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      handshakeTimeout: LIVE_STT_CONNECT_TIMEOUT_MS,
    });

    ws.on("open", async () => {
      try {
        for (let offset = 0; offset < audio.length; offset += LIVE_STT_CHUNK_BYTES) {
          ws.send(audio.subarray(offset, offset + LIVE_STT_CHUNK_BYTES));
          await sleep(chunkDelayMs);
        }
        await sleep(LIVE_STT_TRAILING_WAIT_MS);
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch (err) {
        done(reject, err);
        ws.terminate();
      }
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.errors) {
        done(reject, new Error(`Live-STT-WebSocket meldet Fehler: ${JSON.stringify(msg.errors)}`));
        ws.terminate();
        return;
      }
      if (msg.is_final && msg.transcript) finals.push(msg.transcript);
    });

    ws.on("close", () => done(resolve, finals.join(" ").trim()));
    ws.on("error", (err) => done(reject, err));
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => done(reject, new Error(
        `Live-STT-WebSocket: Handshake abgelehnt, HTTP ${res.statusCode} ${body.slice(0, 300)}`,
      )));
    });
  });
}

async function reportLiveWsComparison(wavPath, reference, telnyx, { smartFormat, numerals }) {
  console.log(
    `\n--- Live-STT ueber Telnyx-Standalone-WebSocket (${LIVE_STT_ENGINE} ${LIVE_STT_MODEL}, ` +
      `smart_format=${smartFormat ? "true" : "aus"}, numerals=${numerals ? "true" : "aus"}) ---`,
  );
  const transcript = await transcribeLiveWs(wavPath, { ...telnyx, smartFormat, numerals });
  const wer = wordErrorRate(normalizeWords(reference.text), normalizeWords(transcript));
  console.log(`Fingerabdruck (SHA-256/12): ${fingerprint(transcript)}`);
  console.log(`Satzzeichen: ${hasPunctuation(transcript) ? "ja" : "nein"}   Grossschreibung: ${hasUppercase(transcript) ? "ja" : "nein"}`);
  console.log(`WER gegen ElevenLabs-Referenz: ${formatRate(wer)}`);
  console.log(`TRANSKRIPT: ${transcript}`);
}

const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;

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

export function pickCounterpartChannel(agentSimilarityByChannel) {
  const agentChannel = agentSimilarityByChannel.indexOf(Math.min(...agentSimilarityByChannel));
  return agentChannel === 0 ? 1 : 0;
}

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

    if (options.liveStt) {
      await reportLiveWsComparison(wavPaths[counterpart], references[counterpart], telnyx, options);
    }

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
    liveStt: argv.includes("--live-stt"),
    smartFormat: argv.includes("--smart-format"),
    numerals: argv.includes("--numerals"),
  };
}

const USAGE =
  "Aufruf: node scripts/stt-wer.mjs <call_session_id> [--recording <id>] " +
  "[--conversation <uuid>] [--keep-audio] [--live-stt [--smart-format] [--numerals]]";

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
