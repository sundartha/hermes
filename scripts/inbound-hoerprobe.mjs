#!/usr/bin/env node
// Inbound-Hoerprobe (PLAN-INBOUND-PARITAET IP2): faehrt EINEN echten /voice/incoming-
// Turn lokal gegen den echten Render-Weg und berichtet, welcher Sprechpfad gerendert
// wurde. Kein echter Anruf, kein Telnyx-Netzzugriff - bei ELEVENLABS_PLAY_TTS_ENABLED=
// true macht es einen ECHTEN ElevenLabs-Synth-Call (Kosten!), das ist der Zweck des
// Werkzeugs (eine echte Hoerprobe, kein Fake-Origin wie in den Tests).
//
// Aufruf: node scripts/inbound-hoerprobe.mjs --out <verzeichnis>
//   npm run inbound:hoerprobe -- --out /tmp/inbound-probe
//
// NIEMALS Teil von `npm test` (macht bei gesetztem Flag einen echten Provider-Call).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "../test/helpers.js";
import { config } from "../src/config.js";
// IP4: der Namensvorrat ist nach src/telephony/sprechpfad.js gezogen - seit IP4 liest ihn
// auch der Boot-Banner, und der darf dieses Werkzeug (es haengt an test/helpers.js) nicht
// importieren. Eine Quelle, drei Konsumenten.
import { classifySprechpfad, SPRECHPFAD } from "../src/telephony/sprechpfad.js";

// ElevenLabs-Play-TTS-Durchreichung fuer die ECHTE Synthese. G35: Umgebungsvariablen
// laufen NIE direkt (process.env) durch dieses Skript, sondern ausschliesslich ueber
// den bereits geparsten/getrimmten src/config.js-Sammelort (Muster
// scripts/push-elevenlabs.mjs) - config.voice.elevenLabsPlayTts spiegelt exakt die
// Shell-Umgebung DIESES Prozesses (der Aufrufer der Hoerprobe), da config.js beim
// Import synchron aus process.env liest. ELEVENLABS_API_BASE ist damit IMMER der
// aufgeloeste Wert (echter Endpunkt oder ein vom Aufrufer gesetzter Fake) statt des
// toten Stubs aus test/helpers.js#BASE_ENV, den der Kindprozess sonst geerbt haette.
function elevenLabsEnvOverrides() {
  const { enabled, apiKey, voiceId, model, apiBase, outputFormat, synthTimeoutMs } =
    config.voice.elevenLabsPlayTts;
  return {
    ELEVENLABS_API_BASE: apiBase,
    ELEVENLABS_PLAY_TTS_ENABLED: String(enabled),
    ELEVENLABS_API_KEY: apiKey,
    ELEVENLABS_VOICE_ID: voiceId,
    ELEVENLABS_MODEL: model,
    ELEVENLABS_OUTPUT_FORMAT: outputFormat,
    ELEVENLABS_SYNTH_TIMEOUT_MS: String(synthTimeoutMs),
  };
}

// Regel 4 (Secrets): NIE der Wert, nur Schluesselname + Zustand gesetzt/leer.
function reportElevenLabsEnvState() {
  const { enabled, apiKey } = config.voice.elevenLabsPlayTts;
  console.log("[inbound-hoerprobe] ElevenLabs-Play-TTS-Konfiguration:");
  console.log(`  ELEVENLABS_PLAY_TTS_ENABLED=${enabled}`);
  console.log(`  ELEVENLABS_API_KEY=${apiKey ? "gesetzt" : "leer"}`);
}

// Latenz-Marken des Turns (src/metrics.js: turn/stt_gap/speech_result/llm) aus dem
// bereits mitgeschnittenen Server-stdout herausfiltern - Scope-Punkt 4. Ein einzelner
// /voice/incoming-Turn loest KEIN /voice/turn aus, deshalb ist eine leere Liste der
// erwartete Regelfall; die Zeile bleibt trotzdem der Anker fuer eine spaetere Erweiterung
// (kein neues Szenario, NICHT-Scope).
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

const AUDIO_EXTENSION_BY_CONTENT_TYPE = Object.freeze({ "audio/mpeg": "mp3", "audio/mp3": "mp3" });
const DEFAULT_AUDIO_EXTENSION = "bin";

// Token aus der <Play>-URL ziehen und GENAU EINMAL ueber die REALE lokale Server-
// Adresse abrufen (Muster test/voice-play-tts.test.js: die URL im TeXML traegt
// PUBLIC_URL=https://agent.test, nicht die tatsaechliche localhost:<port>-Adresse -
// nur der Token ist verwertbar). ttsStore ist takeOnce: zweiter Abruf waere ein Bug im
// Skript selbst, kein Produktbefund.
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
// process.argv[0]=node, [1]=Skriptpfad - die eigentlichen Argumente beginnen danach
// (Muster scripts/check-staged-suppressions.js).
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
    // language:"de" fest gepinnt statt vom ambienten WORLD_DEFAULT_LANGUAGE_ENABLED-
    // Flag abzuhaengen (das divergiert zwischen Test-Suite [true, en] und Code-Fallback
    // [false, de] - eine Hoerprobe soll NICHT je nach Aufrufumgebung ein anderes
    // Ergebnis erwarten muessen).
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: { METRICS_ENABLED: "true", ...elevenLabsEnvOverrides() },
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: CALL_SID });
    const texml = await res.text();
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
    console.log(`sprechpfad=${pfad}${voiceMatch ? ` voice=${voiceMatch[1]}` : ""}`);

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
