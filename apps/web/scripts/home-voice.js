import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VOICE_LANGS,
  VOICE_MODEL,
  VOICE_ROLES,
  VOICE_SCRIPT,
  VOICE_SPEAKERS,
  clipDuration,
  voiceAudioFile,
  voiceBedFile,
  voiceCaptionFile,
  voiceCharacters,
  voiceVideoFiles,
} from "../src/lib/home-voice.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_OUT = join(WEB_ROOT, "public/assets/home");
const DEFAULT_BEDS = join(WEB_ROOT, "scripts/home-voice-beds");
const DEFAULT_CACHE = join(WEB_ROOT, "node_modules/.cache/home-voice");
const API_BASE = "https://api.elevenlabs.io";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_TEMPO = 1.08;
const MS_PER_S = 1000;
const OUTPUT_FORMAT = "mp3_44100_128";
const VOICE_SETTINGS = Object.freeze({ stability: 0.5, similarity_boost: 0.75, speed: 1.15 });
const LOUDNESS = "loudnorm=I=-16:TP=-1.5:LRA=11";
const PHONE_FILTER = "highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=3";
const BED_FILTER = "volume=1.0";
const FIRST_LINE_INPUT = 1;
const AUDIO_ENCODE = ["-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "44100", "-movflags", "+faststart"];
const CUE_PLACEMENT = "line:8%";
const HTTP_UNAUTHORIZED = 401;
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;
const DECIMALS = 3;
const CACHE_NAME_LENGTH = 24;
const SHOWN_DECIMALS = 2;
const ARGV_OFFSET = 2;
const TIME_PAD = 2;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export class VoiceError extends Error {}
export class KeyError extends VoiceError {}

export function parseArgs(argv) {
  const options = { clips: Object.keys(VOICE_SCRIPT), langs: [...VOICE_LANGS], out: DEFAULT_OUT, cache: DEFAULT_CACHE, beds: DEFAULT_BEDS, dry: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry") options.dry = true;
    else if (flag === "--clip") options.clips = argv[++index].split(",");
    else if (flag === "--lang") options.langs = argv[++index].split(",");
    else if (flag === "--out") options.out = argv[++index];
    else if (flag === "--cache") options.cache = argv[++index];
    else if (flag === "--beds") options.beds = argv[++index];
    else throw new VoiceError(`Unbekannte Option: ${flag}`);
  }
  return options;
}

const KEY_SHAPE = /^[\x21-\x7e]{20,200}$/;
export const KEY_HINT = 'Schlüssel fehlt: printf "%s" "$ELEVENLABS_API_KEY" | node apps/web/scripts/home-voice.js';

export async function readKey(input) {
  if (input.isTTY) throw new VoiceError(KEY_HINT);
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  const key = Buffer.concat(chunks).toString("utf8").trim();
  if (!key) throw new VoiceError(KEY_HINT);
  if (!KEY_SHAPE.test(key)) throw new KeyError("Die Eingabe sieht nicht wie ein Schlüssel aus; nichts gesendet.");
  return key;
}

function timestamp(seconds) {
  const hours = Math.floor(seconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const rest = (seconds % SECONDS_PER_MINUTE).toFixed(DECIMALS).padStart(DECIMALS + TIME_PAD + 1, "0");
  return `${String(hours).padStart(TIME_PAD, "0")}:${String(minutes).padStart(TIME_PAD, "0")}:${rest}`;
}

const cueText = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function captionsVtt(lines, lang) {
  const blocks = lines.map(
    (line) => `${timestamp(line.at)} --> ${timestamp(line.end ?? line.until)} ${CUE_PLACEMENT}\n<v ${VOICE_SPEAKERS[lang][line.who]}>${cueText(line.text)}`,
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function fitLine(line, spokenSeconds) {
  const window = line.until - line.at;
  if (spokenSeconds <= window) return { tempo: 1, end: line.at + spokenSeconds };
  const tempo = spokenSeconds / window;
  if (tempo > MAX_TEMPO) return null;
  return { tempo, end: line.until };
}

async function api(key, path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": key, ...(init.headers || {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === HTTP_UNAUTHORIZED) throw new KeyError("ElevenLabs lehnt den Schlüssel ab (HTTP 401): Schlüssel prüfen und erneut übergeben.");
  if (!response.ok) throw new VoiceError(`ElevenLabs ${path.split("?")[0]}: HTTP ${response.status}`);
  return response;
}

export async function checkVoices(key, roles = VOICE_ROLES) {
  const missing = [];
  for (const [role, { voiceId }] of Object.entries(roles)) {
    try {
      await api(key, `/v1/voices/${voiceId}`);
    } catch (error) {
      if (error instanceof KeyError) throw error;
      missing.push(`${role} (${voiceId})`);
    }
  }
  if (missing.length) {
    throw new VoiceError(`Stimme im Konto nicht verfügbar: ${missing.join(", ")}. In der Voice Library hinzufügen oder die Voice-ID in src/lib/home-voice.js ersetzen.`);
  }
}

function cacheName(line, lang) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([VOICE_ROLES[line.who].voiceId, VOICE_MODEL, lang, line.text, VOICE_SETTINGS]));
  return `${hash.digest("hex").slice(0, CACHE_NAME_LENGTH)}.mp3`;
}

async function synthesize(context, line, lang) {
  const file = join(context.cache, cacheName(line, lang));
  if (existsSync(file)) return file;
  const key = await context.key();
  const response = await api(key, `/v1/text-to-speech/${VOICE_ROLES[line.who].voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: line.text, model_id: VOICE_MODEL, language_code: lang, voice_settings: VOICE_SETTINGS }),
  });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

function seconds(file) {
  const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(output.trim());
}

function lineFilter(line, index) {
  const steps = [];
  if (line.line) steps.push(PHONE_FILTER);
  if (line.tempo !== 1) steps.push(`atempo=${line.tempo.toFixed(DECIMALS)}`);
  steps.push(`adelay=${Math.round(line.at * MS_PER_S)}:all=1`);
  return `[${index + FIRST_LINE_INPUT}:a]${steps.join(",")}[l${index}]`;
}

export function mixGraph(lines, duration) {
  const inputs = lines.map((line, index) => `[l${index}]`).join("");
  const mix = `[bed]${inputs}amix=inputs=${lines.length + 1}:normalize=0,apad=whole_dur=${duration},${LOUDNESS}[out]`;
  return [`[0:a]${BED_FILTER}[bed]`, ...lines.map(lineFilter), mix].join(";");
}

function writeMix(mix, target) {
  const inputs = ["-i", mix.bed, ...mix.lines.flatMap((line) => ["-i", line.file])];
  const graph = mixGraph(mix.lines, mix.duration);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-t", String(mix.duration), ...AUDIO_ENCODE, target]);
}

function muxInto(video, track) {
  if (!existsSync(video)) return;
  const muxed = `${video}.muxed.mp4`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", track, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", muxed]);
  renameSync(muxed, video);
}

async function placeLine(context, line, lang) {
  if (line.filmed) return { ...line, end: line.until };
  const file = await synthesize(context, line, lang);
  const spoken = seconds(file);
  const fit = fitLine(line, spoken);
  if (fit) return { ...line, ...fit, file };
  return { ...line, overflow: `„${line.text}“ ${line.at}s: ${spoken.toFixed(SHOWN_DECIMALS)} s gesprochen, Fenster ${(line.until - line.at).toFixed(SHOWN_DECIMALS)} s` };
}

async function renderTrack(context, clip, lang) {
  const bed = join(context.beds, voiceBedFile(clip));
  if (!existsSync(bed)) throw new VoiceError(`Originalton fehlt: ${bed}`);
  const placed = [];
  for (const line of VOICE_SCRIPT[clip][lang]) placed.push(await placeLine(context, line, lang));
  const overflow = placed.filter((line) => line.overflow).map((line) => `${clip}/${lang} ${line.overflow}`);
  if (overflow.length) throw new VoiceError(`Zeile passt nicht ins Zeitfenster:\n${overflow.join("\n")}`);
  const mix = { bed, lines: placed.filter((line) => line.file), duration: clipDuration(clip) };
  const track = join(context.cache, voiceAudioFile(clip, lang));
  writeMix(mix, track);
  for (const name of voiceVideoFiles(clip)) muxInto(join(context.out, name), track);
  writeFileSync(join(context.out, voiceCaptionFile(clip, lang)), captionsVtt(placed, lang));
  return placed;
}

export async function run(argv, input, log) {
  const options = parseArgs(argv);
  log(`Zeichen im Skript (alle Szenen, ${VOICE_LANGS.join("+")}): ${voiceCharacters()}`);
  if (options.dry) return [];
  mkdirSync(options.cache, { recursive: true });
  let checked;
  const key = () => {
    checked ??= readKey(input).then(async (value) => {
      await checkVoices(value);
      return value;
    });
    return checked;
  };
  const context = { key, cache: options.cache, out: options.out, beds: options.beds };
  const written = [];
  for (const clip of options.clips) {
    for (const lang of options.langs) {
      await renderTrack(context, clip, lang);
      written.push(voiceCaptionFile(clip, lang));
      log(`fertig: ${clip} (Ton in den Videodateien, ${voiceCaptionFile(clip, lang)})`);
    }
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(ARGV_OFFSET), process.stdin, (message) => process.stdout.write(`${message}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof VoiceError ? error.message : error.stack}\n`);
    process.exitCode = error instanceof VoiceError ? EXIT_USAGE : EXIT_FAILED;
  });
}
