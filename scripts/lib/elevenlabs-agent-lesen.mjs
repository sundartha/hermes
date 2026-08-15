// LESENDER Zugriff auf die beiden Seiten des Besitz-Vergleichs: die Vorlage im
// Repo (Datei) und den Live-Agenten bei ElevenLabs (GET). Geteilt vom lesenden
// Gate (elevenlabs:drift) und vom schreibenden Kommando (elevenlabs:push) -
// beide muessen dieselbe Vorlage und denselben Agenten sehen, sonst meldet das
// eine etwas anderes, als das andere schreibt.
//
// DIESES MODUL SCHREIBT NICHT. Es kennt kein PATCH, kein POST, kein DELETE -
// die Schreib-Anfrage steht ausschliesslich im Push-Kommando. Dadurch bleibt am
// Import-Graphen ablesbar, dass elevenlabs:drift nichts veraendern KANN, statt
// dass man sich darauf verlassen muesste, dass es die Schreibfunktion nur nicht
// aufruft.
//
// Der API-Schluessel verlaesst dieses Modul nicht: nach aussen geht nur
// ohneSchluessel() (Maskierung) und schluesselFehlt() (fail-closed-Pruefung).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../../src/config.js";

import { VORLAGE_REL } from "./elevenlabs-besitz.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Der heute produktive Agent. Als Vorgabe hier und nicht in src/config.js: der
// Wert ist kein Betriebsschalter, sondern das Pruefobjekt dieser Kommandos -
// ein Argument uebersteuert ihn (z.B. fuer einen Wegwerf-Agenten).
export const LIVE_AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
export const AGENTEN_PFAD_PREFIX = "/v1/convai/agents/";

const ABRUF_TIMEOUT_MS = 15000;
export const FEHLER_VORSCHAU_ZEICHEN = 400;
const SCHLUESSEL_MASKE = "<ELEVENLABS_API_KEY>";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

// Maskiert den Schluessel in allem, was nach aussen geht (CLAUDE.md Regel 4).
export function ohneSchluessel(text) {
  if (!apiKey) return text;
  return text.replaceAll(apiKey, SCHLUESSEL_MASKE);
}

// Fail-closed: ohne Schluessel ist der Live-Agent weder lesbar noch
// vergleichbar, und ungelesen wird nichts als gruen gemeldet und erst recht
// nichts geschrieben. Liefert die Begruendung als Text oder null.
export function schluesselFehlt() {
  if (apiKey) return null;
  return "ELEVENLABS_API_KEY ist leer - ohne Schluessel ist der Live-Agent nicht lesbar.";
}

// Der reine Netz-Zugriff. Eigene Funktion, damit ein nicht erreichbarer
// Anbieter seinen Pfad im Klartext nennt: nacktes "fetch failed" sagt weder,
// welche Adresse gemeint war, noch ob das Zeitlimit zuschlug (P8).
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

// Liest den Live-Agenten. NUR GET.
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

// Laedt die Vorlage. Unlesbar und unparsebar sind zwei verschiedene Befunde und
// werden auch so gemeldet - ein nacktes "Unexpected token" laesst offen, ob
// ueberhaupt die richtige Datei gefunden wurde.
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
