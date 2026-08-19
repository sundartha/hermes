#!/usr/bin/env node
// Mess-Werkzeug aus Spike 1. Deckt die Schritte ab, die scripts/spike1-setup.mjs
// und scripts/spike1-ws-probe.mjs nicht koennen: Agent anlegen mit TTS-Modell
// (die API lehnt nicht-englische Agenten ohne turbo/flash v2_5 ab), turn_timeout
// zwischen den Runden patchen, die Felder eines LAUFENDEN Gespraechs beobachten,
// die Objektform von language_detection klaeren, leeres overrides pruefen und am
// Ende alles wieder loeschen. Bleibt, solange das Folgepaket sie braucht.
//
// Der Schluessel steht in keiner Ausgabe.
import { config } from "../src/config.js";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;
const CLI_ARGS_START_INDEX = 2;
const AGENTS_PATH = "/v1/convai/agents";
const TOOLS_PATH = "/v1/convai/tools";
const CONVERSATIONS_PATH = "/v1/convai/conversations";
const ERROR_PREVIEW_CHARS = 700;
const MS_PER_SECOND = 1000;

// Vorgaben aus scripts/spike1-setup.mjs gespiegelt, damit der Agent derselbe ist.
const AGENT_TURN_TIMEOUT_SECS = 7;
const AGENT_SILENCE_END_CALL_DISABLED = -1;
const AGENT_MAX_DURATION_SECONDS = 600;
const AGENT_TEMPERATURE = 0;
const AGENT_LLM = "gpt-4o-mini";
const AGENT_LANGUAGE = "de";
// Die API verlangt fuer nicht-englische Agenten turbo oder flash v2_5.
const AGENT_TTS_MODEL = "eleven_flash_v2_5";

// Wie oft und wie lange der watch-Befehl pollt, wenn die CLI nichts vorgibt.
const DEFAULT_POLL_SECONDS = 5;
const DEFAULT_MAX_POLLS = 60;
// Seitengroessen der Listen-Abfragen: das laufende Gespraech steht ganz vorn,
// die Gegenprobe soll alle uebrig gebliebenen Objekte sehen.
const RUNNING_LOOKUP_PAGE_SIZE = 5;
const CLEANUP_LIST_PAGE_SIZE = 30;

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

// Die vier Formen, in denen language_detection akzeptiert werden koennte -
// welche die API nimmt, ist genau die offene Frage dieses Werkzeugs.
const LANGUAGE_DETECTION_VARIANTS = [
  // Variante 1: nur type+name, wie in der Vorlage geraten.
  { tag: "ld-type-name", detection: { type: "system", name: "language_detection" } },
  // Variante 2: leeres Objekt.
  { tag: "ld-leer", detection: {} },
  // Variante 3: mit description + params, wie es Werkzeug-Objekte sonst tragen.
  {
    tag: "ld-mit-params",
    detection: {
      type: "system",
      name: "language_detection",
      description: "",
      params: { system_tool_type: "language_detection" },
    },
  },
  // Variante 4: der in der Vorlage vermutete Schalter.
  {
    tag: "ld-only-at-start",
    detection: {
      type: "system",
      name: "language_detection",
      params: { system_tool_type: "language_detection", only_at_conversation_start: true },
    },
  },
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

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * MS_PER_SECOND));
}

function agentConfig(toolId) {
  return {
    name: "spike1-werkzeug-wartezeit (WEGWERF)",
    tags: ["spike1"],
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

async function readBack(agentId, tag) {
  const got = await callApi(`${AGENTS_PATH}/${agentId}`, "GET");
  const cc = got.body.conversation_config ?? {};
  console.log(
    `READBACK ${tag} http=${got.status} turn_timeout=${cc.turn?.turn_timeout} tts=${cc.tts?.model_id} lang=${cc.agent?.language} tool_ids=${JSON.stringify(cc.agent?.prompt?.tool_ids)} built_in_tools=${JSON.stringify(cc.agent?.prompt?.built_in_tools)} language_presets=${JSON.stringify(cc.language_presets)}`,
  );
  return got;
}

// Alle Pfade eines Objekts, Array-Indizes zu [] normalisiert - so bleibt die
// Ausgabe klein und nennt nur Feldnamen, nie Inhalte.
function flatten(value, prefix, sink) {
  if (Array.isArray(value)) {
    sink.set(`${prefix}.length`, String(value.length));
    value.forEach((entry) => flatten(entry, `${prefix}[]`, sink));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, sink);
    }
    return;
  }
  const path = prefix;
  const seen = sink.get(path);
  const rendered = JSON.stringify(value);
  if (seen === undefined) sink.set(path, rendered);
  else if (seen !== rendered) sink.set(path, "<mehrfach>");
}

function pathMap(body) {
  const sink = new Map();
  flatten(body, "", sink);
  return sink;
}

function diffPaths(before, after) {
  const changed = new Set();
  for (const [path, value] of after) {
    if (!before.has(path)) changed.add(`+${path}`);
    else if (before.get(path) !== value) changed.add(`~${path}`);
  }
  for (const path of before.keys()) if (!after.has(path)) changed.add(`-${path}`);
  return [...changed].sort();
}

// Sucht das juengste laufende Gespraech des Agenten; null, wenn keines auftaucht.
async function findRunningConversation(agentId, pollPlan) {
  for (let attempt = 0; attempt < pollPlan.maxPolls; attempt += 1) {
    const list = await callApi(
      `${CONVERSATIONS_PATH}?agent_id=${encodeURIComponent(agentId)}&page_size=${RUNNING_LOOKUP_PAGE_SIZE}`,
      "GET",
    );
    const running = (list.body.conversations ?? []).find(
      (eintrag) => eintrag.status === "in-progress",
    );
    if (running) return running.conversation_id;
    await sleep(pollPlan.seconds);
  }
  return null;
}

// Pollt ein bekanntes Gespraech, bis es endet, und meldet die Feld-Aenderungen.
async function pollConversation(conversationId, pollPlan) {
  let previous = null;
  const alleGeaenderten = new Set();
  const statusFolge = [];
  for (let poll = 0; poll < pollPlan.maxPolls; poll += 1) {
    const got = await callApi(`${CONVERSATIONS_PATH}/${conversationId}`, "GET");
    const current = pathMap(got.body);
    statusFolge.push(got.body.status);
    if (previous) {
      const changed = diffPaths(previous, current);
      changed.forEach((pfad) => alleGeaenderten.add(pfad));
      console.log(`WATCH poll=${poll} status=${got.body.status} geaendert=${JSON.stringify(changed)}`);
    } else {
      console.log(`WATCH poll=0 status=${got.body.status} felder=${JSON.stringify([...current.keys()])}`);
    }
    previous = current;
    if (got.body.status && got.body.status !== "in-progress" && poll > 0) break;
    await sleep(pollPlan.seconds);
  }
  console.log(`WATCH_SUMME status_folge=${JSON.stringify(statusFolge)}`);
  console.log(`WATCH_SUMME geaenderte_pfade=${JSON.stringify([...alleGeaenderten].sort())}`);
}

async function watchInProgress(agentId, pollPlan) {
  const conversationId = await findRunningConversation(agentId, pollPlan);
  if (!conversationId) {
    console.log("WATCH kein laufendes Gespraech gefunden");
    return;
  }
  console.log(`WATCH conversation=${conversationId}`);
  await pollConversation(conversationId, pollPlan);
}

async function tryPatch(agentId, tag, patchBody) {
  const res = await callApi(`${AGENTS_PATH}/${agentId}`, "PATCH", patchBody);
  console.log(
    `PATCH ${tag} http=${res.status} ${res.ok ? "ok" : res.text.slice(0, ERROR_PREVIEW_CHARS)}`,
  );
  if (res.ok) await readBack(agentId, tag);
  return res;
}

async function createAgentCommand(rest) {
  const [toolId] = rest;
  const res = await callApi(`${AGENTS_PATH}/create`, "POST", agentConfig(toolId));
  if (!res.ok) throw new Error(`create -> HTTP ${res.status}: ${res.text.slice(0, ERROR_PREVIEW_CHARS)}`);
  console.log(`AGENT_ID=${res.body.agent_id}`);
  await readBack(res.body.agent_id, "nach-create");
}

async function patchTurnCommand(rest) {
  const [agentId, secs] = rest;
  await tryPatch(agentId, `turn_timeout=${secs}`, {
    conversation_config: { turn: { turn_timeout: Number(secs) } },
  });
}

async function watchCommand(rest) {
  const [agentId, pollSecs, maxPolls] = rest;
  await watchInProgress(agentId, {
    seconds: Number(pollSecs || DEFAULT_POLL_SECONDS),
    maxPolls: Number(maxPolls || DEFAULT_MAX_POLLS),
  });
}

async function langDetectCommand(rest) {
  const [agentId] = rest;
  for (const variant of LANGUAGE_DETECTION_VARIANTS) {
    await tryPatch(agentId, variant.tag, {
      conversation_config: {
        agent: { prompt: { built_in_tools: { language_detection: variant.detection } } },
      },
    });
  }
}

async function emptyOverridesCommand(rest) {
  const [agentId] = rest;
  await tryPatch(agentId, "preset-leeres-overrides", {
    conversation_config: { language_presets: { es: { overrides: {} } } },
  });
}

// Gegenprobe nach dem Loeschen: nur Namen, damit nichts Inhaltliches austritt.
async function listLeftovers() {
  const agents = await callApi(`${AGENTS_PATH}?page_size=${CLEANUP_LIST_PAGE_SIZE}`, "GET");
  const tools = await callApi(TOOLS_PATH, "GET");
  console.log(
    `GEGENPROBE agenten=${JSON.stringify((agents.body.agents ?? []).map((agent) => agent.name))} werkzeuge=${JSON.stringify((tools.body.tools ?? []).map((tool) => tool.tool_config?.name))}`,
  );
}

async function cleanupCommand(rest) {
  const [agentId, toolId] = rest;
  if (agentId) {
    const res = await callApi(`${AGENTS_PATH}/${agentId}`, "DELETE");
    console.log(`DELETE agent http=${res.status}`);
  }
  if (toolId) {
    const res = await callApi(`${TOOLS_PATH}/${toolId}`, "DELETE");
    console.log(`DELETE tool http=${res.status}`);
  }
  await listLeftovers();
}

const COMMANDS = {
  "create-agent": createAgentCommand,
  "patch-turn": patchTurnCommand,
  watch: watchCommand,
  "lang-detect": langDetectCommand,
  "empty-overrides": emptyOverridesCommand,
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
  console.error(`[spike1-lab] Fehler: ${err.message}`);
  process.exitCode = 1;
});
