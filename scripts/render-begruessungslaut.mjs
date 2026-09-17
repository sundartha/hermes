#!/usr/bin/env node
// IEP-P2 (Owner-Entscheidung 10): Rezept des Begruessungslauts, der die Luecke zwischen der
// Sofortannahme des eingehenden Beins und der ersten Agentensilbe besetzt.
//
// Der Laut ist KEIN <Say>: in Owner-Test #1 lagen zwischen playback_start und playback_started
// rund 1,0 s Stille, weil im Anrufmoment synthetisiert wurde. Er ist auch kein Freiton: das
// US-Freizeichen ist ein DOPPELTON aus 440 und 480 Hz in fester Kadenz - hier steht ein
// einmaliger steigender Zweiklang mit Ausklang, danach Stille. Und er ist keine Sprache: der
// erste gesprochene Satz bleibt die freigegebene Agenten-Eroeffnung (Owner-Entscheidung 1/9).
//
// Warum ein Rezept statt einer blossen Binaerdatei: der Laut bliebe sonst ein Blindgaenger, den
// niemand mehr reproduzieren koennte. test/iep-p2-begruessungslaut.test.js regeneriert ihn und
// vergleicht byte-genau gegen die committete Datei.
//
// Aufruf: node scripts/render-begruessungslaut.mjs   (schreibt public/brand/…, idempotent)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EL_BEGRUESSUNGSLAUT_PFAD } from "../src/elevenlabs/inbound-rueckfall.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";

// Jede Zahl traegt einen Namen (G25). Die Frequenzen sind ausdruecklich disjunkt zu {440, 480}.
export const BEGRUESSUNGSLAUT_REZEPT = Object.freeze({
  abtastrateHz: 8000, // Telefonie-Rate: keine Transcodierung, kein Qualitaetsverlust
  kanaele: 1,
  bitTiefe: 16,
  spitzenpegel: 0.28, // rund -11 dBFS: hoerbar, leiser als Sprache
  toene: Object.freeze([
    Object.freeze({ hz: 587.33, dauerMs: 190, einblendeMs: 12, ausblendeMs: 40 }), // D5
    Object.freeze({ hz: 880.0, dauerMs: 510, einblendeMs: 12, ausblendeMs: 510 }), // A5, klingt aus
  ]),
  // Nachlauf-Stille: Telnyx spielt einen Ringback WIEDERHOLT. Ohne diesen Nachlauf waere die
  // Wiederholperiode 0,7 s - also genau die Kadenz, die der Auftrag verbietet. Mit ihm liegt die
  // erste Wiederholung bei 2,5 s, weit hinter der EL-Annahme (0,7-0,9 s): im Regelfall hoert der
  // Anrufer den Laut GENAU EINMAL.
  nachlaufStilleMs: 1800,
});
// Hoerbare Laenge 700 ms ("kurz"), Dateilaenge 2500 ms.

// Kanonisches RIFF/WAVE mit PCM-Rahmen - kein ffmpeg, keine neue Dependency.
const BITS_PRO_BYTE = 8;
const PCM_FORMAT_TAG = 1; // unkomprimiertes PCM
const FMT_CHUNK_BYTES = 16; // kanonischer PCM-fmt-Chunk
const RIFF_KOPF_BYTES = 44; // RIFF(12) + fmt(24) + data-Kopf(8)
const RIFF_GROESSE_VORLAUF_BYTES = 8; // "RIFF" und sein Groessenfeld zaehlen nicht mit
const UINT16_BYTES = 2;
const UINT32_BYTES = 4;
const INT16_MAX = 32767;
const HALBKREISE_PRO_VOLLKREIS = 2;
const VOLLER_KREIS_RAD = HALBKREISE_PRO_VOLLKREIS * Math.PI;
const BYTES_PRO_RAHMEN = (BEGRUESSUNGSLAUT_REZEPT.bitTiefe / BITS_PRO_BYTE) * BEGRUESSUNGSLAUT_REZEPT.kanaele;

const REPO_WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Zielablage: derselbe Pfad, den die Dial-Direktive als URL ausliefert (EINE Quelle - der Test
// vergleicht ihn gegen config.server.publicDir).
export const BEGRUESSUNGSLAUT_DATEIPFAD = path.join(REPO_WURZEL, "public", EL_BEGRUESSUNGSLAUT_PFAD);

// Rahmenzahl einer Dauer bei der Rezept-Abtastrate.
function rahmenAnzahl(dauerMs) {
  return Math.round((dauerMs * BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) / MS_PER_SECOND);
}

// Linearer Huellkurven-Faktor: Einblende am Anfang, Ausblende am Ende des Tons. Ohne sie knackt
// jeder Sprung im Telefonkanal hoerbar.
function huellkurve({ rahmen, gesamtRahmen, einblendeRahmen, ausblendeRahmen }) {
  const einblende = einblendeRahmen > 0 ? Math.min(1, rahmen / einblendeRahmen) : 1;
  const ausblende = ausblendeRahmen > 0 ? Math.min(1, (gesamtRahmen - rahmen) / ausblendeRahmen) : 1;
  return Math.min(einblende, ausblende);
}

// Int16-Rahmen eines einzelnen Tons (Sinus mal Huellkurve mal Spitzenpegel).
function tonRahmen(ton) {
  const gesamtRahmen = rahmenAnzahl(ton.dauerMs);
  const einblendeRahmen = rahmenAnzahl(ton.einblendeMs);
  const ausblendeRahmen = rahmenAnzahl(ton.ausblendeMs);
  const werte = [];
  for (let rahmen = 0; rahmen < gesamtRahmen; rahmen += 1) {
    const schwingung = Math.sin((VOLLER_KREIS_RAD * ton.hz * rahmen) / BEGRUESSUNGSLAUT_REZEPT.abtastrateHz);
    const pegel =
      BEGRUESSUNGSLAUT_REZEPT.spitzenpegel *
      huellkurve({ rahmen, gesamtRahmen, einblendeRahmen, ausblendeRahmen }) *
      schwingung;
    werte.push(Math.round(pegel * INT16_MAX));
  }
  return werte;
}

function stilleRahmen(dauerMs) {
  return new Array(rahmenAnzahl(dauerMs)).fill(0);
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
  uint16(BEGRUESSUNGSLAUT_REZEPT.kanaele);
  uint32(BEGRUESSUNGSLAUT_REZEPT.abtastrateHz);
  uint32(BEGRUESSUNGSLAUT_REZEPT.abtastrateHz * BYTES_PRO_RAHMEN); // Byte-Rate
  uint16(BYTES_PRO_RAHMEN); // Block-Ausrichtung
  uint16(BEGRUESSUNGSLAUT_REZEPT.bitTiefe);
  text("data");
  uint32(datenBytes);
  return Buffer.concat(teile);
}

function pcmDaten(rahmen) {
  const puffer = Buffer.alloc(rahmen.length * BYTES_PRO_RAHMEN);
  rahmen.forEach((wert, index) => puffer.writeInt16LE(wert, index * BYTES_PRO_RAHMEN));
  return puffer;
}

// Rein: gleiches Rezept -> gleiche Bytes, kein IO.
export function rendereBegruessungslautWav() {
  const rahmen = [
    ...BEGRUESSUNGSLAUT_REZEPT.toene.flatMap(tonRahmen),
    ...stilleRahmen(BEGRUESSUNGSLAUT_REZEPT.nachlaufStilleMs),
  ];
  const daten = pcmDaten(rahmen);
  return Buffer.concat([wavKopf(daten.length), daten]);
}

// EINZIGES IO des Skripts.
function schreibeBegruessungslaut() {
  writeFileSync(BEGRUESSUNGSLAUT_DATEIPFAD, rendereBegruessungslautWav());
  console.log(`geschrieben: ${BEGRUESSUNGSLAUT_DATEIPFAD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) schreibeBegruessungslaut();
