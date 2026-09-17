// ---- IEP-P2/P2b: der Begruessungslaut als Datei, als Rezept und als ausgelieferte URL --------
// Das committete WAV ist kein Blindgaenger: es entsteht byte-genau aus dem Rezept in
// scripts/render-begruessungslaut.mjs, ist unauffaelliges Komfortrauschen (kein Ton), liegt an
// genau dem Pfad, den die Dial-Direktive als URL ausliefert, und haelt objektive Klangschranken
// (IEP-P2b, Owner-Befund 2026-09-17: der alte Sinus-Zweiklang war hoch, piepsig, tat weh).
// Namen beginnen mit "IEP-P2-A<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BEGRUESSUNGSLAUT_DATEIPFAD,
  BEGRUESSUNGSLAUT_REZEPT,
  rendereBegruessungslautWav,
} from "../scripts/render-begruessungslaut.mjs";
import { leseWav, huellkurve, bandAnteil, spitzenBin } from "../scripts/iel-mess-audio.mjs";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "../src/elevenlabs/inbound-rueckfall.js";
import { config } from "../src/config.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { BASE_ENV, ROOT, startServer } from "./helpers.js";

const HTTP_OK = 200;
const BITS_PRO_BYTE = 8;
const PCM_FORMAT_TAG = 1;
const FMT_CHUNK_BYTES = 16;
const RIFF_KOPF_BYTES = 44;
const RIFF_GROESSE_VORLAUF_BYTES = 8;
const RIFF_KENNUNG_BYTES = 4; // "RIFF", "WAVE", "fmt ", "data"
const UINT16_BYTES = 2;
const UINT32_BYTES = 4;
const BYTES_PRO_RAHMEN = (BEGRUESSUNGSLAUT_REZEPT.bitTiefe / BITS_PRO_BYTE) * BEGRUESSUNGSLAUT_REZEPT.kanaele;

// Spaetestes Ende des EL-Annahmefensters (0,7-0,9 s). Die Schleifenperiode des Betts muss
// laenger sein, sonst faengt Telnyx' Ringback-Wiederholung eine Kadenz an.
const EL_ANNAHME_FENSTER_MAX_MS = 900;

function dateiBytes() {
  return fs.readFileSync(BEGRUESSUNGSLAUT_DATEIPFAD);
}

// Sequenzieller RIFF-Leser, spiegelbildlich zum Schreiber im Skript - so steht auch hier keine
// nackte Byte-Position im Code.
function liesWavKopf(puffer) {
  let pos = 0;
  const text = (laenge) => {
    const wert = puffer.toString("ascii", pos, pos + laenge);
    pos += laenge;
    return wert;
  };
  const uint16 = () => {
    const wert = puffer.readUInt16LE(pos);
    pos += UINT16_BYTES;
    return wert;
  };
  const uint32 = () => {
    const wert = puffer.readUInt32LE(pos);
    pos += UINT32_BYTES;
    return wert;
  };
  return {
    riff: text(RIFF_KENNUNG_BYTES),
    riffGroesse: uint32(),
    wave: text(RIFF_KENNUNG_BYTES),
    fmtKennung: text(RIFF_KENNUNG_BYTES),
    fmtGroesse: uint32(),
    formatTag: uint16(),
    kanaele: uint16(),
    abtastrateHz: uint32(),
    byteRate: uint32(),
    blockAusrichtung: uint16(),
    bitTiefe: uint16(),
    dataKennung: text(RIFF_KENNUNG_BYTES),
    datenBytes: uint32(),
  };
}

test("IEP-P2-A1: das committete Asset ist byte-identisch zur Ausgabe des Rezepts", () => {
  assert.ok(rendereBegruessungslautWav().equals(dateiBytes()), "node scripts/render-begruessungslaut.mjs erneut laufen lassen");
});

test("IEP-P2-A2: kanonischer WAV-Kopf, Laenge folgt dem Rezept", () => {
  const puffer = dateiBytes();
  const kopf = liesWavKopf(puffer);
  assert.equal(kopf.riff, "RIFF");
  assert.equal(kopf.wave, "WAVE");
  assert.equal(kopf.fmtKennung, "fmt ");
  assert.equal(kopf.dataKennung, "data");
  assert.equal(kopf.fmtGroesse, FMT_CHUNK_BYTES);
  assert.equal(kopf.formatTag, PCM_FORMAT_TAG);
  assert.equal(kopf.kanaele, BEGRUESSUNGSLAUT_REZEPT.kanaele);
  assert.equal(kopf.abtastrateHz, BEGRUESSUNGSLAUT_REZEPT.abtastrateHz);
  assert.equal(kopf.bitTiefe, BEGRUESSUNGSLAUT_REZEPT.bitTiefe);
  assert.equal(kopf.blockAusrichtung, BYTES_PRO_RAHMEN);
  assert.equal(kopf.byteRate, BEGRUESSUNGSLAUT_REZEPT.abtastrateHz * BYTES_PRO_RAHMEN);

  const gesamtMs = BEGRUESSUNGSLAUT_REZEPT.dauerMs;
  const erwarteteRahmen = (gesamtMs * BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) / MS_PER_SECOND;
  assert.equal(kopf.datenBytes, erwarteteRahmen * BYTES_PRO_RAHMEN);
  assert.equal(puffer.length, RIFF_KOPF_BYTES + kopf.datenBytes);
  assert.equal(kopf.riffGroesse, puffer.length - RIFF_GROESSE_VORLAUF_BYTES);
});

// Alter Bauplan (IEP-P2, vor dem Owner-Befund): Sinus-Zweiklang + Nachlauf-Stille. Dient A3 und
// A7 als Positiv-Kontrolle (Lehre pruefkommando-ohne-positiv-kontrolle) - ohne sie waere "die
// neuen Schranken finden nichts" nicht von "die Schranken pruefen gar nichts" zu unterscheiden.
const ALT_SPITZENPEGEL = 0.28;
const ALT_TOENE = Object.freeze([
  Object.freeze({ hz: 587.33, dauerMs: 190, einblendeMs: 12, ausblendeMs: 40 }),
  Object.freeze({ hz: 880.0, dauerMs: 510, einblendeMs: 12, ausblendeMs: 510 }),
]);
const ALT_NACHLAUF_STILLE_MS = 1800;
const INT16_MAX = 32767;
const HALBKREISE_PRO_VOLLKREIS = 2;
const VOLLER_KREIS_RAD = HALBKREISE_PRO_VOLLKREIS * Math.PI;

function altHuellkurvenFaktor({ rahmen, gesamtRahmen, einblendeRahmen, ausblendeRahmen }) {
  const einblende = einblendeRahmen > 0 ? Math.min(1, rahmen / einblendeRahmen) : 1;
  const ausblende = ausblendeRahmen > 0 ? Math.min(1, (gesamtRahmen - rahmen) / ausblendeRahmen) : 1;
  return Math.min(einblende, ausblende);
}

function altRahmenAnzahl(dauerMs) {
  return Math.round((dauerMs * BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) / MS_PER_SECOND);
}

function altTonRahmen(ton) {
  const gesamtRahmen = altRahmenAnzahl(ton.dauerMs);
  const einblendeRahmen = altRahmenAnzahl(ton.einblendeMs);
  const ausblendeRahmen = altRahmenAnzahl(ton.ausblendeMs);
  const werte = [];
  for (let rahmen = 0; rahmen < gesamtRahmen; rahmen += 1) {
    const schwingung = Math.sin((VOLLER_KREIS_RAD * ton.hz * rahmen) / BEGRUESSUNGSLAUT_REZEPT.abtastrateHz);
    const faktor = altHuellkurvenFaktor({ rahmen, gesamtRahmen, einblendeRahmen, ausblendeRahmen });
    werte.push(Math.round(ALT_SPITZENPEGEL * faktor * schwingung * INT16_MAX));
  }
  return werte;
}

// Proben des alten Bauplans als Float32 in [-1, 1], wie leseWav sie fuer PCM16 liefern wuerde.
function altBauplanProben() {
  const rahmen = [...ALT_TOENE.flatMap(altTonRahmen), ...new Array(altRahmenAnzahl(ALT_NACHLAUF_STILLE_MS)).fill(0)];
  return Float32Array.from(rahmen, (wert) => wert / (INT16_MAX + 1));
}

test("IEP-P2-A3: keine Kadenz - das Bett traegt luecken- und pausenlos, der Abhebe-Impuls wiederholt sich nicht im EL-Annahmefenster", () => {
  const { abtastrate, kanaele } = leseWav(dateiBytes());
  const proben = kanaele[0];
  const huellkurveWerte = huellkurve({ proben, abtastrate });
  assert.ok(Math.min(...huellkurveWerte) > 0, "kein einziges stilles Fenster - eine Kadenz braucht Pausen");

  // Positiv-Kontrolle: der ALTE Bauplan (Ton + Nachlauf-Stille) faellt hier durch.
  const huellkurveAlt = huellkurve({ proben: altBauplanProben(), abtastrate: BEGRUESSUNGSLAUT_REZEPT.abtastrateHz });
  assert.equal(Math.min(...huellkurveAlt), 0, "der alte Bauplan hat Stille-Fenster im Nachlauf");

  assert.ok(
    BEGRUESSUNGSLAUT_REZEPT.dauerMs > EL_ANNAHME_FENSTER_MAX_MS,
    "die Schleifenperiode muss das EL-Annahmefenster ueberdauern",
  );
});

test("IEP-P2-A4: das Asset liegt an genau dem Pfad, den die Dial-Direktive ausliefert", () => {
  assert.equal(BEGRUESSUNGSLAUT_DATEIPFAD, path.join(config.server.publicDir, EL_BEGRUESSUNGSLAUT_PFAD));
  assert.ok(fs.existsSync(BEGRUESSUNGSLAUT_DATEIPFAD));
});

test("IEP-P2-A5: der bestehende public-Mount liefert das Asset ohne jede Auth aus", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}${EL_BEGRUESSUNGSLAUT_PFAD}`);
    assert.equal(res.status, HTTP_OK);
    // Am laufenden Server gemessen: express.static leitet den Typ aus der Endung ab.
    assert.equal(res.headers.get("content-type"), "audio/wav");
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(dateiBytes()));
  } finally {
    await srv.stop();
  }
});

test("IEP-P2-A6: ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED steht kohaerent in config.js, .env.example, render.yaml, BASE_ENV", () => {
  const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), "utf8");
  const configJs = lies("src/config.js");
  const envExample = lies(".env.example");
  const renderYaml = lies("render.yaml");
  const SCHLUESSEL = "ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED";

  // Positiv-Kontrolle (Muster IEX-A9-9): ein bekannt vorhandener Schluessel mit value-Default.
  assert.ok(configJs.includes("process.env.ELEVENLABS_INBOUND_SCOPE"));

  assert.ok(configJs.includes(`process.env.${SCHLUESSEL}`));
  assert.match(envExample, new RegExp(`^${SCHLUESSEL}=true\\s*$`, "m"));
  assert.match(renderYaml, new RegExp(`key:\\s*${SCHLUESSEL}\\s*\\n\\s*value:\\s*"true"`));
  assert.equal(BASE_ENV[SCHLUESSEL], "");
});

// IEP-P2b: objektive Klangschranken. Jede Schranke traegt die Zahl, an der der ALTE (piepsige)
// Laut durchfaellt - so kann kein kuenftiger Rezept-Dreh unbemerkt wieder zu einem Ton werden.
const SPITZENPEGEL_MIN_DBFS = -45;
const SPITZENPEGEL_MAX_DBFS = -38;
const HUELLKURVEN_SPANNE_MAX_DB = 20; // kein harter Einsatz, keine Kadenz
const GROESSTE_FLANKE_MAX = 400; // weiche Flanken, kein Sample-Sprung wie bei einem Sinus-Einsatz
const SPITZENBIN_ANTEIL_MAX = 0.15; // kein Einzelton-Peak
const SPITZENBIN_HZ_GRENZE = 1000; // keine tonale Energie oberhalb 1 kHz
const BAND_UEBER_1KHZ_MAX = 0.06; // nicht zischend bei Schmalband (PCMU)
const DBFS_NACHKOMMA = 2; // Rundung fuer Fehlermeldungen, keine Rechengroesse
const ANTEIL_NACHKOMMA = 4; // Rundung fuer Fehlermeldungen, keine Rechengroesse

const DBFS_JE_DEKADE = 20;

function dbfs(linear) {
  return DBFS_JE_DEKADE * Math.log10(linear);
}

function spitzenpegelDbfs(proben) {
  const spitze = proben.reduce((groesster, wert) => Math.max(groesster, Math.abs(wert)), 0);
  return dbfs(spitze);
}

function huellkurvenSpanneDb(huellkurveWerte) {
  const positiv = Array.from(huellkurveWerte).filter((wert) => wert > 0);
  return dbfs(Math.max(...huellkurveWerte) / Math.min(...positiv));
}

// Groesste Sample-zu-Sample-Flanke auf der Int16-Skala - die Messform von "harter Einsatz".
function groessteFlanke(proben) {
  let groesste = 0;
  for (let i = 1; i < proben.length; i += 1) {
    const delta = Math.abs(Math.round(proben[i] * INT16_MAX) - Math.round(proben[i - 1] * INT16_MAX));
    if (delta > groesste) groesste = delta;
  }
  return groesste;
}

function klangSchrankenHalten({ proben, abtastrate }) {
  const huellkurveWerte = huellkurve({ proben, abtastrate });
  const bin = spitzenBin({ proben, abtastrate });
  return {
    spitzenpegelDbfs: spitzenpegelDbfs(proben),
    huellkurvenSpanneDb: huellkurvenSpanneDb(huellkurveWerte),
    groessteFlanke: groessteFlanke(proben),
    spitzenBinAnteil: bin.anteil,
    spitzenBinHz: bin.hz,
    bandUeber1kHz: bandAnteil({ proben, abtastrate, grenzHz: SPITZENBIN_HZ_GRENZE }),
  };
}

test("IEP-P2-A7: der Laut haelt objektive Klangschranken - der alte piepsige Laut faellt an ihnen durch", () => {
  const { abtastrate, kanaele } = leseWav(dateiBytes());
  const neu = klangSchrankenHalten({ proben: kanaele[0], abtastrate });
  const alt = klangSchrankenHalten({ proben: altBauplanProben(), abtastrate: BEGRUESSUNGSLAUT_REZEPT.abtastrateHz });

  assert.ok(
    neu.spitzenpegelDbfs >= SPITZENPEGEL_MIN_DBFS && neu.spitzenpegelDbfs <= SPITZENPEGEL_MAX_DBFS,
    `Spitzenpegel ${neu.spitzenpegelDbfs.toFixed(DBFS_NACHKOMMA)} dBFS ausserhalb [${SPITZENPEGEL_MIN_DBFS}, ${SPITZENPEGEL_MAX_DBFS}]`,
  );
  assert.ok(neu.huellkurvenSpanneDb <= HUELLKURVEN_SPANNE_MAX_DB, `Huellkurven-Spanne ${neu.huellkurvenSpanneDb.toFixed(DBFS_NACHKOMMA)} dB > ${HUELLKURVEN_SPANNE_MAX_DB}`);
  assert.ok(neu.groessteFlanke <= GROESSTE_FLANKE_MAX, `groesste Flanke ${neu.groessteFlanke} > ${GROESSTE_FLANKE_MAX}`);
  assert.ok(neu.spitzenBinAnteil <= SPITZENBIN_ANTEIL_MAX, `spitzenBin.anteil ${neu.spitzenBinAnteil.toFixed(ANTEIL_NACHKOMMA)} > ${SPITZENBIN_ANTEIL_MAX}`);
  assert.ok(neu.spitzenBinHz < SPITZENBIN_HZ_GRENZE, `spitzenBin.hz ${neu.spitzenBinHz} >= ${SPITZENBIN_HZ_GRENZE}`);
  assert.ok(neu.bandUeber1kHz <= BAND_UEBER_1KHZ_MAX, `Bandanteil oberhalb 1 kHz ${neu.bandUeber1kHz.toFixed(ANTEIL_NACHKOMMA)} > ${BAND_UEBER_1KHZ_MAX}`);

  // Positiv-Kontrolle: der alte Sinus-Zweiklang faellt an vier der sechs Schranken durch.
  assert.ok(alt.spitzenpegelDbfs > SPITZENPEGEL_MAX_DBFS, "ALT haette zu laut sein muessen (Regression sonst unsichtbar)");
  assert.ok(alt.huellkurvenSpanneDb > HUELLKURVEN_SPANNE_MAX_DB, "ALT haette einen harten Einsatz haben muessen");
  assert.ok(alt.groessteFlanke > GROESSTE_FLANKE_MAX, "ALT haette eine harte Flanke haben muessen");
  assert.ok(alt.spitzenBinAnteil > SPITZENBIN_ANTEIL_MAX, "ALT haette ein Einzelton-Peak haben muessen");
});

test("IEP-P2-A8: der Schleifenpunkt ist keine Unstetigkeit", () => {
  const proben = leseWav(dateiBytes()).kanaele[0];
  const innenFlanken = [];
  for (let i = 1; i < proben.length; i += 1) {
    innenFlanken.push(Math.abs(Math.round(proben[i] * INT16_MAX) - Math.round(proben[i - 1] * INT16_MAX)));
  }
  const nahtFlanke = Math.abs(Math.round(proben[0] * INT16_MAX) - Math.round(proben[proben.length - 1] * INT16_MAX));

  const sortiert = Float64Array.from(innenFlanken).sort();
  const PERZENTIL_99 = 99;
  const PROZENT = 100;
  const p99 = sortiert[Math.min(sortiert.length - 1, Math.floor((sortiert.length * PERZENTIL_99) / PROZENT))];

  // Telnyx wiederholt die audioUrl. Waere das letzte Sample vom ersten weiter entfernt als die
  // Flanken im Inneren, knackte es bei jeder Wiederholung.
  assert.ok(nahtFlanke <= p99, `Naht-Flanke ${nahtFlanke} > p99 der Innenflanken ${p99}`);
});

// PCMU-Encoder (ITU-T G.711 mu-law, Referenzalgorithmus) - NUR ein Messinstrument fuer die
// Gegenprobe A9, keine neue Produktions-Dependency. leseWav dekodiert mu-law bereits.
const MULAW_ENC_MAX = 0x1fff;
const MULAW_ENC_BIAS = 0x84;
const MULAW_ENC_SIGN_BIT = 0x80;
const MULAW_ENC_SIGN_SCHIEBUNG = 8;
const MULAW_ENC_EXPONENT_START = 7;
const MULAW_ENC_EXPONENT_MASKE_START = 0x4000;
const MULAW_ENC_MANTISSE_SCHIEBUNG = 3;
const MULAW_ENC_MANTISSE_MASKE = 0x0f;
const MULAW_ENC_EXPONENT_SCHIEBUNG = 4;
const BYTE_MASKE = 0xff;

function linearZuMulaw(sampleInt16) {
  let sample = sampleInt16;
  const vorzeichen = (sample >> MULAW_ENC_SIGN_SCHIEBUNG) & MULAW_ENC_SIGN_BIT;
  if (vorzeichen !== 0) sample = -sample;
  sample = Math.min(sample, MULAW_ENC_MAX) + MULAW_ENC_BIAS;
  let exponent = MULAW_ENC_EXPONENT_START;
  for (let maske = MULAW_ENC_EXPONENT_MASKE_START; (sample & maske) === 0 && exponent > 0; exponent -= 1, maske >>= 1);
  const mantisse = (sample >> (exponent + MULAW_ENC_MANTISSE_SCHIEBUNG)) & MULAW_ENC_MANTISSE_MASKE;
  return ~(vorzeichen | (exponent << MULAW_ENC_EXPONENT_SCHIEBUNG) | mantisse) & BYTE_MASKE;
}

const MULAW_FORMAT_CODE = 7;
const MULAW_BITS = 8;
const MULAW_BYTES_PRO_RAHMEN = 1;

function alsMulawWav(proben, abtastrate) {
  const puffer = Buffer.alloc(RIFF_KOPF_BYTES + proben.length);
  let pos = 0;
  const text = (zeichen) => {
    puffer.write(zeichen, pos, "ascii");
    pos += zeichen.length;
  };
  const uint16 = (wert) => {
    puffer.writeUInt16LE(wert, pos);
    pos += UINT16_BYTES;
  };
  const uint32 = (wert) => {
    puffer.writeUInt32LE(wert, pos);
    pos += UINT32_BYTES;
  };
  text("RIFF");
  uint32(RIFF_KOPF_BYTES - RIFF_GROESSE_VORLAUF_BYTES + proben.length);
  text("WAVE");
  text("fmt ");
  uint32(FMT_CHUNK_BYTES);
  uint16(MULAW_FORMAT_CODE);
  uint16(1);
  uint32(abtastrate);
  uint32(abtastrate * MULAW_BYTES_PRO_RAHMEN);
  uint16(MULAW_BYTES_PRO_RAHMEN);
  uint16(MULAW_BITS);
  text("data");
  uint32(proben.length);
  for (let i = 0; i < proben.length; i += 1) {
    const int16 = Math.max(-INT16_MAX - 1, Math.min(INT16_MAX, Math.round(proben[i] * INT16_MAX)));
    puffer.writeUInt8(linearZuMulaw(int16), RIFF_KOPF_BYTES + i);
  }
  return puffer;
}

test("IEP-P2-A9: nach PCMU-Rundlauf (Schmalband 8 kHz) halten alle Klangschranken", () => {
  const { abtastrate, kanaele } = leseWav(dateiBytes());
  const mulawPuffer = alsMulawWav(kanaele[0], abtastrate);
  const rundlauf = leseWav(mulawPuffer);
  const gemessen = klangSchrankenHalten({ proben: rundlauf.kanaele[0], abtastrate: rundlauf.abtastrate });

  assert.ok(gemessen.spitzenpegelDbfs >= SPITZENPEGEL_MIN_DBFS && gemessen.spitzenpegelDbfs <= SPITZENPEGEL_MAX_DBFS);
  assert.ok(gemessen.huellkurvenSpanneDb <= HUELLKURVEN_SPANNE_MAX_DB);
  assert.ok(gemessen.groessteFlanke <= GROESSTE_FLANKE_MAX);
  assert.ok(gemessen.spitzenBinAnteil <= SPITZENBIN_ANTEIL_MAX);
  assert.ok(gemessen.bandUeber1kHz <= BAND_UEBER_1KHZ_MAX, `PCMU-Rundlauf zischt: ${gemessen.bandUeber1kHz.toFixed(ANTEIL_NACHKOMMA)}`);
});
