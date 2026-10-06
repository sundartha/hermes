#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "../test/helpers.js";
import { config } from "../src/config.js";
import { classifySprechpfad, SPRECHPFAD } from "../src/telephony/sprechpfad.js";

function elevenLabsEnvOverrides() {
  const { enabled, apiKey, voiceId, model, apiBase, outputFormat, synthTimeoutMs, synthTotalTimeoutMs } =
    config.voice.elevenLabsPlayTts;
  return {
    ELEVENLABS_API_BASE: apiBase,
    ELEVENLABS_PLAY_TTS_ENABLED: String(enabled),
    ELEVENLABS_API_KEY: apiKey,
    ELEVENLABS_VOICE_ID: voiceId,
    ELEVENLABS_MODEL: model,
    ELEVENLABS_OUTPUT_FORMAT: outputFormat,
    ELEVENLABS_SYNTH_TIMEOUT_MS: String(synthTimeoutMs),
    ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: String(synthTotalTimeoutMs),
  };
}

function reportElevenLabsEnvState() {
  const { enabled, apiKey } = config.voice.elevenLabsPlayTts;
  console.log("[inbound-hoerprobe] ElevenLabs-Play-TTS-Konfiguration:");
  console.log(`  ELEVENLABS_PLAY_TTS_ENABLED=${enabled}`);
  console.log(`  ELEVENLABS_API_KEY=${apiKey ? "gesetzt" : "leer"}`);
}

const METRICS_LINE = /^\[metrics\] (turn|stt_gap|speech_result|llm)\b/;
function printMetricsLines(stdout) {
  const lines = stdout.split("\n").filter((line) => METRICS_LINE.test(line));
  if (lines.length === 0) {
    console.log("Latenz-Marken: keine (dieser Aufruf loest keinen /voice/turn aus)");
    return;
  }
  console.log("Latenz-Marken:");
  for (const line of lines) console.log(`  ${line}`);
}

const SYNTH_LINE = /^\[play-tts\] Synthese /;
function printSyntheseLine(stdout) {
  const line = stdout.split("\n").find((zeile) => SYNTH_LINE.test(zeile));
  console.log(line ? `  ${line}` : "  (keine Synthese-Zeile im Server-Log)");
}

const AUDIO_EXTENSION_BY_CONTENT_TYPE = Object.freeze({ "audio/mpeg": "mp3", "audio/mp3": "mp3" });
const DEFAULT_AUDIO_EXTENSION = "bin";

async function downloadPlayAudio(srv, texml, outDir) {
  const match = texml.match(/\/voice\/tts\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("sprechpfad=play_tts, aber keine /voice/tts/-URL im TeXML gefunden");
  const res = await fetch(`${srv.localUrl}/voice/tts/${match[1]}`);
  if (!res.ok) throw new Error(`TTS-Abruf fehlgeschlagen: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "";
  const ext = AUDIO_EXTENSION_BY_CONTENT_TYPE[contentType] || DEFAULT_AUDIO_EXTENSION;
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `greeting.${ext}`);
  fs.writeFileSync(file, bytes);
  return { file, bytes: bytes.length, contentType };
}

export function parseArgs(argv) {
  const idx = argv.indexOf("--out");
  return { out: idx >= 0 ? argv[idx + 1] : undefined };
}

const USAGE = "Aufruf: node scripts/inbound-hoerprobe.mjs --out <verzeichnis>";
const CALL_SID = "CAhoerprobe";
const HTTP_OK = 200;
const CLI_ARGS_OFFSET = 2;

export async function run({ out }) {
  if (!out) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const outDir = path.resolve(out);
  reportElevenLabsEnvState();

  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: { METRICS_ENABLED: "true", ...elevenLabsEnvOverrides() },
  });
  try {
    const startedAt = Date.now();
    const res = await postTelnyxIncoming(srv, { callSid: CALL_SID });
    const texml = await res.text();
    const webhookWartezeitMs = Date.now() - startedAt;
    if (res.status !== HTTP_OK) {
      console.error(`/voice/incoming antwortete mit HTTP ${res.status}:\n${texml}`);
      process.exitCode = 1;
      return;
    }

    const pfad = classifySprechpfad(texml);
    if (!pfad) {
      console.error(`Unbekannter Sprechpfad (weder <Say> noch <Play>), TeXML:\n${texml}`);
      process.exitCode = 1;
      return;
    }
    const voiceMatch = texml.match(/<Say voice="([^"]+)"/);
    console.log(
      `sprechpfad=${pfad} modell=${config.voice.elevenLabsPlayTts.model}` +
        `${voiceMatch ? ` voice=${voiceMatch[1]}` : ""}`,
    );
    console.log(`webhook_wartezeit_ms=${webhookWartezeitMs}`);

    const call = srv.readStore().calls.find((entry) => entry.twilioSid === CALL_SID);
    const agentLine = call?.transcript.find((turn) => turn.role === "agent");
    console.log(agentLine?.text ?? "(kein Transkript-Eintrag gefunden)");

    if (pfad === SPRECHPFAD.PLAY_TTS) {
      const audio = await downloadPlayAudio(srv, texml, outDir);
      console.log(`audio_datei=${audio.file} bytes=${audio.bytes} content_type=${audio.contentType}`);
    } else {
      console.log("kein <Play> -> keine Audiodatei");
    }

    printMetricsLines(srv.stdout);
    console.log("Synthese-Zeiten (Server):");
    printSyntheseLine(srv.stdout);
  } finally {
    await srv.stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(CLI_ARGS_OFFSET))).catch((err) => {
    console.error(`[inbound-hoerprobe] Fehler: ${err.message}`);
    process.exitCode = 1;
  });
}
