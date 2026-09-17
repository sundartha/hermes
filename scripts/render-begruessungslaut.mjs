#!/usr/bin/env node
// IEP-P2c (Owner-Entscheidung 2026-09-17): UMWANDLER Quelle -> Auslieferungsdatei.
//
// Der gerechnete Laut aus IEP-P2b ist durchgefallen ("hoert sich an wie Gewitter"). Der Owner hat
// einen von ElevenLabs erzeugten Soundeffekt ausgewaehlt und abgenommen: weiches Abheben des
// Hoerers, danach ruhige Leitung. Dieses Skript synthetisiert nichts mehr - es dokumentiert den
// wiederholbaren Weg von der abgenommenen Quelle zur Auslieferungsdatei.
//
// DREI SCHRITTE, jeder mit Grund:
//   (a) afconvert (macOS-Bordmittel) dekodiert die mp3 und liefert 8 kHz mono PCM16 - die
//       Telefonie-Rate, also keine Transcodierung auf dem Weg zum Anrufer. KEINE npm-Dependency:
//       ein lokales Werkzeug, wie ffmpeg in scripts/stt-wer.mjs. Auf einem Nicht-macOS-Rechner
//       schlaegt der Lauf fehl; das ist beabsichtigt - die Auslieferungsdatei liegt im Repo.
//   (b) Skalierung auf ZIEL_SPITZENPEGEL. Zu leise ist so schaedlich wie zu laut: der erste
//       Entwurf lag bei -40 dBFS und war am Telefon nicht wahrnehmbar.
//   (c) lineare Ausblende ueber AUSBLENDE_MS. Telnyx wiederholt die audioUrl - ein harter Schnitt
//       am Ende knackte bei jeder Wiederholung.
//
// DIE COMMITTETE DATEI IST DIE ABGENOMMENE FASSUNG, nicht die Ausgabe dieses Laufs: ein
// Nachlauf trifft sie hoerbar, aber nicht byte-genau (Container-Polsterung von afconvert,
// +-1 LSB Rundung). Deshalb pinnt KEIN Test die Bytes; test/iep-p2-begruessungslaut.test.js
// beschreibt die Eigenschaften der Datei, und kein Test ruft afconvert.
//
// Aufruf:
//   node scripts/render-begruessungslaut.mjs            -> ERSETZT die abgenommene Auslieferungsdatei
//   node scripts/render-begruessungslaut.mjs /tmp/x.wav -> schreibt woandershin (Pruefung ohne Risiko)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { leseWav } from "./iel-mess-audio.mjs";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "../src/elevenlabs/inbound-rueckfall.js";

const REPO_WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// EINE Quelle fuer beide Enden des Wegs.
const QUELLE_PFAD = path.join(REPO_WURZEL, "scripts", "quellen", "hermes-begruessungslaut-quelle.mp3");
const AUSLIEFERUNG_PFAD = path.join(REPO_WURZEL, "public", EL_BEGRUESSUNGSLAUT_PFAD);

// Jede Zahl traegt einen Namen (G25).
const ZIEL_ABTASTRATE_HZ = 8000;
const ZIEL_KANAELE = 1;
const ZIEL_BIT_TIEFE = 16;
const ZIEL_SPITZENPEGEL = 0.1; // -20,0 dBFS: hoerbar am Telefon, nie aufdringlich
const AUSBLENDE_MS = 150;
const PCM_FORMAT_TAG = 1;

const AFCONVERT = "/usr/bin/afconvert";
const AFCONVERT_DATENFORMAT = `LEI${ZIEL_BIT_TIEFE}@${ZIEL_ABTASTRATE_HZ}`; // little-endian int16

const BITS_PRO_BYTE = 8;
const FMT_CHUNK_BYTES = 16;
const RIFF_KOPF_BYTES = 44;
const RIFF_GROESSE_VORLAUF_BYTES = 8;
const UINT16_BYTES = 2;
const UINT32_BYTES = 4;
const INT16_SKALA = 32768; // Gegenstueck zur Normierung in leseWav
const INT16_MAX = 32767;
const INT16_MIN = -32768;
const MS_PER_SECOND = 1000;
const DBFS_JE_DEKADE = 20;
const DBFS_NACHKOMMA = 2;
const BYTES_PRO_RAHMEN = (ZIEL_BIT_TIEFE / BITS_PRO_BYTE) * ZIEL_KANAELE;

/** Schreibt die Quelle als 8 kHz mono PCM16 nach zielPfad. Nebeneffekt im Namen (N7). */
function schreibePcm16Umwandlung(quellPfad, zielPfad) {
  // execFile ohne Shell, feste Argumente - keine Nutzereingabe im Kommando.
  execFileSync(AFCONVERT, ["-f", "WAVE", "-d", AFCONVERT_DATENFORMAT, "-c", String(ZIEL_KANAELE), quellPfad, zielPfad]);
}

/** Fail-closed: was afconvert lieferte, muss das Zielformat sein - sonst lieber Abbruch als stille Fehlkonvertierung. */
function pruefeZielformat(format) {
  const stimmt =
    format.code === PCM_FORMAT_TAG &&
    format.kanaele === ZIEL_KANAELE &&
    format.abtastrate === ZIEL_ABTASTRATE_HZ &&
    format.bits === ZIEL_BIT_TIEFE;
  if (!stimmt) {
    throw new Error(
      `afconvert lieferte Formatcode ${format.code}, ${format.kanaele} Kanal(e), ${format.abtastrate} Hz, ` +
        `${format.bits} bit - erwartet PCM, ${ZIEL_KANAELE} Kanal, ${ZIEL_ABTASTRATE_HZ} Hz, ${ZIEL_BIT_TIEFE} bit`,
    );
  }
}

/** Rein: Proben so skaliert, dass die groesste Auslenkung genau spitzenpegel betraegt. */
function aufSpitzenpegelSkaliert(proben, spitzenpegel) {
  const spitze = proben.reduce((groesster, wert) => Math.max(groesster, Math.abs(wert)), 0) || 1;
  const faktor = spitzenpegel / spitze;
  return Float64Array.from(proben, (wert) => wert * faktor);
}

/** Rein: lineare Ausblende ueber die letzten ausblendeRahmen Rahmen (Faktor 1 -> 0). */
function mitLinearerAusblende(proben, ausblendeRahmen) {
  const ausgabe = Float64Array.from(proben);
  const start = Math.max(0, ausgabe.length - ausblendeRahmen);
  for (let i = start; i < ausgabe.length; i += 1) {
    const faktor = (ausgabe.length - 1 - i) / (ausgabe.length - 1 - start);
    ausgabe[i] *= faktor;
  }
  return ausgabe;
}

// Kanonischer RIFF/WAVE-Kopf, sequenziell geschrieben - so steht keine nackte Byte-Position im
// Code (G25); die Reihenfolge der Felder IST das Format.
function wavKopf(datenBytes) {
  const teile = [];
  const text = (zeichen) => teile.push(Buffer.from(zeichen, "ascii"));
  const uint16 = (wert) => {
    const feld = Buffer.alloc(UINT16_BYTES);
    feld.writeUInt16LE(wert);
    teile.push(feld);
  };
  const uint32 = (wert) => {
    const feld = Buffer.alloc(UINT32_BYTES);
    feld.writeUInt32LE(wert);
    teile.push(feld);
  };
  text("RIFF");
  uint32(RIFF_KOPF_BYTES - RIFF_GROESSE_VORLAUF_BYTES + datenBytes);
  text("WAVE");
  text("fmt ");
  uint32(FMT_CHUNK_BYTES);
  uint16(PCM_FORMAT_TAG);
  uint16(ZIEL_KANAELE);
  uint32(ZIEL_ABTASTRATE_HZ);
  uint32(ZIEL_ABTASTRATE_HZ * BYTES_PRO_RAHMEN); // Byte-Rate
  uint16(BYTES_PRO_RAHMEN); // Block-Ausrichtung
  uint16(ZIEL_BIT_TIEFE);
  text("data");
  uint32(datenBytes);
  return Buffer.concat(teile);
}

// Float [-1,1] -> PCM16, geklemmt.
function pcmDaten(proben) {
  const puffer = Buffer.alloc(proben.length * BYTES_PRO_RAHMEN);
  proben.forEach((wert, index) => {
    const skaliert = Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(wert * INT16_SKALA)));
    puffer.writeInt16LE(skaliert, index * BYTES_PRO_RAHMEN);
  });
  return puffer;
}

/** Rein: fertige WAV-Bytes aus Proben. */
function alsWavDatei(proben) {
  const daten = pcmDaten(proben);
  return Buffer.concat([wavKopf(daten.length), daten]);
}

// EINZIGES IO ausser afconvert: Umwandeln, nachbearbeiten, schreiben, Messzeile ausgeben.
function schreibeBegruessungslaut(zielPfad) {
  const arbeitsverzeichnis = mkdtempSync(path.join(tmpdir(), "hermes-laut-"));
  try {
    const rohPfad = path.join(arbeitsverzeichnis, "roh.wav");
    schreibePcm16Umwandlung(QUELLE_PFAD, rohPfad);

    const { abtastrate, kanaele, format } = leseWav(readFileSync(rohPfad));
    pruefeZielformat(format);

    const ausblendeRahmen = Math.round((AUSBLENDE_MS * abtastrate) / MS_PER_SECOND);
    const proben = mitLinearerAusblende(aufSpitzenpegelSkaliert(kanaele[0], ZIEL_SPITZENPEGEL), ausblendeRahmen);
    writeFileSync(zielPfad, alsWavDatei(proben));

    const spitze = proben.reduce((groesster, wert) => Math.max(groesster, Math.abs(wert)), 0);
    const spitzeDbfs = (DBFS_JE_DEKADE * Math.log10(spitze)).toFixed(DBFS_NACHKOMMA);
    const dauerMs = ((proben.length * MS_PER_SECOND) / abtastrate).toFixed(1);
    console.log(`geschrieben: ${zielPfad} (${abtastrate} Hz, ${kanaele.length} Kanal, ${ZIEL_BIT_TIEFE} bit, ${dauerMs} ms, ${spitzeDbfs} dBFS)`);

    if (zielPfad === AUSLIEFERUNG_PFAD) {
      console.log("Achtung: die abgenommene Owner-Fassung wurde ersetzt - anhoeren und Owner-Freigabe einholen.");
      console.log("Zuruecknehmen mit: git checkout -- public/brand/hermes-begruessungslaut.wav");
    }
  } finally {
    rmSync(arbeitsverzeichnis, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  schreibeBegruessungslaut(process.argv[2] ? path.resolve(process.argv[2]) : AUSLIEFERUNG_PFAD);
}
