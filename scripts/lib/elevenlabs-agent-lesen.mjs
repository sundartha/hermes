import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../../src/config.js";

import { VORLAGE_REL } from "./elevenlabs-besitz.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LIVE_AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
export const AGENTEN_PFAD_PREFIX = "/v1/convai/agents/";

const ABRUF_TIMEOUT_MS = 15000;
export const FEHLER_VORSCHAU_ZEICHEN = 400;
const SCHLUESSEL_MASKE = "<ELEVENLABS_API_KEY>";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

export function ohneSchluessel(text) {
  if (!apiKey) return text;
  return text.replaceAll(apiKey, SCHLUESSEL_MASKE);
}

export function schluesselFehlt() {
  if (apiKey) return null;
  return "ELEVENLABS_API_KEY ist leer - ohne Schluessel ist der Live-Agent nicht lesbar.";
}

async function holeVomAnbieter(pfad) {
  try {
    return await fetch(`${apiBase}${pfad}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(ABRUF_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `GET ${apiBase}${pfad} -> nicht erreichbar (Zeitlimit ${ABRUF_TIMEOUT_MS} ms): ${ohneSchluessel(err.message)}`,
      { cause: err },
    );
  }
}

export async function holeLiveAgenten(agentId) {
  const pfad = `${AGENTEN_PFAD_PREFIX}${agentId}`;
  const antwort = await holeVomAnbieter(pfad);
  const text = await antwort.text();
  if (!antwort.ok) {
    const anfang = ohneSchluessel(text.slice(0, FEHLER_VORSCHAU_ZEICHEN));
    throw new Error(`GET ${pfad} -> HTTP ${antwort.status}: ${anfang}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`GET ${pfad} -> Antwort ist kein JSON: ${ohneSchluessel(err.message)}`, {
      cause: err,
    });
  }
}

export function ladeVorlage() {
  const pfad = join(REPO_ROOT, VORLAGE_REL);
  let text;
  try {
    text = readFileSync(pfad, "utf8");
  } catch (err) {
    throw new Error(`${VORLAGE_REL} nicht lesbar: ${err.message}`, { cause: err });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${VORLAGE_REL} ist kein gueltiges JSON: ${err.message}`, { cause: err });
  }
}
