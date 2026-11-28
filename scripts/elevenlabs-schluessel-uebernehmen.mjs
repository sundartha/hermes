#!/usr/bin/env node
import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  elevenLabsSchluessel,
  hinterlegeElevenLabsSchluessel,
  SCHLUESSELBUND_DIENST,
} from "./lib/schluesselbund.mjs";

const LOG_PREFIX = "[elevenlabs-uebernehmen]";
const ENV_NAME = "ELEVENLABS_API_KEY";
const STANDARD_ENV_DATEI = fileURLToPath(new URL("../.env", import.meta.url));
const PRUEF_ADRESSE = "https://api.elevenlabs.io/v1/convai/agents";
const PRUEF_FRIST_MS = 15000;
const HTTP_OK = 200;
const ARG_START = 2;
const PLATTFORM_MAC = "darwin";

function fehler(text) {
  return { code: 1, text: `${LOG_PREFIX} Abbruch: ${text} Schluesselbund und .env bleiben wie sie sind.` };
}

function schluesselAusEnv(envPfad) {
  if (!existsSync(envPfad)) return { fehlt: `${envPfad} existiert nicht.` };
  const wert = (dotenv.parse(readFileSync(envPfad, "utf8"))[ENV_NAME] ?? "").trim();
  if (!wert) return { fehlt: `${ENV_NAME} steht in ${envPfad} nicht oder ist leer.` };
  return { wert };
}

async function apiStatus(schluessel, abruf) {
  const antwort = await abruf(PRUEF_ADRESSE, {
    headers: { "xi-api-key": schluessel },
    signal: AbortSignal.timeout(PRUEF_FRIST_MS),
  });
  return antwort.status;
}

function hinterlege(wert, optionen) {
  try {
    hinterlegeElevenLabsSchluessel(wert, optionen);
    return null;
  } catch (err) {
    return `security konnte den Eintrag "${SCHLUESSELBUND_DIENST}" nicht schreiben (Code ${err.status ?? "unbekannt"}).`;
  }
}

async function pruefeBeiElevenLabs({ wert, abruf }) {
  try {
    const status = await apiStatus(wert, abruf);
    return status === HTTP_OK ? null : `Die ElevenLabs-Pruefung antwortet HTTP ${status}, erwartet ${HTTP_OK}.`;
  } catch (err) {
    return `ElevenLabs nicht erreichbar (${String(err.message).replaceAll(wert, "<ELEVENLABS_API_KEY>")}).`;
  }
}

export async function uebernehme({
  envPfad = STANDARD_ENV_DATEI,
  plattform = process.platform,
  ausfuehren,
  abruf = fetch,
} = {}) {
  if (plattform !== PLATTFORM_MAC) return fehler("Der Schluesselbund gibt es nur auf dem Mac.");
  const { wert, fehlt } = schluesselAusEnv(envPfad);
  if (fehlt) return fehler(fehlt);
  const optionen = { ausfuehren };
  const schreibFehler = hinterlege(wert, optionen);
  if (schreibFehler) return fehler(schreibFehler);
  if (elevenLabsSchluessel("", { plattform, ...optionen }) !== wert) {
    return fehler(`Der Eintrag "${SCHLUESSELBUND_DIENST}" ist nach dem Schreiben nicht lesbar oder abweichend.`);
  }
  const pruefFehler = await pruefeBeiElevenLabs({ wert, abruf });
  if (pruefFehler) return fehler(pruefFehler);
  return {
    code: 0,
    text: `${LOG_PREFIX} OK - Schluessel aus ${envPfad} liegt im Schluesselbund (Dienst "${SCHLUESSELBUND_DIENST}"), ElevenLabs antwortet HTTP ${HTTP_OK}.`,
  };
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  const { code, text } = await uebernehme({ envPfad: process.argv[ARG_START] });
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}
