#!/usr/bin/env node
// IEP-P2b (Owner-Befund 2026-09-17): Rezept des Begruessungslauts, der die Luecke zwischen der
// Sofortannahme des eingehenden Beins und der ersten Agentensilbe besetzt.
//
// Die erste Fassung (IEP-P2) war ein Sinus-Zweiklang bei -11 dBFS. Der Owner hat sie am
// Live-Stand abgelehnt: hoch, piepsig, tut in den Ohren weh. Gemessen ist das kein Ton
// "oberhalb 1 kHz" (beide Toene lagen darunter), sondern die Kombination aus Pegel,
// Tonalitaet und Flankensteilheit - genau die drei Groessen, die test/iep-p2-begruessungslaut.js
// jetzt als Schranke pinnt.
//
// SOLL: Raumruhe, die nicht auffaellt - "als ob jemand abheben wuerde". Also kein Ton,
// sondern bandbegrenztes Komfortrauschen mit EINEM weichen Abhebe-Impuls.
//
// Vier Bauentscheidungen, jede mit Grund:
//   (a) Bandpass 300..750 Hz statt reinem Tiefpass. Ein reiner Tiefpass legt zwei Drittel der
//       Energie unter 300 Hz - unter die Uebertragungsgrenze eines Telefonhoerers. Der Pegel
//       waere nominell eingehalten und der Laut trotzdem unhoerbar.
//   (b) Durchgehendes Bett statt "kurz + Nachlauf-Stille". Der Nachlauf der ersten Fassung war
//       reiner Kadenz-Schutz: Telnyx wiederholt die audioUrl. Ein durchgehendes Bett hat gar
//       keine Kadenz. Die Dateilaenge haelt nur noch den Abhebe-Impuls aus dem Annahmefenster.
//   (c) Nahtlose Schleife durch eine Aufwaerm-Runde: jede Filterstufe laeuft ZWEIMAL ueber
//       dasselbe Rausch-Array, behalten wird die zweite. Bei periodischem Eingang ist der
//       eingeschwungene Ausgang exakt periodisch - der Schleifenpunkt ist keine Unstetigkeit.
//   (d) Der weiche Einsatz sitzt im Impuls, nicht in einer Bett-Einblendung. Eine Einblendung
//       waere eine Pegel-Delle genau am Schleifenpunkt.
//
// Der Laut bleibt sprachlos: der erste gesprochene Satz ist die freigegebene Agenten-Eroeffnung
// (Owner-Entscheidung 1/9).
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

// Jede Zahl traegt einen Namen (G25). Die Pegel sind Spitzenpegel als Bruchteil der
// Vollaussteuerung: 0.0060 = -44.4 dBFS (Bett), Gesamtspitze mit Impuls -39.9 dBFS.
export const BEGRUESSUNGSLAUT_REZEPT = Object.freeze({
  abtastrateHz: 8000, // Telefonie-Rate: keine Transcodierung, kein Qualitaetsverlust
  kanaele: 1,
  bitTiefe: 16,
  dauerMs: 6000, // haelt den Abhebe-Impuls aus dem EL-Annahmefenster (0,7-0,9 s) heraus
  // Komfortrauschen: die Raumruhe, die das Fenster traegt. Deterministischer Seed - derselbe
  // Laut bei jedem Rendern (Bestandstest IEP-P2-A1 vergleicht byte-genau).
  bett: Object.freeze({
    seed: 0x1ed2b2,
    tiefpassHz: 750,
    tiefpassStufen: 5, // 5 Einpol-Stufen ~ 30 dB/Oktave: oberhalb 1 kHz bleibt nichts Hoerbares
    hochpassHz: 300,
    hochpassStufen: 2, // haelt die Energie im Band, das ein Telefonhoerer ueberhaupt uebertraegt
    spitzenpegel: 0.006,
  }),
  // "Als ob jemand abheben wuerde": ein einzelner, dumpfer, weich ein- und ausgeblendeter
  // Stoss zu Beginn. Duempfer als das Bett (260 Hz) und nur rund 4,5 dB darueber.
  impuls: Object.freeze({
    seed: 0x7f4c19,
    dauerMs: 120,
    tiefpassHz: 260,
    tiefpassStufen: 4,
    spitzenpegel: 0.01,
  }),
});

// Kanonisches RIFF/WAVE mit PCM-Rahmen - kein ffmpeg, keine neue Dependency.
const BITS_PRO_BYTE = 8;
const PCM_FORMAT_TAG = 1; // unkomprimiertes PCM
const FMT_CHUNK_BYTES = 16; // kanonischer PCM-fmt-Chunk
const RIFF_KOPF_BYTES = 44; // RIFF(12) + fmt(24) + data-Kopf(8)
const RIFF_GROESSE_VORLAUF_BYTES = 8; // "RIFF" und sein Groessenfeld zaehlen nicht mit
const UINT16_BYTES = 2;
const UINT32_BYTES = 4;
const INT16_MAX = 32767;
const INT16_MIN = -32768;
const HALBKREISE_PRO_VOLLKREIS = 2;
const VOLLER_KREIS_RAD = HALBKREISE_PRO_VOLLKREIS * Math.PI;
const BYTES_PRO_RAHMEN = (BEGRUESSUNGSLAUT_REZEPT.bitTiefe / BITS_PRO_BYTE) * BEGRUESSUNGSLAUT_REZEPT.kanaele;

// xorshift32: deterministischer Zufall ohne Dependency. Integer-Operationen, damit dasselbe
// Rezept auf jeder Maschine dieselben Bytes ergibt.
const XORSHIFT_LINKS_A = 13;
const XORSHIFT_RECHTS = 17;
const XORSHIFT_LINKS_B = 5;
const UINT32_MAX = 0xffffffff;
const SPANNE_MITTE = 2; // [0,1) -> [-1,1)

// Aufwaerm-Runden fuer die nahtlose Schleife (c): die erste Runde fuellt den Filterzustand,
// die zweite wird behalten.
const AUFWAERM_RUNDEN = 2;

const REPO_WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Zielablage: derselbe Pfad, den die Dial-Direktive als URL ausliefert (EINE Quelle - der Test
// vergleicht ihn gegen config.server.publicDir).
export const BEGRUESSUNGSLAUT_DATEIPFAD = path.join(REPO_WURZEL, "public", EL_BEGRUESSUNGSLAUT_PFAD);

// Rahmenzahl einer Dauer bei der Rezept-Abtastrate.
function rahmenAnzahl(dauerMs) {
  return Math.round((dauerMs * BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) / MS_PER_SECOND);
}

/** Deterministischer Rausch-Ring fester Laenge in [-1, 1). Rein: gleicher Seed -> gleiche Werte. */
function rauschRing(seed, rahmen) {
  let zustand = seed >>> 0 || 1;
  const naechsterWert = () => {
    zustand ^= zustand << XORSHIFT_LINKS_A;
    zustand ^= zustand >>> XORSHIFT_RECHTS;
    zustand ^= zustand << XORSHIFT_LINKS_B;
    zustand >>>= 0;
    return zustand;
  };
  return Array.from({ length: rahmen }, () => (naechsterWert() / UINT32_MAX) * SPANNE_MITTE - 1);
}

// Einpol-Tiefpass: y += a*(x-y). Jeder Aufruf liefert eine FRISCHE Stufe mit eigenem Zustand -
// so kann eine Kaskade aus mehreren gleichartigen Stufen bestehen (bett.tiefpassStufen).
function tiefpassStufe(grenzHz, abtastrateHz) {
  const alpha = 1 - Math.exp((-VOLLER_KREIS_RAD * grenzHz) / abtastrateHz);
  let zustand = 0;
  return (eingabe) => {
    zustand += alpha * (eingabe - zustand);
    return zustand;
  };
}

// Einpol-Hochpass: y = a*(y + x - xPrev).
function hochpassStufe(grenzHz, abtastrateHz) {
  const zeitKonstante = 1 / (VOLLER_KREIS_RAD * grenzHz);
  const abtastSchritt = 1 / abtastrateHz;
  const alpha = zeitKonstante / (zeitKonstante + abtastSchritt);
  let zustand = 0;
  let vorherigeEingabe = 0;
  return (eingabe) => {
    zustand = alpha * (zustand + eingabe - vorherigeEingabe);
    vorherigeEingabe = eingabe;
    return zustand;
  };
}

// Filterkaskade ueber einen RING: zwei Runden je Stufenkette, behalten wird die zweite. Die
// erste Runde waermt den Zustand, damit der Ausgang exakt periodisch ist (nahtlose Schleife).
function kaskadeUeberRing({ werte, stufen, stufeBauen }) {
  const kette = Array.from({ length: stufen }, stufeBauen);
  const durchKetteSchicken = (wert) => kette.reduce((zwischenwert, stufe) => stufe(zwischenwert), wert);
  let ausgabe = werte;
  for (let runde = 0; runde < AUFWAERM_RUNDEN; runde += 1) {
    ausgabe = werte.map(durchKetteSchicken);
  }
  return ausgabe;
}

// Skaliert auf einen Spitzenpegel. Macht den Rezept-Wert "spitzenpegel" woertlich wahr - der
// Test prueft genau ihn am fertigen WAV.
function aufSpitzenpegel(werte, spitzenpegel) {
  const spitze = werte.reduce((groesster, wert) => Math.max(groesster, Math.abs(wert)), 0) || 1;
  return werte.map((wert) => (wert / spitze) * spitzenpegel);
}

// Raised-Cosine-Huelle: weicher Ein- UND Ausklang ohne Knick, ein einzelner Hoecker ueber die
// gesamte Dauer. DIE Stelle, an der "kein harter Einsatz" entsteht.
function raisedCosineHuelle(index, gesamtRahmen) {
  return (1 - Math.cos((VOLLER_KREIS_RAD * index) / (gesamtRahmen - 1))) / HALBKREISE_PRO_VOLLKREIS;
}

/** Das durchgehende Rauschbett, nahtlos schleifenfaehig (a, c). */
function bettRahmen() {
  const { seed, tiefpassHz, tiefpassStufen, hochpassHz, hochpassStufen, spitzenpegel } = BEGRUESSUNGSLAUT_REZEPT.bett;
  const rahmen = rahmenAnzahl(BEGRUESSUNGSLAUT_REZEPT.dauerMs);
  const roh = rauschRing(seed, rahmen);
  const tiefpassGefiltert = kaskadeUeberRing({
    werte: roh,
    stufen: tiefpassStufen,
    stufeBauen: () => tiefpassStufe(tiefpassHz, BEGRUESSUNGSLAUT_REZEPT.abtastrateHz),
  });
  const bandpassGefiltert = kaskadeUeberRing({
    werte: tiefpassGefiltert,
    stufen: hochpassStufen,
    stufeBauen: () => hochpassStufe(hochpassHz, BEGRUESSUNGSLAUT_REZEPT.abtastrateHz),
  });
  return aufSpitzenpegel(bandpassGefiltert, spitzenpegel);
}

/** Der einmalige Abhebe-Impuls, dumpf und beidseitig weich (d). */
function impulsRahmen() {
  const { seed, dauerMs, tiefpassHz, tiefpassStufen, spitzenpegel } = BEGRUESSUNGSLAUT_REZEPT.impuls;
  const rahmen = rahmenAnzahl(dauerMs);
  const roh = rauschRing(seed, rahmen);
  const gefiltert = kaskadeUeberRing({
    werte: roh,
    stufen: tiefpassStufen,
    stufeBauen: () => tiefpassStufe(tiefpassHz, BEGRUESSUNGSLAUT_REZEPT.abtastrateHz),
  });
  const skaliert = aufSpitzenpegel(gefiltert, spitzenpegel);
  return skaliert.map((wert, index) => wert * raisedCosineHuelle(index, rahmen));
}

// Int16-Spur: Impuls additiv auf den Anfang des Betts, dann geklemmt.
function spurRahmen() {
  const bett = bettRahmen();
  const impuls = impulsRahmen();
  return bett.map((wert, index) => {
    const kombiniert = wert + (impuls[index] ?? 0);
    const skaliert = Math.round(kombiniert * INT16_MAX);
    return Math.max(INT16_MIN, Math.min(INT16_MAX, skaliert));
  });
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
  const daten = pcmDaten(spurRahmen());
  return Buffer.concat([wavKopf(daten.length), daten]);
}

// EINZIGES IO des Skripts.
function schreibeBegruessungslaut() {
  writeFileSync(BEGRUESSUNGSLAUT_DATEIPFAD, rendereBegruessungslautWav());
  console.log(`geschrieben: ${BEGRUESSUNGSLAUT_DATEIPFAD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) schreibeBegruessungslaut();
