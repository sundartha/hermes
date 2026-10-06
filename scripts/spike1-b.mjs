#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import WebSocket from "ws";
import { config, stripTrailingSlash } from "../src/config.js";

const LOG_PREFIX = "[spike1-b]";
const CLI_ARGS_START_INDEX = 2;
const CONSULT_PATH = "/consult";
const TOOLS_PATH = "/v1/convai/tools";
const AGENTS_PATH = "/v1/convai/agents";
const CONVERSATIONS_PATH = "/v1/convai/conversations";
const SIGNED_URL_PATH = "/v1/convai/conversation/get-signed-url";
const ERROR_PREVIEW_CHARS = 700;
const MS_PER_SECOND = 1000;
const CLEANUP_LIST_PAGE_SIZE = 30;

const TOOL_RESPONSE_TIMEOUT_SECS = 120;
const AGENT_TURN_TIMEOUT_SECS = 30;
const AGENT_SILENCE_END_CALL_DISABLED = -1;
const AGENT_MAX_DURATION_SECONDS = 600;
const AGENT_LANGUAGE = "de";

const PROFILE_PRODUKTION = "produktion";
const PROFILES = Object.freeze({
  spike1b: { llm: "gpt-4o-mini", temperature: 0, reasoning_effort: null },
  [PROFILE_PRODUKTION]: { llm: "claude-opus-4-8", temperature: 0.66, reasoning_effort: "none" },
});
const AGENT_TTS_MODEL = "eleven_flash_v2_5";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

const CLIENT_EVENTS = [
  "conversation_initiation_metadata",
  "ping",
  "audio",
  "interruption",
  "user_transcript",
  "agent_response",
  "agent_response_correction",
  "client_tool_call",
  "agent_tool_request",
  "agent_tool_response",
  "agent_response_metadata",
  "client_error",
  "agent_response_complete",
];

const ERSTE_ANGABE = "Kundennummer";
const ZWEITE_ANGABE = "Vertragsnummer";
const DRITTE_ANGABE = "Rechnungsnummer";

const PROMPT_BASIS = [
  "Du bist der Telefonassistent von Herrn Fischer und rufst bei einer Serviceleitung an.",
  `Du kennst WEDER die ${ERSTE_ANGABE} NOCH die ${ZWEITE_ANGABE} von Herrn Fischer.`,
  "Du darfst diese Zahlen NIEMALS raten, schaetzen oder erfinden.",
  "Der EINZIGE Weg, an eine dieser Zahlen zu kommen, ist das Werkzeug spike1_consult:",
  "du uebergibst im Feld question genau den Namen der Angabe, nach der die Serviceleitung fragt.",
  "Frage IMMER nur eine Angabe auf einmal ab, und zwar erst dann, wenn die Serviceleitung danach fragt.",
  `Wird spaeter nach der zweiten Angabe gefragt, rufst du das Werkzeug ein ZWEITES Mal auf - mit question gleich dem Namen der zweiten Angabe.`,
  "Die Antwort deines Assistenten steht im Feld waited_ms der Werkzeug-Antwort. Nenne genau diesen Wert als die erfragte Zahl.",
  "Waehrend das Werkzeug laeuft, wartest du still ab. Plaudere nicht, wechsle nicht das Thema, lege nicht auf.",
].join(" ");

const PROMPT_EXPLIZIT = [
  "Du bist der Telefonassistent von Herrn Fischer und rufst bei einer Serviceleitung an.",
  `Die Serviceleitung wird dich nacheinander nach ZWEI Zahlen fragen: zuerst nach der ${ERSTE_ANGABE}, danach nach der ${ZWEITE_ANGABE}.`,
  "Du kennst KEINE der beiden Zahlen und darfst sie NIEMALS raten oder erfinden.",
  "PFLICHT: Du rufst das Werkzeug spike1_consult in diesem Gespraech GENAU ZWEIMAL auf.",
  `Aufruf 1: question gleich "${ERSTE_ANGABE}", sobald danach gefragt wird.`,
  `Aufruf 2: question gleich "${ZWEITE_ANGABE}", sobald danach gefragt wird. Dieser zweite Aufruf ist zwingend - eine Antwort ohne ihn ist FALSCH.`,
  "Ein frueherer Werkzeug-Aufruf beantwortet die zweite Frage NICHT. Die Antwort auf Aufruf 1 gilt ausschliesslich fuer die erste Zahl.",
  "Die Antwort deines Assistenten steht im Feld waited_ms der Werkzeug-Antwort. Nenne genau diesen Wert als die erfragte Zahl.",
  "Waehrend das Werkzeug laeuft, wartest du still ab. Plaudere nicht, wechsle nicht das Thema, lege nicht auf.",
].join(" ");

const PROMPTS = { basis: PROMPT_BASIS, explizit: PROMPT_EXPLIZIT };

const USER_TURNS = [
  `Guten Tag, hier ist die Serviceleitung. Nennen Sie mir bitte zuerst die ${ERSTE_ANGABE}.`,
  `Danke. Und jetzt nennen Sie mir bitte noch die ${ZWEITE_ANGABE}.`,
  `Sehr gut. Zum Abschluss brauche ich noch die ${DRITTE_ANGABE}.`,
];

async function callApi(path, method, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, ERROR_PREVIEW_CHARS) };
  }
  return { status: res.status, ok: res.ok, body: parsed, text };
}

function consultUrl(baseUrl, waitSeconds) {
  return `${stripTrailingSlash(baseUrl)}${CONSULT_PATH}?wait_seconds=${waitSeconds}`;
}

function toolConfig(baseUrl, waitSeconds) {
  return {
    type: "webhook",
    name: "spike1_consult",
    description:
      "Fragt den Assistenten des Nutzers nach einer Angabe, die du selbst nicht kennst. Rufe dieses Werkzeug jedes Mal auf, wenn nach einer Angabe gefragt wird, die du nicht weisst - auch dann, wenn du es in diesem Gespraech schon einmal aufgerufen hast.",
    response_timeout_secs: TOOL_RESPONSE_TIMEOUT_SECS,
    interruption_mode: "disable_during_tool",
    pre_tool_speech: "force",
    tool_call_sound: "typing",
    tool_call_sound_behavior: "always",
    api_schema: {
      url: consultUrl(baseUrl, waitSeconds),
      method: "POST",
      content_type: "application/json",
      request_body_schema: {
        type: "object",
        description: "Nutzlast der Rueckfrage",
        properties: {
          question: {
            type: "string",
            description: "Name der Angabe, nach der gefragt wurde.",
          },
        },
        required: ["question"],
      },
    },
  };
}

function agentConfig(toolId, promptText, profil) {
  return {
    name: "spike1b-zweiter-aufruf (WEGWERF)",
    tags: ["spike1b"],
    conversation_config: {
      tts: { model_id: AGENT_TTS_MODEL },
      turn: {
        turn_timeout: AGENT_TURN_TIMEOUT_SECS,
        silence_end_call_timeout: AGENT_SILENCE_END_CALL_DISABLED,
      },
      conversation: {
        text_only: false,
        max_duration_seconds: AGENT_MAX_DURATION_SECONDS,
        client_events: CLIENT_EVENTS,
      },
      agent: {
        first_message: "Guten Tag, hier ist der Assistent von Herrn Fischer.",
        language: AGENT_LANGUAGE,
        prompt: {
          prompt: promptText,
          llm: profil.llm,
          temperature: profil.temperature,
          reasoning_effort: profil.reasoning_effort,
          tool_ids: [toolId],
        },
      },
    },
  };
}

async function setupCommand(rest) {
  const [baseUrl, waitSeconds, profilName = PROFILE_PRODUKTION] = rest;
  const profil = Object.hasOwn(PROFILES, profilName) ? PROFILES[profilName] : null;
  if (!baseUrl || !waitSeconds || !profil) {
    throw new Error(
      `Aufruf: setup <basis-url> <wartesekunden> [${Object.keys(PROFILES).join("|")}]`,
    );
  }
  const created = await callApi(TOOLS_PATH, "POST", {
    tool_config: toolConfig(baseUrl, waitSeconds),
  });
  if (!created.ok)
    throw new Error(
      `Werkzeug: HTTP ${created.status} ${created.text.slice(0, ERROR_PREVIEW_CHARS)}`,
    );
  const stored = created.body.tool_config ?? {};
  console.log(`${LOG_PREFIX} TOOL_ID=${created.body.id}`);
  console.log(
    `${LOG_PREFIX}   timeout=${stored.response_timeout_secs}s pre_tool_speech=${stored.pre_tool_speech} interruption_mode=${stored.interruption_mode} sound=${stored.tool_call_sound}/${stored.tool_call_sound_behavior} url=${stored.api_schema?.url}`,
  );
  console.log(`${LOG_PREFIX} PROFIL=${profilName} ${JSON.stringify(profil)}`);
  const agent = await callApi(
    `${AGENTS_PATH}/create`,
    "POST",
    agentConfig(created.body.id, PROMPT_BASIS, profil),
  );
  if (!agent.ok)
    throw new Error(`Agent: HTTP ${agent.status} ${agent.text.slice(0, ERROR_PREVIEW_CHARS)}`);
  console.log(`${LOG_PREFIX} AGENT_ID=${agent.body.agent_id}`);
  await readBack(agent.body.agent_id);
}

async function readBack(agentId) {
  const got = await callApi(`${AGENTS_PATH}/${agentId}`, "GET");
  const cc = got.body.conversation_config ?? {};
  const geladen = cc.agent?.prompt ?? {};
  console.log(
    `${LOG_PREFIX}   gelesen: llm=${geladen.llm} temperature=${geladen.temperature} reasoning_effort=${geladen.reasoning_effort} thinking_budget=${geladen.thinking_budget}`,
  );
  console.log(
    `${LOG_PREFIX}   gelesen: turn_timeout=${cc.turn?.turn_timeout} tts=${cc.tts?.model_id} lang=${cc.agent?.language} tool_ids=${JSON.stringify(geladen.tool_ids)} prompt_len=${(geladen.prompt ?? "").length}`,
  );
}

async function patchWaitCommand(rest) {
  const [toolId, baseUrl, waitSeconds] = rest;
  if (!toolId || !baseUrl || !waitSeconds) {
    throw new Error("Aufruf: patch-wait <tool-id> <basis-url> <wartesekunden>");
  }
  const current = await callApi(`${TOOLS_PATH}/${toolId}`, "GET");
  if (!current.ok) throw new Error(`GET Werkzeug: HTTP ${current.status}`);
  const next = { ...current.body.tool_config };
  next.api_schema = { ...next.api_schema, url: consultUrl(baseUrl, waitSeconds) };
  const res = await callApi(`${TOOLS_PATH}/${toolId}`, "PATCH", { tool_config: next });
  const zurueckgelesen = res.body.tool_config ?? {};
  console.log(
    `${LOG_PREFIX} PATCH url http=${res.status} gelesen=${zurueckgelesen.api_schema?.url} timeout=${zurueckgelesen.response_timeout_secs}`,
  );
}

async function patchPromptCommand(rest) {
  const [agentId, variant] = rest;
  const promptText = Object.hasOwn(PROMPTS, variant ?? "") ? PROMPTS[variant] : null;
  if (!agentId || !promptText) throw new Error("Aufruf: patch-prompt <agent-id> basis|explizit");
  const res = await callApi(`${AGENTS_PATH}/${agentId}`, "PATCH", {
    conversation_config: { agent: { prompt: { prompt: promptText } } },
  });
  console.log(`${LOG_PREFIX} PATCH prompt=${variant} http=${res.status}`);
  if (res.ok) await readBack(agentId);
}

async function cleanupCommand(rest) {
  const [agentId, toolId] = rest;
  if (agentId) {
    const res = await callApi(`${AGENTS_PATH}/${agentId}`, "DELETE");
    console.log(`${LOG_PREFIX} DELETE agent http=${res.status}`);
  }
  if (toolId) {
    const plain = await callApi(`${TOOLS_PATH}/${toolId}`, "DELETE");
    console.log(`${LOG_PREFIX} DELETE tool http=${plain.status}`);
    if (!plain.ok) {
      const forced = await callApi(`${TOOLS_PATH}/${toolId}?force=true`, "DELETE");
      console.log(`${LOG_PREFIX} DELETE tool?force=true http=${forced.status}`);
    }
  }
  const agents = await callApi(`${AGENTS_PATH}?page_size=${CLEANUP_LIST_PAGE_SIZE}`, "GET");
  const tools = await callApi(TOOLS_PATH, "GET");
  console.log(
    `${LOG_PREFIX} GEGENPROBE agenten=${JSON.stringify((agents.body.agents ?? []).map((agent) => agent.name))} werkzeuge=${JSON.stringify((tools.body.tools ?? []).map((tool) => tool.tool_config?.name))}`,
  );
}

const SILENCE_SAMPLE_RATE_HZ = 16000;
const SILENCE_BYTES_PER_SAMPLE = 2;
const SILENCE_CHUNK_SECONDS = 0.25;
const SILENCE_CHUNK_MS = SILENCE_CHUNK_SECONDS * MS_PER_SECOND;
const SILENCE_CHUNK_BASE64 = Buffer.alloc(
  SILENCE_SAMPLE_RATE_HZ * SILENCE_BYTES_PER_SAMPLE * SILENCE_CHUNK_SECONDS,
).toString("base64");

const FIRST_TURN_DELAY_MS = 3000;
const NEXT_TURN_DELAY_MS = 12000;
const AFTER_LAST_TOOL_GRACE_MS = 12000;
const AFTER_CLOSE_SETTLE_MS = 5000;
const TOOL_START_WATCHDOG_MS = 120000;
const HARD_STOP_MS = 420000;

const ELAPSED_DECIMALS = 2;
const LOG_TIME_WIDTH = 7;
const LOG_VALUE_MAX_CHARS = 260;
const TEXT_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS_WS = 300;
const TOOL_PARAMS_PREVIEW_CHARS = 120;

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
  ENDE: "ende",
});

function delay(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

function sekundenZwischen(vonMs, bisMs) {
  return Number(((bisMs - vonMs) / MS_PER_SECOND).toFixed(ELAPSED_DECIMALS));
}

function sekundenSeit(vonMs) {
  return sekundenZwischen(vonMs, Date.now());
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class ZweiAufrufeProbe {
  constructor({ agentId, label, jsonlPath }) {
    this.agentId = agentId;
    this.label = label;
    this.jsonl = jsonlPath ? createWriteStream(jsonlPath, { flags: "a" }) : null;
    this.startedAt = Date.now();
    this.socket = null;
    this.conversationId = null;
    this.phase = PHASE.IDLE;
    this.turnIndex = -1;
    this.aktuell = null;
    this.ergebnisse = [];
    this.silenceTimer = null;
    this.watchdogTimer = null;
  }

  elapsedSeconds() {
    return sekundenSeit(this.startedAt);
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
    const res = await fetch(
      `${apiBase}${SIGNED_URL_PATH}?agent_id=${encodeURIComponent(this.agentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    const body = await res.json();
    if (!body.signed_url) throw new Error(`kein signed_url (HTTP ${res.status})`);
    return body.signed_url;
  }

  send(payload) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }

  handleOpen() {
    this.log("WS_OPEN", {});
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
    setTimeout(() => this.naechsterZug(), FIRST_TURN_DELAY_MS);
  }

  naechsterZug() {
    this.turnIndex += 1;
    const text = USER_TURNS[this.turnIndex];
    if (text === undefined) {
      this.abschluss();
      return;
    }
    this.aktuell = {
      toolRequestAt: null,
      toolResponseAt: null,
      aufruf_nr: this.turnIndex + 1,
      frage: text,
      gestartet_bei_s: this.elapsedSeconds(),
      werkzeug_gestartet: false,
      werkzeug_beantwortet: false,
      werkzeug_dauer_s: null,
      werkzeug_nutzlast: null,
      ueberbrueckungssatz: null,
      selbst_weiterreden: [],
      antwort_nach_werkzeug: null,
    };
    this.phase = PHASE.AWAIT_TOOL;
    this.log("USER_MSG", { aufruf_nr: this.aktuell.aufruf_nr, text });
    this.send({ type: "user_message", text });
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(
      () => this.watchdog(this.aktuell.aufruf_nr),
      TOOL_START_WATCHDOG_MS,
    );
  }

  watchdog(aufrufNr) {
    if (!this.aktuell || this.aktuell.aufruf_nr !== aufrufNr) return;
    if (this.phase === PHASE.ENDE) return;
    this.log("WATCHDOG", {
      aufruf_nr: aufrufNr,
      phase: this.phase,
      werkzeug_gestartet: this.aktuell.werkzeug_gestartet,
      werkzeug_beantwortet: this.aktuell.werkzeug_beantwortet,
    });
    this.zugAbschliessen();
    this.abschluss();
  }

  werkzeugSicht() {
    const angefragtAm = this.aktuell?.toolRequestAt ?? null;
    const beantwortetAm = this.aktuell?.toolResponseAt ?? null;
    return {
      imWerkzeug: Boolean(angefragtAm) && !beantwortetAm,
      seitAnfrageS: angefragtAm ? sekundenSeit(angefragtAm) : null,
    };
  }

  satzEinordnen(satz, sicht) {
    const zug = this.aktuell;
    if (this.phase === PHASE.AWAIT_TOOL) {
      zug.ueberbrueckungssatz = satz;
      return;
    }
    if (sicht.imWerkzeug) {
      zug.selbst_weiterreden.push({ txt: satz, seit_anfrage_s: sicht.seitAnfrageS });
      return;
    }
    if (zug.toolResponseAt && !zug.antwort_nach_werkzeug) {
      zug.antwort_nach_werkzeug = satz;
    }
  }

  handleAgentResponse(msg) {
    const satz = (msg.agent_response_event?.agent_response ?? "").slice(0, TEXT_PREVIEW_CHARS);
    const sicht = this.werkzeugSicht();
    this.log(MSG_AGENT_RESPONSE, {
      aufruf_nr: this.aktuell?.aufruf_nr ?? null,
      phase: this.phase,
      txt: satz,
      im_werkzeug: sicht.imWerkzeug,
      seit_anfrage_s: sicht.seitAnfrageS,
    });
    if (this.aktuell) this.satzEinordnen(satz, sicht);
  }

  handleToolEvent(msg) {
    this.log(msg.type, msg);
    const zug = this.aktuell;
    if (!zug) return;
    if (msg.type === MSG_TOOL_REQUEST) {
      zug.toolRequestAt = Date.now();
      zug.werkzeug_gestartet = true;
      zug.werkzeug_nutzlast = JSON.stringify(msg.tool_name ?? msg.agent_tool_request ?? null);
      this.phase = PHASE.IN_TOOL;
      return;
    }
    if (msg.type !== MSG_TOOL_RESPONSE) return;
    zug.toolResponseAt = Date.now();
    zug.werkzeug_beantwortet = true;
    zug.werkzeug_dauer_s = sekundenZwischen(zug.toolRequestAt, zug.toolResponseAt);
    this.phase = PHASE.AFTER_TOOL;
    this.log("WERKZEUG_DAUER", { aufruf_nr: zug.aufruf_nr, gemessen_s: zug.werkzeug_dauer_s });
    clearTimeout(this.watchdogTimer);
    const istLetzterZug = this.turnIndex >= USER_TURNS.length - 1;
    const pause = istLetzterZug ? AFTER_LAST_TOOL_GRACE_MS : NEXT_TURN_DELAY_MS;
    setTimeout(() => {
      this.zugAbschliessen();
      if (istLetzterZug) this.abschluss();
      else this.naechsterZug();
    }, pause);
  }

  zugAbschliessen() {
    if (!this.aktuell) return;
    const { toolRequestAt: _anfrageAt, toolResponseAt: _antwortAt, ...offen } = this.aktuell;
    const ergebnis = {
      label: this.label,
      ...offen,
      ws_offen: this.socket.readyState === WebSocket.OPEN,
    };
    this.ergebnisse.push(ergebnis);
    this.log("ERGEBNIS", ergebnis);
    this.aktuell = null;
  }

  abschluss() {
    this.phase = PHASE.ENDE;
    this.log("ALLE_ZUEGE_DURCH", { zuege: this.ergebnisse.length });
    this.close();
  }

  handleMessage(raw) {
    const msg = safeParseJson(raw.toString());
    if (!msg) return;
    if (msg.type === MSG_PING) {
      this.send({ type: "pong", event_id: msg.ping_event?.event_id });
      return;
    }
    if (msg.type === MSG_AUDIO) return;
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

  waitForClose() {
    return new Promise((settle) => {
      this.socket.on("close", (code, reason) => {
        clearInterval(this.silenceTimer);
        clearTimeout(this.watchdogTimer);
        this.log("WS_CLOSE", { code, reason: String(reason ?? "") });
        settle();
      });
      this.socket.on("error", (err) => {
        this.log("WS_ERROR", { err: String(err).slice(0, ERROR_PREVIEW_CHARS_WS) });
      });
    });
  }

  async transkriptSicht() {
    const res = await callApi(`${CONVERSATIONS_PATH}/${this.conversationId}`, "GET");
    const turns = res.body.transcript ?? [];
    const werkzeugZeilen = turns.flatMap((turn) =>
      (turn.tool_calls ?? []).map((call) => ({
        zeit_s: turn.time_in_call_secs,
        name: call.tool_name ?? call.name,
        params: JSON.stringify(call.params_as_json ?? call.tool_details?.parameters ?? null).slice(
          0,
          TOOL_PARAMS_PREVIEW_CHARS,
        ),
      })),
    );
    this.log("TRANSKRIPT", {
      status: res.body.status,
      dauer_s: res.body.metadata?.call_duration_secs,
      kosten: res.body.metadata?.cost,
      turns: turns.length,
      rollen: turns.map((turn) => turn.role).join(","),
      werkzeug_aufrufe: werkzeugZeilen,
      abbruchgrund: res.body.metadata?.termination_reason ?? null,
    });
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
    }, HARD_STOP_MS);

    await closed;
    clearTimeout(hardStop);
    this.log("ZUSAMMENFASSUNG", {
      conversation_id: this.conversationId,
      ergebnisse: this.ergebnisse,
    });
    await delay(AFTER_CLOSE_SETTLE_MS);
    if (this.conversationId) await this.transkriptSicht();
    if (this.jsonl) this.jsonl.end();
  }
}

async function probeCommand(rest) {
  const [agentId, label, jsonlPath] = rest;
  if (!agentId) throw new Error("Aufruf: probe <agent-id> <label> [jsonl-datei]");
  await new ZweiAufrufeProbe({
    agentId,
    label: label || "lauf",
    jsonlPath: jsonlPath || null,
  }).run();
}

const COMMANDS = {
  setup: setupCommand,
  "patch-wait": patchWaitCommand,
  "patch-prompt": patchPromptCommand,
  probe: probeCommand,
  cleanup: cleanupCommand,
};

async function main() {
  const [command, ...rest] = process.argv.slice(CLI_ARGS_START_INDEX);
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY fehlt");
  const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  if (!handler) throw new Error(`Befehl fehlt: ${Object.keys(COMMANDS).join(" | ")}`);
  await handler(rest);
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
  process.exitCode = 1;
});
