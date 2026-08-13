#!/usr/bin/env node
// Messklient fuer Spike 1 (UMSETZUNG-ElevenLabs.md, "Traegt der
// Rueckfrage-Kanal?"). Fuehrt ein echtes Convai-Gespraech ueber die
// WebSocket-Strecke und protokolliert, was waehrend einer langen
// Werkzeug-Wartezeit passiert: startet das Werkzeug ueberhaupt, wie lange
// dauert es gemessen, redet der Agent dazwischen, ueberlebt die Verbindung.
//
// KEIN Telefonanruf noetig: der ClientEvent-Enum traegt agent_tool_request und
// agent_tool_response - ein server-seitiges Webhook-Werkzeug meldet beide
// Kanten an jeden WebSocket-Klienten. Die Simulations-API waere fuer diese
// Messung untauglich, weil sie Werkzeuge MOCKT (kein HTTP, keine Wanduhr).
//
// VORAUSSETZUNG: der Schluessel (ELEVENLABS_API_KEY, gelesen ueber
// src/config.js) braucht das Recht `convai_write`. Fehlt es, antworten BEIDE
// WebSocket-Eintrittspunkte (get-signed-url und conversation/token) - genau wie
// jeder Schreibweg - mit HTTP 401 und `missing_permissions: convai_write`.
//
// Aufruf:  npm run spike1:ws-probe -- <agent-id> [wartezeiten] [label] [jsonl-datei]
// Wartezeiten ist eine Liste von Sekundenwerten (Vorgabe DEFAULT_WAITS_CSV);
// jeder Wert wird als eigene Runde im selben Gespraech gefahren. Ohne
// jsonl-Datei wird nur auf stdout protokolliert, keine Datei geschrieben.
// Den Agenten legt scripts/spike1-setup.mjs an, den Gegenpart des Werkzeugs
// bedient scripts/spike1-consult-echo.mjs.
//
// Tut NICHT: einen Agenten anlegen oder aendern, telefonieren, aufraeumen,
// bewerten. Das Skript misst und schreibt mit - die Deutung bleibt beim Leser.
import { createWriteStream } from "node:fs";
import WebSocket from "ws";
import { config } from "../src/config.js";

const LOG_PREFIX = "[spike1-ws-probe]";
const CLI_ARGS_START_INDEX = 2;
const SIGNED_URL_PATH = "/v1/convai/conversation/get-signed-url";
const CONVERSATIONS_PATH = "/v1/convai/conversations";
const MS_PER_SECOND = 1000;

// Wartezeiten der Vorbereitung: 30/45/60 Sekunden. Als Zeichenkette, weil
// dieselbe Zerlegung fuer Vorgabe und CLI-Argument gilt.
const DEFAULT_WAITS_CSV = "30,45,60";
const DEFAULT_LABEL = "lauf";

// 250 ms digitale Stille als pcm_16000 (16 kHz, 16 bit mono) im selben Takt
// gesendet - haelt die Audiostrecke offen wie ein schweigender Anrufer.
const SILENCE_SAMPLE_RATE_HZ = 16000;
const SILENCE_BYTES_PER_SAMPLE = 2;
const SILENCE_CHUNK_SECONDS = 0.25;
const SILENCE_CHUNK_MS = SILENCE_CHUNK_SECONDS * MS_PER_SECOND;
const SILENCE_CHUNK_BASE64 = Buffer.alloc(
  SILENCE_SAMPLE_RATE_HZ * SILENCE_BYTES_PER_SAMPLE * SILENCE_CHUNK_SECONDS,
).toString("base64");

// Zweite Messachse: waehrend das Gespraech laeuft die REST-Sicht abfragen -
// bewegt sich dort etwas, traegt spaeter ein Polling-Wachhund.
const POLL_INTERVAL_MS = 8000;
// Erst reden lassen, dann die erste Runde ausloesen (Begruessung abwarten).
const FIRST_TURN_DELAY_MS = 3000;
// Nach der Werkzeug-Antwort nachlaufen lassen, damit sie im Gespraech ankommt.
const AFTER_TOOL_GRACE_MS = 12000;
const BETWEEN_WAITS_DELAY_MS = 2000;
const AFTER_CLOSE_SETTLE_MS = 4000;
// Notbremse je Runde und fuer den ganzen Lauf, beide auf die Wartezeit addiert:
// falls das Werkzeug nie startet oder nie endet, haengt der Lauf nicht ewig.
const WATCHDOG_EXTRA_SECONDS = 75;
const HARD_STOP_EXTRA_SECONDS = 240;

const ELAPSED_DECIMALS = 2;
const LOG_TIME_WIDTH = 7;
const LOG_VALUE_MAX_CHARS = 220;
const TEXT_PREVIEW_CHARS = 200;
const SHORT_PREVIEW_CHARS = 160;
const ERROR_PREVIEW_CHARS = 300;

const MSG_PING = "ping";
const MSG_AUDIO = "audio";
const MSG_INIT = "conversation_initiation_metadata";
const MSG_AGENT_RESPONSE = "agent_response";
const MSG_TOOL_REQUEST = "agent_tool_request";
const MSG_TOOL_RESPONSE = "agent_tool_response";
const MSG_CLIENT_TOOL_CALL = "client_tool_call";
const TOOL_EVENT_TYPES = new Set([MSG_TOOL_REQUEST, MSG_TOOL_RESPONSE, MSG_CLIENT_TOOL_CALL]);

const PHASE = Object.freeze({
  IDLE: "idle",
  AWAIT_TOOL: "await_tool_request",
  IN_TOOL: "in_tool",
  AFTER_TOOL: "after_tool",
  DONE: "done",
});

const USER_MESSAGE_PREFIX = "Bitte frag meinen Assistenten nach, benutze wait_seconds gleich ";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

function delay(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseWaits(csv) {
  const values = csv.split(",").map((part) => Number(part.trim()));
  const unusable = values.some((value) => !Number.isFinite(value) || value < 0);
  if (unusable || values.length === 0) {
    throw new Error(
      `Wartezeiten unbrauchbar: "${csv}" - erwartet eine Liste wie ${DEFAULT_WAITS_CSV}`,
    );
  }
  return values;
}

// Ein Lauf ueber ein Gespraech: haelt den Messzustand (welche Runde laeuft, wann
// kam die Werkzeug-Kante, was hat der Agent dazwischen gesagt) und protokolliert
// jede Kante mit relativer Zeit.
class ToolWaitProbe {
  constructor({ agentId, waits, label, jsonlPath }) {
    this.agentId = agentId;
    this.pendingWaits = [...waits];
    this.label = label;
    this.jsonl = jsonlPath ? createWriteStream(jsonlPath, { flags: "a" }) : null;
    this.startedAt = Date.now();
    this.socket = null;
    this.conversationId = null;
    this.phase = PHASE.IDLE;
    this.currentWait = null;
    this.toolRequestAt = null;
    this.toolResponseAt = null;
    this.speechDuringTool = [];
    this.preToolSpeech = null;
    this.answerAfterTool = null;
    this.results = [];
    this.silenceTimer = null;
    this.pollTimer = null;
  }

  elapsedSeconds() {
    return Number(((Date.now() - this.startedAt) / MS_PER_SECOND).toFixed(ELAPSED_DECIMALS));
  }

  log(kind, data) {
    const seconds = this.elapsedSeconds();
    if (this.jsonl) this.jsonl.write(`${JSON.stringify({ t_s: seconds, kind, ...data })}\n`);
    const rendered = JSON.stringify(data);
    const short =
      rendered.length > LOG_VALUE_MAX_CHARS
        ? `${rendered.slice(0, LOG_VALUE_MAX_CHARS)}...`
        : rendered;
    console.log(`${LOG_PREFIX} [${String(seconds).padStart(LOG_TIME_WIDTH)}s] ${kind} ${short}`);
  }

  async signedUrl() {
    const query = `agent_id=${encodeURIComponent(this.agentId)}`;
    const res = await fetch(`${apiBase}${SIGNED_URL_PATH}?${query}`, {
      headers: { "xi-api-key": apiKey },
    });
    const body = await res.json();
    if (!body.signed_url) {
      throw new Error(
        `kein signed_url (HTTP ${res.status}) - fehlt dem Schluessel convai_write? Antwort: ${JSON.stringify(body).slice(0, ERROR_PREVIEW_CHARS)}`,
      );
    }
    return body.signed_url;
  }

  send(payload) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }

  clearTimers() {
    clearInterval(this.silenceTimer);
    clearInterval(this.pollTimer);
  }

  async pollConversation(tag) {
    try {
      const res = await fetch(`${apiBase}${CONVERSATIONS_PATH}/${this.conversationId}`, {
        headers: { "xi-api-key": apiKey },
      });
      const body = await res.json();
      const turns = body.transcript || [];
      const last = turns.length ? turns[turns.length - 1] : null;
      const meta = body.metadata ?? {};
      this.log("POLL", {
        tag,
        http: res.status,
        status: body.status,
        call_duration_secs: meta.call_duration_secs,
        transcript_len: turns.length,
        last_time_in_call_secs: last?.time_in_call_secs,
        last_role: last?.role,
        phone_call: JSON.stringify(meta.phone_call ?? null),
      });
    } catch (err) {
      this.log("POLL_ERR", { tag, err: String(err).slice(0, ERROR_PREVIEW_CHARS) });
    }
  }

  pollWhenLive() {
    if (!this.conversationId) return;
    this.pollConversation(this.phase);
  }

  handleOpen() {
    this.log("WS_OPEN", {});
    // Leerer Override mit Absicht: turn_timeout gehoert zum Agenten und ist pro
    // Gespraech NICHT ueberschreibbar (Runde 2 braucht ein PATCH am Agenten).
    this.send({ type: "conversation_initiation_client_data", conversation_config_override: {} });
    this.silenceTimer = setInterval(
      () => this.send({ user_audio_chunk: SILENCE_CHUNK_BASE64 }),
      SILENCE_CHUNK_MS,
    );
  }

  handleInit(msg) {
    const event = msg.conversation_initiation_metadata_event ?? {};
    this.conversationId = event.conversation_id ?? null;
    this.log("INIT", event);
    this.pollTimer = setInterval(() => this.pollWhenLive(), POLL_INTERVAL_MS);
    setTimeout(() => this.nextWait(), FIRST_TURN_DELAY_MS);
  }

  handleAgentResponse(msg) {
    const text = msg.agent_response_event?.agent_response ?? "";
    const inTool = Boolean(this.toolRequestAt) && !this.toolResponseAt;
    const sinceRequestSecs = this.toolRequestAt
      ? (Date.now() - this.toolRequestAt) / MS_PER_SECOND
      : null;
    this.log(MSG_AGENT_RESPONSE, {
      txt: text.slice(0, TEXT_PREVIEW_CHARS),
      in_tool: inTool,
      since_request_s: sinceRequestSecs,
    });
    this.recordSpeech({ text, inTool, sinceRequestSecs });
  }

  // Drei Faelle, die der Spike auseinanderhalten muss: die Ansage VOR dem
  // Werkzeug (pre_tool_speech), das Dazwischenreden WAEHREND der Wartezeit und
  // die eigentliche Antwort DANACH.
  recordSpeech({ text, inTool, sinceRequestSecs }) {
    if (this.phase === PHASE.AWAIT_TOOL) {
      this.preToolSpeech = text.slice(0, SHORT_PREVIEW_CHARS);
      return;
    }
    if (inTool) {
      this.speechDuringTool.push({
        txt: text.slice(0, SHORT_PREVIEW_CHARS),
        since_request_s: sinceRequestSecs,
      });
      return;
    }
    if (this.toolResponseAt && !this.answerAfterTool) {
      this.answerAfterTool = text.slice(0, TEXT_PREVIEW_CHARS);
    }
  }

  measuredToolSeconds() {
    if (!this.toolRequestAt || !this.toolResponseAt) return null;
    return (this.toolResponseAt - this.toolRequestAt) / MS_PER_SECOND;
  }

  handleToolEvent(msg) {
    this.log(msg.type, msg);
    if (msg.type === MSG_TOOL_REQUEST) {
      this.toolRequestAt = Date.now();
      this.phase = PHASE.IN_TOOL;
      return;
    }
    // client_tool_call wird nur protokolliert - dieser Aufbau nutzt ein
    // server-seitiges Webhook-Werkzeug, ein Klienten-Werkzeug waere ein Befund.
    if (msg.type !== MSG_TOOL_RESPONSE) return;
    this.toolResponseAt = Date.now();
    this.phase = PHASE.AFTER_TOOL;
    this.log("TOOL_DAUER", {
      wait_seconds: this.currentWait,
      gemessen_s: this.measuredToolSeconds(),
    });
    setTimeout(() => this.finishWait(), AFTER_TOOL_GRACE_MS);
  }

  handleMessage(raw) {
    const msg = safeParseJson(raw.toString());
    if (!msg) return;
    if (msg.type === MSG_PING) {
      this.send({ type: "pong", event_id: msg.ping_event?.event_id });
      return;
    }
    if (msg.type === MSG_AUDIO) {
      // Nur die Kante festhalten, nie die Nutzlast (Audio gehoert nicht ins Log).
      this.log(MSG_AUDIO, { bytes: (msg.audio_event?.audio_base_64 || "").length });
      return;
    }
    if (msg.type === MSG_INIT) {
      this.handleInit(msg);
      return;
    }
    if (msg.type === MSG_AGENT_RESPONSE) {
      this.handleAgentResponse(msg);
      return;
    }
    if (TOOL_EVENT_TYPES.has(msg.type)) {
      this.handleToolEvent(msg);
      return;
    }
    this.log(msg.type, msg);
  }

  nextWait() {
    const seconds = this.pendingWaits.shift();
    if (seconds === undefined) {
      this.log("ALLE_WARTEZEITEN_DURCH", {});
      this.pollConversation("vor_ende").then(() => this.close());
      return;
    }
    this.beginWait(seconds);
  }

  beginWait(seconds) {
    this.phase = PHASE.AWAIT_TOOL;
    this.currentWait = seconds;
    this.toolRequestAt = null;
    this.toolResponseAt = null;
    this.speechDuringTool = [];
    this.preToolSpeech = null;
    this.answerAfterTool = null;
    const text = `${USER_MESSAGE_PREFIX}${seconds}.`;
    this.log("USER_MSG", { text, wait_seconds: seconds });
    this.send({ type: "user_message", text });
    const watchdogMs = (seconds + WATCHDOG_EXTRA_SECONDS) * MS_PER_SECOND;
    setTimeout(() => this.watchdog(seconds), watchdogMs);
  }

  watchdog(seconds) {
    if (this.currentWait !== seconds) return;
    if (this.phase === PHASE.DONE) return;
    this.log("WATCHDOG", {
      wait_seconds: seconds,
      phase: this.phase,
      tool_started: Boolean(this.toolRequestAt),
      tool_answered: Boolean(this.toolResponseAt),
    });
    this.finishWait();
  }

  finishWait() {
    if (this.phase === PHASE.DONE) return;
    const result = {
      label: this.label,
      wait_seconds: this.currentWait,
      tool_started: Boolean(this.toolRequestAt),
      tool_answered: Boolean(this.toolResponseAt),
      tool_dauer_s: this.measuredToolSeconds(),
      pre_tool_speech: this.preToolSpeech,
      selbst_weiterreden: this.speechDuringTool,
      antwort_nach_werkzeug: this.answerAfterTool,
      ws_offen: this.socket.readyState === WebSocket.OPEN,
    };
    this.results.push(result);
    this.log("ERGEBNIS", result);
    this.phase = PHASE.DONE;
    if (this.socket.readyState === WebSocket.OPEN) {
      setTimeout(() => this.nextWait(), BETWEEN_WAITS_DELAY_MS);
    }
  }

  waitForClose() {
    return new Promise((settle) => {
      this.socket.on("close", (code, reason) => {
        this.clearTimers();
        this.log("WS_CLOSE", { code, reason: String(reason ?? "") });
        settle();
      });
      this.socket.on("error", (err) => {
        this.log("WS_ERROR", { err: String(err).slice(0, ERROR_PREVIEW_CHARS) });
      });
    });
  }

  hardStopMs() {
    const total = this.pendingWaits.reduce((sum, secs) => sum + secs, 0);
    return (total + HARD_STOP_EXTRA_SECONDS) * MS_PER_SECOND;
  }

  async run() {
    const url = await this.signedUrl();
    this.socket = new WebSocket(url);
    const closed = this.waitForClose();
    this.socket.on("open", () => this.handleOpen());
    this.socket.on("message", (raw) => this.handleMessage(raw));
    const hardStop = setTimeout(() => {
      this.log("HARTER_STOP", {});
      this.close();
    }, this.hardStopMs());

    await closed;
    clearTimeout(hardStop);
    this.log("ZUSAMMENFASSUNG", { conversation_id: this.conversationId, results: this.results });
    // Der Endzustand des Gespraechs steht erst kurz nach dem Schliessen bereit.
    await delay(AFTER_CLOSE_SETTLE_MS);
    if (this.conversationId) await this.pollConversation("nach_ende");
    if (this.jsonl) this.jsonl.end();
  }
}

async function main() {
  const [agentId, waitsCsv, label, jsonlPath] = process.argv.slice(CLI_ARGS_START_INDEX);
  if (!agentId) {
    throw new Error(
      "Agentenkennung fehlt. Aufruf: npm run spike1:ws-probe -- <agent-id> [wartezeiten] [label] [jsonl-datei]",
    );
  }
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY fehlt - ohne Schluessel kein Zugriff auf die Convai-API.");
  }
  const probe = new ToolWaitProbe({
    agentId,
    waits: parseWaits(waitsCsv || DEFAULT_WAITS_CSV),
    label: label || DEFAULT_LABEL,
    jsonlPath: jsonlPath || null,
  });
  await probe.run();
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
  process.exitCode = 1;
});
