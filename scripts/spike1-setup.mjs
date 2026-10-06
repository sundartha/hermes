#!/usr/bin/env node
import { config, stripTrailingSlash } from "../src/config.js";

const LOG_PREFIX = "[spike1-setup]";
const CLI_ARGS_START_INDEX = 2;
const CONSULT_PATH = "/consult";
const TOOLS_PATH = "/v1/convai/tools";
const AGENTS_CREATE_PATH = "/v1/convai/agents/create";
const AGENT_PATH_PREFIX = "/v1/convai/agents/";
const ERROR_BODY_PREVIEW_CHARS = 800;
const RAW_BODY_PREVIEW_CHARS = 600;

const TOOL_RESPONSE_TIMEOUT_SECS = 120;

const AGENT_TURN_TIMEOUT_SECS = 7;
const AGENT_SILENCE_END_CALL_DISABLED = -1;
const AGENT_MAX_DURATION_SECONDS = 600;
const AGENT_TEMPERATURE = 0;
const AGENT_LLM = "gpt-4o-mini";
const AGENT_LANGUAGE = "de";

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

function parseJsonOrRaw(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, RAW_BODY_PREVIEW_CHARS) };
  }
}

async function callApi(path, method, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> HTTP ${res.status}: ${text.slice(0, ERROR_BODY_PREVIEW_CHARS)}`,
    );
  }
  return parseJsonOrRaw(text);
}

function toolConfig(consultUrl) {
  return {
    type: "webhook",
    name: "spike1_consult",
    description:
      "Fragt den Assistenten des Nutzers etwas nach, das du selbst nicht weisst. Rufe dieses Werkzeug auf, sobald der Anrufer darum bittet nachzufragen. Der Anrufer nennt dabei immer eine Zahl von Sekunden - uebergib genau diese Zahl als wait_seconds.",
    response_timeout_secs: TOOL_RESPONSE_TIMEOUT_SECS,
    interruption_mode: "disable_during_tool",
    pre_tool_speech: "force",
    tool_call_sound: "typing",
    tool_call_sound_behavior: "always",
    api_schema: {
      url: consultUrl,
      method: "POST",
      content_type: "application/json",
      request_body_schema: {
        type: "object",
        description: "Nutzlast der Rueckfrage",
        properties: {
          wait_seconds: {
            type: "number",
            description:
              "Anzahl Sekunden, die der Nachfrage-Kanal fuer die Antwort braucht. Nimm exakt die Zahl, die der Anrufer nennt.",
          },
        },
        required: ["wait_seconds"],
      },
    },
  };
}

function agentConfig(toolId) {
  return {
    name: "spike1-werkzeug-wartezeit (WEGWERF)",
    tags: ["spike1"],
    conversation_config: {
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
        first_message: "Hallo, hier ist der Spike-Test. Was soll ich nachfragen?",
        language: AGENT_LANGUAGE,
        prompt: {
          prompt:
            "Du bist ein Testagent fuer eine Messung. Deine EINZIGE Aufgabe: Sobald der Anrufer dich bittet nachzufragen und dabei eine Zahl von Sekunden nennt, rufst du SOFORT das Werkzeug spike1_consult auf und uebergibst genau diese Zahl als wait_seconds. Waehrend das Werkzeug laeuft, wartest du still ab. Wenn das Ergebnis da ist, sagst du in EINEM kurzen Satz, dass die Antwort da ist, und nennst den Wert aus dem Feld waited_ms. Stelle keine Rueckfragen, plaudere nicht.",
          llm: AGENT_LLM,
          temperature: AGENT_TEMPERATURE,
          tool_ids: [toolId],
        },
      },
    },
  };
}

async function createTool(consultUrl) {
  const created = await callApi(TOOLS_PATH, "POST", { tool_config: toolConfig(consultUrl) });
  const stored = created.tool_config ?? {};
  console.log(`${LOG_PREFIX} TOOL_ID=${created.id}`);
  console.log(
    `${LOG_PREFIX}   timeout=${stored.response_timeout_secs}s pre_tool_speech=${stored.pre_tool_speech} interruption_mode=${stored.interruption_mode} sound=${stored.tool_call_sound}/${stored.tool_call_sound_behavior}`,
  );
  console.log(`${LOG_PREFIX}   url=${stored.api_schema?.url}`);
  return created.id;
}

async function logAgentReadBack(agentId) {
  const readBack = await callApi(`${AGENT_PATH_PREFIX}${agentId}`, "GET");
  const conversationConfig = readBack.conversation_config ?? {};
  const prompt = conversationConfig.agent?.prompt ?? {};
  console.log(
    `${LOG_PREFIX}   gelesen: turn_timeout=${conversationConfig.turn?.turn_timeout} tool_ids=${JSON.stringify(prompt.tool_ids)} llm=${prompt.llm} sprache=${conversationConfig.agent?.language}`,
  );
}

async function main() {
  const [baseUrl] = process.argv.slice(CLI_ARGS_START_INDEX);
  if (!baseUrl) {
    throw new Error(
      "Basis-URL fehlt. Aufruf: npm run spike1:setup -- <oeffentliche-basis-url des Echo-Endpunkts>",
    );
  }
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY fehlt - ohne Schluessel kein Zugriff auf die Convai-API.");
  }
  const toolId = await createTool(`${stripTrailingSlash(baseUrl)}${CONSULT_PATH}`);
  const agent = await callApi(AGENTS_CREATE_PATH, "POST", agentConfig(toolId));
  console.log(`${LOG_PREFIX} AGENT_ID=${agent.agent_id}`);
  await logAgentReadBack(agent.agent_id);
  console.log(`${LOG_PREFIX} weiter mit: npm run spike1:ws-probe -- ${agent.agent_id}`);
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
  process.exitCode = 1;
});
