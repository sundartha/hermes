#!/usr/bin/env node
// P6 (PLAN-ANRUFDEFEKTE.md, W6): Vorher-Messung fuer P7 (Lehre
// bench-must-reproduce-defect) - wie oft unterbricht das ASR/Provider-Turn-Ende
// einen Agenten-Turn mitten im Sprechen, und wie viel vom geplanten Text kam
// dabei tatsaechlich raus.
//
// E-1 (woertlich): die HAUPTKENNZAHL zaehlt gegen ALLE Agenten-Turns (nicht nur
// die mit Text) - die zweite Zaehlung (Nenner nur Turns MIT Text) wird zusaetzlich
// ausgegeben und ausdruecklich benannt, weil beide Nenner in Planungsdokumenten
// vorkommen und sonst zwei Wahrheiten entstehen.
// E-2: die Gespraechsdauer gehoert in dieselbe Messung - eine Gegenmassnahme wie
// turn_eagerness:"patient" kann die Unterbrechungsrate senken UND den Anruf
// verteuern (PM-4 unten).
// E-3: die Recap-Heuristik (s. istRecapText) ist eine HEURISTIK, kein Messwert -
// sie geht NICHT in die Hauptkennzahl ein, s. FUSSNOTE.
//
// I-1/I-2/I-4: dieses Modul kennt kein "fs", kein "method:" - es gibt nur EINEN
// Netzzugriff (holeGespraech, GET). Damit ist am Quelltext ablesbar, dass das
// Werkzeug weder schreiben noch eine Datei anlegen KANN (Praezedenz
// scripts/lib/elevenlabs-agent-lesen.mjs). Der Anbieter-Fehlerrumpf wird nie
// gelesen und nie ausgegeben (er kann Gespraechsinhalt/Nummern tragen, s.
// src/elevenlabs/convai.js) - nur der HTTP-Status. Ausgegeben werden
// ausschliesslich Zahlen, nie Sprechtext.
//
// Aufruf: node scripts/anruf-unterbrechungen.mjs <conversation_id> [<conversation_id> ...]
// Exit 2: falscher Aufruf (keine Argumente, ungueltige Kennung) - kein Abruf.
// Exit 1: fehlender Schluessel oder mindestens ein gescheiterter Abruf.
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
const ARGV_KENNUNGEN_OFFSET = 2; // argv[0]=node, argv[1]=Skriptpfad - Kennungen beginnen ab Index 2
const USAGE = "Aufruf: node scripts/anruf-unterbrechungen.mjs <conversation_id> [<conversation_id> ...]";
const FUSSNOTE =
  'Fussnote: "Recap im Folge-Turn" ist eine HEURISTIK (Markerworte im naechsten\n' +
  "Agenten-Turn mit Text), kein Messwert. Sie erkennt eine Erholung nicht zuverlaessig und\n" +
  "geht in die Hauptkennzahl NICHT ein.";

// HEURISTIK, KEIN MESSWERT (E-3). Grundlage ist der belegte Fall aus W6: der als
// "gut" bewertete Anruf vom 03.09. hatte einen zu 52,5 % abgeschnittenen Turn und
// lief sauber weiter, WEIL der Agent im naechsten Turn ausdruecklich zusammenfasste
// ("Entschuldige, ich glaube die Verbindung war kurz schlecht ..."). Das
// unterscheidende Merkmal ist die RATE unterbrochener Turns UND das FEHLEN einer
// Recap-Erholung - nicht der Verlust eines Einzel-Turns.
//
// GRENZEN, ausdruecklich: Marker sind Wortstuecke, keine Bedeutung. Ein Agent kann
// zusammenfassen, ohne einen Marker zu benutzen (falsch negativ), und "sorry" kann
// etwas anderes heissen (falsch positiv). Deshalb steht die Zahl unter der
// FUSSNOTE oben und geht nicht in die Hauptkennzahl ein.
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

// ---- reine Funktionen (kein IO, keine Uhr - offline testbar) --------------------

// Laenge in Zeichen; fehlender/leerer Text zaehlt als 0. EINE Laengen-Definition
// fuer "hat Text" und fuer den Zeichenanteil (G5) - zwei waeren zwei Wahrheiten.
export function zeichenzahl(text) {
  return text === null || text === undefined ? 0 : text.length;
}

export function istGueltigeKennung(kennung) {
  return typeof kennung === "string" && KENNUNG_MUSTER.test(kennung);
}

// Alle Turns mit role === "agent", in Transkript-Reihenfolge. Strikter Vergleich,
// nie truthy raten.
export function agentenTurns(gespraech) {
  const transcript = gespraech?.transcript ?? [];
  return transcript.filter((turn) => turn.role === AGENT_ROLLE);
}

// len(message)/len(original_message) EINES unterbrochenen Turns. Fehlt
// original_message oder ist sie leer -> null ("nicht berechenbar"), NIE eine
// erfundene 1.0 oder 0 (Praezedenz ratePercent === null in abandonStats).
export function ausgelieferterAnteil(turn) {
  const originalLaenge = zeichenzahl(turn.original_message);
  if (originalLaenge === 0) return null;
  return (zeichenzahl(turn.message) / originalLaenge) * PROZENT;
}

// Kombinierende diakritische Zeichen (U+0300-U+036F) nach NFD-Zerlegung entfernen,
// damit z.B. "desole" (Marker, reines ASCII) auf "désolé" (Anbieter-Transkript) trifft.
function normalisiereText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// HEURISTIK (E-3, s. Kopfkommentar RECAP_MARKER).
export function istRecapText(text) {
  if (zeichenzahl(text) === 0) return false;
  const normalisiert = normalisiereText(text);
  return RECAP_MARKER.some((marker) => normalisiert.includes(marker));
}

// Der naechste Agenten-Turn MIT Text nach Position index in turns; gibt es
// keinen -> false.
export function recapImFolgeTurn(turns, index) {
  for (let i = index + 1; i < turns.length; i++) {
    const kandidat = turns[i];
    if (zeichenzahl(kandidat.message) > 0) return istRecapText(kandidat.message);
  }
  return false;
}

// zaehler/nenner*100, oder null bei leerem Nenner (nie eine erfundene 0).
function anteilVon(zaehler, nenner) {
  return nenner === 0 ? null : (zaehler / nenner) * PROZENT;
}

// Die Auswertung EINES Anrufs. Rohform des Anbieters rein, nur Zahlen raus.
// Eine Aufgabe, eine Abstraktionsebene (G30/G34): zaehlt und rechnet, formatiert
// und druckt nicht.
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

// Zusammenfassung ueber alle Anrufe. Mittel UEBER ANRUFE (jeder Anruf zaehlt
// gleich), nicht gepoolt. Leere Menge -> null, keine erfundene 0.
export function fasseZusammen(analysen) {
  const anteile = analysen.map((analyse) => analyse.anteilAlleTurns).filter((wert) => wert !== null);
  const dauern = analysen.map((analyse) => analyse.dauerSekunden).filter((wert) => wert !== null);
  return {
    anzahl: analysen.length,
    mittlererUnterbrechungsanteil: mittelwert(anteile),
    mittlereDauerSekunden: mittelwert(dauern),
  };
}

// EINE Formatierungsquelle fuer Skript-Ausgabe UND Test (G5).
export function alsProzent(anteil) {
  return anteil === null ? "-" : anteil.toFixed(PROZENT_NACHKOMMA);
}
export function alsSekunden(dauer) {
  return dauer === null ? "-" : dauer.toFixed(DAUER_NACHKOMMA);
}

// ---- IO-Teil ---------------------------------------------------------------

// Der EINZIGE Netzzugriff, GET. Fehlerrumpf wird NIE gelesen (Absolute Regel
// 4/5) - er kann Gespraechsinhalt tragen; der Status reicht zur Diagnose.
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

// DIP (P4): der Abruf ist injizierbar, damit der Test ohne Netz laeuft. Ein
// fehlgeschlagener Anruf beendet den Lauf NICHT still: er landet in fehler[].
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

// Fail-closed vor dem ersten Byte: keine Argumente oder eine ungueltige Kennung
// beenden den Lauf, BEVOR ueberhaupt ein Abruf versucht wird.
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

// Nur als Skript ausfuehren, NICHT beim Import (Muster telnyx-call-latency.mjs).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
