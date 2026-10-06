export const METHODE_GET = "GET";
export const KEIN_AUFRUF = 0;
export const EIN_AUFRUF = 1;

export const TEST_SCHLUESSEL = "test-schluessel-ohne-netz";

export const VOICEMAIL_LIVE_TEXT = "Hi, this is an AI assistant calling. Please call back.";
export const UNKONFIGURIERTES_WERKZEUG = "transfer_to_number";

export function liveWerkzeuge(voicemailText = VOICEMAIL_LIVE_TEXT) {
  return {
    end_call: { name: "end_call", type: "system", params: { system_tool_type: "end_call" } },
    language_detection: {
      name: "language_detection",
      type: "system",
      params: { system_tool_type: "language_detection", only_at_conversation_start: false },
    },
    voicemail_detection: {
      name: "voicemail_detection",
      type: "system",
      params: { system_tool_type: "voicemail_detection", voicemail_message: voicemailText },
    },
    [UNKONFIGURIERTES_WERKZEUG]: null,
  };
}

export const LIVE_MIT_DATENSCHUTZ = {
  conversation_config: {
    language_presets: {},
    agent: { prompt: { built_in_tools: liveWerkzeuge() } },
  },
  platform_settings: {
    privacy: { retention_days: -1, record_voice: true },
    overrides: { enable_conversation_initiation_client_data_from_webhook: true },
  },
};

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_OK = 200;

function fetchRouter(antworte) {
  const aufrufe = [];
  const stellvertreter = async (adresse, optionen = {}) => {
    const aufruf = {
      adresse: String(adresse),
      methode: optionen.method || METHODE_GET,
      koerper: optionen.body ?? null,
      kopf: optionen.headers ?? {},
    };
    aufrufe.push(aufruf);
    const { status, koerper } = antworte(aufruf);
    return {
      ok: status >= HTTP_OK_MIN && status <= HTTP_OK_MAX,
      status,
      text: async () => JSON.stringify(koerper),
      json: async () => structuredClone(koerper),
    };
  };
  return { aufrufe, stellvertreter };
}

export async function laufeMitAttrappe({ runCli, argumente, live = LIVE_MIT_DATENSCHUTZ }) {
  return laufeMitRouter({ runCli, argumente, antworte: () => ({ status: HTTP_OK, koerper: live }) });
}

export async function laufeMitRouter({ runCli, argumente, antworte }) {
  const { aufrufe, stellvertreter } = fetchRouter(antworte);
  const echtesFetch = globalThis.fetch;
  const echtesLog = console.log;
  const echtesError = console.error;
  const zeilen = [];
  globalThis.fetch = stellvertreter;
  console.log = (zeile) => zeilen.push(zeile);
  console.error = (zeile) => zeilen.push(zeile);
  try {
    const code = await runCli(["node", "push-elevenlabs.mjs", ...argumente]);
    return { code, aufrufe, ausgabe: zeilen.join("\n") };
  } finally {
    globalThis.fetch = echtesFetch;
    console.log = echtesLog;
    console.error = echtesError;
  }
}

export function schreibendeAufrufe(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.methode !== METHODE_GET);
}
