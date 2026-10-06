#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

const GESPRAECHS_PFAD = "/v1/convai/conversations/";
const API_SCHLUESSEL_KOPFZEILE = "xi-api-key";
const ABRUF_TIMEOUT_MS = 15000;
const AGENT_ROLLE = "agent";
const PROZENT = 100;
const PROZENT_NACHKOMMA = 1;
const DAUER_NACHKOMMA = 1;
const KENNUNG_MUSTER = /^conv_[A-Za-z0-9]+$/;
const EXIT_AUFRUFFEHLER = 2;
const ARGV_KENNUNGEN_OFFSET = 2;
const USAGE = "Aufruf: node scripts/anruf-unterbrechungen.mjs <conversation_id> [<conversation_id> ...]";
const FUSSNOTE =
  'Fussnote: "Recap im Folge-Turn" ist eine HEURISTIK (Markerworte im naechsten\n' +
  "Agenten-Turn mit Text), kein Messwert. Sie erkennt eine Erholung nicht zuverlaessig und\n" +
  "geht in die Hauptkennzahl NICHT ein.";

export const RECAP_MARKER = Object.freeze([
  "entschuldig",
  "verbindung",
  "noch einmal",
  "nochmal",
  "wie gesagt",
  "wiederhol",
  "kurz zusammen",
  "sorry",
  "connection",
  "again",
  "as i said",
  "repeat",
  "desole",
  "connexion",
  "encore une fois",
  "je repete",
]);

export function zeichenzahl(text) {
  return text === null || text === undefined ? 0 : text.length;
}

export function istGueltigeKennung(kennung) {
  return typeof kennung === "string" && KENNUNG_MUSTER.test(kennung);
}

export function agentenTurns(gespraech) {
  const transcript = gespraech?.transcript ?? [];
  return transcript.filter((turn) => turn.role === AGENT_ROLLE);
}

export function ausgelieferterAnteil(turn) {
  const originalLaenge = zeichenzahl(turn.original_message);
  if (originalLaenge === 0) return null;
  return (zeichenzahl(turn.message) / originalLaenge) * PROZENT;
}

function normalisiereText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function istRecapText(text) {
  if (zeichenzahl(text) === 0) return false;
  const normalisiert = normalisiereText(text);
  return RECAP_MARKER.some((marker) => normalisiert.includes(marker));
}

export function recapImFolgeTurn(turns, index) {
  for (let i = index + 1; i < turns.length; i++) {
    const kandidat = turns[i];
    if (zeichenzahl(kandidat.message) > 0) return istRecapText(kandidat.message);
  }
  return false;
}

function anteilVon(zaehler, nenner) {
  return nenner === 0 ? null : (zaehler / nenner) * PROZENT;
}

export function analysiereGespraech(gespraech) {
  const turns = agentenTurns(gespraech);
  const mitText = turns.filter((turn) => zeichenzahl(turn.message) > 0).length;
  const unterbrochene = [];
  turns.forEach((turn, index) => {
    if (!turn.interrupted) return;
    unterbrochene.push({
      sekunde: turn.time_in_call_secs,
      anteil: ausgelieferterAnteil(turn),
      recapFolgt: recapImFolgeTurn(turns, index),
    });
  });
  const unterbrochen = unterbrochene.length;
  const recapErholungen = unterbrochene.filter((eintrag) => eintrag.recapFolgt).length;
  return {
    kennung: gespraech.conversation_id,
    dauerSekunden: gespraech?.metadata?.call_duration_secs ?? null,
    agentenTurns: turns.length,
    mitText,
    unterbrochen,
    anteilAlleTurns: anteilVon(unterbrochen, turns.length),
    anteilTextTurns: anteilVon(unterbrochen, mitText),
    recapErholungen,
    unterbrochene,
  };
}

function mittelwert(werte) {
  if (werte.length === 0) return null;
  return werte.reduce((summe, wert) => summe + wert, 0) / werte.length;
}

export function fasseZusammen(analysen) {
  const anteile = analysen.map((analyse) => analyse.anteilAlleTurns).filter((wert) => wert !== null);
  const dauern = analysen.map((analyse) => analyse.dauerSekunden).filter((wert) => wert !== null);
  return {
    anzahl: analysen.length,
    mittlererUnterbrechungsanteil: mittelwert(anteile),
    mittlereDauerSekunden: mittelwert(dauern),
  };
}

export function alsProzent(anteil) {
  return anteil === null ? "-" : anteil.toFixed(PROZENT_NACHKOMMA);
}
export function alsSekunden(dauer) {
  return dauer === null ? "-" : dauer.toFixed(DAUER_NACHKOMMA);
}

async function holeGespraech(kennung) {
  const url = `${apiBase}${GESPRAECHS_PFAD}${encodeURIComponent(kennung)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABRUF_TIMEOUT_MS);
  try {
    const antwort = await fetch(url, {
      headers: { [API_SCHLUESSEL_KOPFZEILE]: apiKey },
      signal: controller.signal,
    });
    if (!antwort.ok) {
      throw new Error(`GET ${GESPRAECHS_PFAD}${kennung} -> HTTP ${antwort.status}`);
    }
    return await antwort.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function messeAnrufe(kennungen, { holeGespraech: abruf = holeGespraech } = {}) {
  const analysen = [];
  const fehler = [];
  for (const kennung of kennungen) {
    try {
      const gespraech = await abruf(kennung);
      analysen.push(analysiereGespraech(gespraech));
    } catch (err) {
      fehler.push({ kennung, grund: err.message });
    }
  }
  return { analysen, fehler };
}

function berichteAnruf(analyse) {
  console.log(`Anruf ${analyse.kennung}`);
  console.log(`  Gespraechsdauer                 ${alsSekunden(analyse.dauerSekunden)} s`);
  console.log(`  Agenten-Turns                   ${analyse.agentenTurns}   (davon mit Text ${analyse.mitText})`);
  console.log(`  unterbrochen                    ${analyse.unterbrochen}`);
  console.log(
    `  Unterbrechungsanteil            ${alsProzent(analyse.anteilAlleTurns)} %   HAUPTKENNZAHL (Nenner: alle Agenten-Turns)`,
  );
  console.log(
    `  zum Vergleich                   ${alsProzent(analyse.anteilTextTurns)} %   (Nenner: nur Turns mit Text)`,
  );
  console.log(
    `  Recap-Erholungen                ${analyse.recapErholungen} von ${analyse.unterbrochen}   (Heuristik, s. Fussnote)`,
  );
  console.log("  ausgelieferter Zeichenanteil je unterbrochenem Turn:");
  analyse.unterbrochene.forEach((eintrag) => {
    const recapText = eintrag.recapFolgt ? "ja" : "nein";
    console.log(`    t=${eintrag.sekunde} s   ${alsProzent(eintrag.anteil)} %   Recap im Folge-Turn: ${recapText}`);
  });
}

function berichteZusammenfassung(zusammenfassung) {
  console.log(`--- Zusammenfassung ueber ${zusammenfassung.anzahl} Anruf(e) ---`);
  console.log(
    `mittlerer Unterbrechungsanteil (Mittel ueber Anrufe)   ${alsProzent(zusammenfassung.mittlererUnterbrechungsanteil)} %`,
  );
  console.log(`mittlere Gespraechsdauer                               ${alsSekunden(zusammenfassung.mittlereDauerSekunden)} s`);
  console.log(FUSSNOTE);
}

function berichteFehler(fehler) {
  fehler.forEach((eintrag) => {
    console.error(`Fehler bei ${eintrag.kennung}: ${eintrag.grund}`);
  });
}

function pruefeAufrufform(kennungen) {
  if (kennungen.length === 0) {
    console.error(USAGE);
    process.exit(EXIT_AUFRUFFEHLER);
  }
  const ungueltig = kennungen.filter((kennung) => !istGueltigeKennung(kennung));
  if (ungueltig.length > 0) {
    console.error(`Ungueltige Kennung(en): ${ungueltig.join(", ")} - erwartetes Format: conv_<alphanumerisch>`);
    process.exit(EXIT_AUFRUFFEHLER);
  }
}

async function main() {
  const kennungen = process.argv.slice(ARGV_KENNUNGEN_OFFSET);
  pruefeAufrufform(kennungen);
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY ist leer - ohne Schluessel ist die Conversation-API nicht lesbar.");
    process.exit(1);
  }
  const { analysen, fehler } = await messeAnrufe(kennungen);
  analysen.forEach(berichteAnruf);
  berichteZusammenfassung(fasseZusammen(analysen));
  berichteFehler(fehler);
  if (fehler.length > 0) process.exit(1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
