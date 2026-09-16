// IEP-P1 Positiv-Kontrolle des Auswerters: bekannter Fremdton, bekannte Stille.
//
// WARUM DIESER TEST DER WICHTIGE IST: ein blinder Auswerter liefert ueberall 0 und sieht aus
// wie ein stiller, sauberer Anruf. Nur ein Mitschnitt, in dem wir GENAU wissen, wo Ton und
// wo Stille liegt, kann das aufdecken. Jede Attrappe wird hier deterministisch erzeugt -
// kein Netz, keine Uhr, kein Zufall (P12).

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { FENSTER_MS, WavFehler, bandAnteil, leseWav } from "../scripts/iel-mess-audio.mjs";
import {
  KLANG_GRENZE_HZ,
  fremdeTonEreignisse,
  ohrzeugeAudioSicht,
  ohrzeugeKennzahlen,
  sprechspurKommandoId,
} from "../scripts/iel-mess-ohrzeuge.mjs";

// --- WAV-Attrappen -------------------------------------------------------------------------

const WAV_KOPF_BYTES = 44;
const FMT_CHUNK_BYTES = 16;
// "RIFF" + Groessenfeld stehen VOR dem Feld, das die Restgroesse angibt.
const RIFF_TAG_UND_GROESSE_BYTES = 8;
const RIFF_RUMPF_OHNE_KOPF = WAV_KOPF_BYTES - RIFF_TAG_UND_GROESSE_BYTES;
const BITS_JE_BYTE = 8;
const PCM16_BITS = 16;
const PCM16_MAX = 32767;
const FORMAT_PCM = 1;
const FORMAT_ALAW = 6;
const FORMAT_MULAW = 7;
const FORMAT_FLOAT = 3;
const MONO = 1;
const MS_JE_S = 1000;
const VOLLER_KREIS = Math.PI + Math.PI;
// Ein LCG liefert 0..1; die Spanne -1..+1 entsteht durch Strecken und Verschieben.
const SPANNE = 2;

// Offsets des kanonischen 44-Byte-RIFF/WAVE-Kopfes.
const OFFSET = Object.freeze({
  riff: 0, groesse: 4, wave: 8, fmtTag: 12, fmtLaenge: 16, formatCode: 20,
  kanaele: 22, abtastrate: 24, byteRate: 28, blockAusrichtung: 32, bits: 34,
  dataTag: 36, datenLaenge: 40,
});

function wavKopf({ abtastrate, kanaele, bits, formatCode, datenBytes }) {
  const kopf = Buffer.alloc(WAV_KOPF_BYTES);
  const blockBytes = kanaele * (bits / BITS_JE_BYTE);
  kopf.write("RIFF", OFFSET.riff);
  kopf.writeUInt32LE(RIFF_RUMPF_OHNE_KOPF + datenBytes, OFFSET.groesse);
  kopf.write("WAVE", OFFSET.wave);
  kopf.write("fmt ", OFFSET.fmtTag);
  kopf.writeUInt32LE(FMT_CHUNK_BYTES, OFFSET.fmtLaenge);
  kopf.writeUInt16LE(formatCode, OFFSET.formatCode);
  kopf.writeUInt16LE(kanaele, OFFSET.kanaele);
  kopf.writeUInt32LE(abtastrate, OFFSET.abtastrate);
  kopf.writeUInt32LE(abtastrate * blockBytes, OFFSET.byteRate);
  kopf.writeUInt16LE(blockBytes, OFFSET.blockAusrichtung);
  kopf.writeUInt16LE(bits, OFFSET.bits);
  kopf.write("data", OFFSET.dataTag);
  kopf.writeUInt32LE(datenBytes, OFFSET.datenLaenge);
  return kopf;
}

function baueWavPcm16({ abtastrate, spuren, formatCode = FORMAT_PCM }) {
  const rahmen = spuren[0].length;
  const daten = Buffer.alloc(rahmen * spuren.length * (PCM16_BITS / BITS_JE_BYTE));
  for (let rahmenNr = 0; rahmenNr < rahmen; rahmenNr += 1) {
    for (let kanal = 0; kanal < spuren.length; kanal += 1) {
      const wert = Math.max(-1, Math.min(1, spuren[kanal][rahmenNr]));
      daten.writeInt16LE(Math.round(wert * PCM16_MAX), (rahmenNr * spuren.length + kanal) * (PCM16_BITS / BITS_JE_BYTE));
    }
  }
  const kopf = wavKopf({ abtastrate, kanaele: spuren.length, bits: PCM16_BITS, formatCode, datenBytes: daten.length });
  return Buffer.concat([kopf, daten]);
}

function baueWavG711({ abtastrate, bytes, formatCode }) {
  const daten = Buffer.from(bytes);
  const kopf = wavKopf({ abtastrate, kanaele: MONO, bits: BITS_JE_BYTE, formatCode, datenBytes: daten.length });
  return Buffer.concat([kopf, daten]);
}

// --- Signal-Bausteine ----------------------------------------------------------------------

const ABTASTRATE = 16000;
const SCHMALBAND_ABTASTRATE = 8000;
const TON_AMPLITUDE = 0.5;
const RAUSCH_AMPLITUDE = 0.3;

function probenAnzahl(ms, abtastrate) {
  return Math.round((ms * abtastrate) / MS_JE_S);
}

// EINE Stelle, die Proben erzeugt - Stille, Ton und Rauschen unterscheiden sich nur in der
// Funktion, die den Wert je Index liefert (G5).
function proben({ ms, abtastrate, wertFuer }) {
  const werte = new Array(probenAnzahl(ms, abtastrate));
  for (let i = 0; i < werte.length; i += 1) werte[i] = wertFuer(i);
  return werte;
}

function stille(ms, abtastrate = ABTASTRATE) {
  return proben({ ms, abtastrate, wertFuer: () => 0 });
}

function ton(ms, frequenzen, abtastrate = ABTASTRATE) {
  const amplitude = TON_AMPLITUDE / frequenzen.length;
  const wertFuer = (index) => frequenzen.reduce((summe, hz) => summe + amplitude * Math.sin((VOLLER_KREIS * hz * index) / abtastrate), 0);
  return proben({ ms, abtastrate, wertFuer });
}

// Deterministisches Sprachrauschen (LCG statt Math.random - der Test muss wiederholbar sein).
const LCG_A = 1664525;
const LCG_C = 1013904223;
const LCG_M = 4294967296;

function rauschen(ms, saat, abtastrate = ABTASTRATE) {
  let zustand = saat;
  const wertFuer = () => {
    zustand = (LCG_A * zustand + LCG_C) % LCG_M;
    return ((zustand / LCG_M) * SPANNE - 1) * RAUSCH_AMPLITUDE;
  };
  return proben({ ms, abtastrate, wertFuer });
}

// --- Der Mitschnitt, dessen Inhalt wir GENAU kennen ------------------------------------------
//
// Kanal B (Gegenseite):  0-1200 Stille | 1200-1600 Doppelton 440/480 (FREMDTON)
//                        1600-2500 Stille (900 ms) | 2500-3500 Sprache
//                        3500-4300 Stille (800 ms) | 4300-5300 Sprache
// Kanal A (unser Bein):  0-3800 Stille | 3800-4200 Sprechspur | 4200-5300 Stille
//
// Die Annahme des gewaehlten Beins liegt bei 1600 ms im Mitschnitt: alles davor kann der
// Agent nicht gesprochen haben - genau das trennt Kennzahl (ii) von Kennzahl (iv).

// Laengen der Attrappe in Millisekunden. Die Grenzen liegen auf dem 20-ms-Raster der
// Huellkurve, damit die erwarteten Zahlen exakt und nicht "ungefaehr" sind.
const AGENT_VORLAUF_STILLE_MS = 1200;
const FREMDTON_DAUER_MS = 400;
const STILLE_NACH_FREMDTON_MS = 900;
const AGENT_TURN_MS = 1000;
const STILLE_ZWISCHEN_TURNS_MS = 800;
const ANRUFER_VORLAUF_STILLE_MS = 3800;
const SPRECHSPUR_DAUER_MS = 400;
const ANRUFER_NACHLAUF_STILLE_MS = 1100;
// Nordamerikanischer Rufton: zwei Sinuskomponenten, beide weit unter der Bandgrenze.
const KLINGELTON_TIEF_HZ = 440;
const KLINGELTON_HOCH_HZ = 480;
const KLINGELTON_HZ = Object.freeze([KLINGELTON_TIEF_HZ, KLINGELTON_HOCH_HZ]);
const SCHMALBAND_STILLE_MS = 1000;
const SCHMALBAND_SPRACHE_MS = 1000;

const ANNAHME_VERSATZ_MS = AGENT_VORLAUF_STILLE_MS + FREMDTON_DAUER_MS;
const FREMDTON_START_MS = AGENT_VORLAUF_STILLE_MS;
const ERWARTETE_ERSTE_SILBE_MS = STILLE_NACH_FREMDTON_MS;
const ERWARTETE_LAENGSTE_STILLE_MS = STILLE_NACH_FREMDTON_MS;
const ERWARTETE_TURN_LUECKE_MS = 100;
const STILLE_TOLERANZ_MS = 20;
const ANNAHME_DAUER_MS = 2000;

// Saaten des LCG - verschiedene Werte, damit jeder Abschnitt anderes Rauschen traegt.
const SAAT = Object.freeze({ agentTurn1: 1, agentTurn2: 2, sprechspur: 3, schmalband: 4 });

const UNSER_BEIN = "leg-unser";
const GEWAEHLTES_BEIN = "leg-gewaehlt";
const LAUF_ID = "iel-oz-test";
const AUFNAHME_START_MS = Date.parse("2026-09-17T10:00:00.000Z");

function agentSpur({ mitFremdton }) {
  return [
    ...stille(AGENT_VORLAUF_STILLE_MS),
    ...(mitFremdton ? ton(FREMDTON_DAUER_MS, KLINGELTON_HZ) : stille(FREMDTON_DAUER_MS)),
    ...stille(STILLE_NACH_FREMDTON_MS),
    ...rauschen(AGENT_TURN_MS, SAAT.agentTurn1),
    ...stille(STILLE_ZWISCHEN_TURNS_MS),
    ...rauschen(AGENT_TURN_MS, SAAT.agentTurn2),
  ];
}

function anruferSpur() {
  return [
    ...stille(ANRUFER_VORLAUF_STILLE_MS),
    ...rauschen(SPRECHSPUR_DAUER_MS, SAAT.sprechspur),
    ...stille(ANRUFER_NACHLAUF_STILLE_MS),
  ];
}

// Der Schmalband-Fall prueft nur die Klangkennzahl; er braucht keine Turn-Struktur.
function schmalbandSpuren(abtastrate) {
  return [
    stille(SCHMALBAND_STILLE_MS + SCHMALBAND_SPRACHE_MS, abtastrate),
    [...stille(SCHMALBAND_STILLE_MS, abtastrate), ...rauschen(SCHMALBAND_SPRACHE_MS, SAAT.schmalband, abtastrate)],
  ];
}

function baueMitschnitt({ mitFremdton = true, abtastrate = ABTASTRATE } = {}) {
  const spuren = abtastrate === ABTASTRATE ? [anruferSpur(), agentSpur({ mitFremdton })] : schmalbandSpuren(abtastrate);
  return baueWavPcm16({ abtastrate, spuren });
}

function sitzungsEreignisse({ gestartetMs = AUFNAHME_START_MS } = {}) {
  const zeit = (versatzMs) => new Date(gestartetMs + versatzMs).toISOString();
  const ereignis = (bein, name, versatzMs) => ({ name, occurred_at: zeit(versatzMs), payload: { payload: { call_leg_id: bein } } });
  return [
    ereignis(UNSER_BEIN, "call.initiated", 0),
    ereignis(GEWAEHLTES_BEIN, "call.initiated", ANNAHME_VERSATZ_MS - ANNAHME_DAUER_MS),
    ereignis(GEWAEHLTES_BEIN, "call.answered", ANNAHME_VERSATZ_MS),
  ];
}

function kennzahlenFuer({ bytes, ereignisse = sitzungsEreignisse(), gestartetMs = AUFNAHME_START_MS }) {
  const audio = bytes ? ohrzeugeAudioSicht(bytes) : null;
  return ohrzeugeKennzahlen({
    mitschnitt: { audio, grund: bytes ? undefined : "Mitschnitt nicht verfuegbar (keine_aufnahme)", gestartetMs },
    lauf: { ereignisse, laufId: LAUF_ID, unserBein: UNSER_BEIN },
  });
}

// --- Tests ------------------------------------------------------------------------------------

describe("IEP-P1 Auswerter: bekannter Fremdton und bekannte Stille", () => {
  it("findet den Fremdton vor der Annahme und beziffert alle sieben Kennzahlen", () => {
    const kennzahlen = kennzahlenFuer({ bytes: baueMitschnitt() });

    assert.equal(kennzahlen.annahme_ms, ANNAHME_DAUER_MS);
    assert.equal(kennzahlen.fremdton_vor_hermes.ja, true);
    assert.equal(kennzahlen.fremdton_vor_hermes.erster_ton_ms, FREMDTON_START_MS);
    // Jede Zeitangabe liegt auf dem 20-ms-Raster der Huellkurve, nie dazwischen.
    assert.equal(kennzahlen.fremdton_vor_hermes.erster_ton_ms % FENSTER_MS, 0);
    assert.equal(kennzahlen.erste_agenten_silbe_ms % FENSTER_MS, 0);
    assert.equal(kennzahlen.erste_agenten_silbe_ms, ERWARTETE_ERSTE_SILBE_MS);
    assert.ok(
      Math.abs(kennzahlen.laengste_stille_ms - ERWARTETE_LAENGSTE_STILLE_MS) <= STILLE_TOLERANZ_MS,
      `laengste_stille_ms=${kennzahlen.laengste_stille_ms}`,
    );
    assert.deepEqual(kennzahlen.turn_luecken_ms, [ERWARTETE_TURN_LUECKE_MS]);
    assert.equal(kennzahlen.klang.abtastrate, ABTASTRATE);
    assert.ok(kennzahlen.klang.band_anteil_oben >= 0 && kennzahlen.klang.band_anteil_oben <= 1);
    assert.ok(kennzahlen.klang.grundrauschen_dbfs < 0);
    assert.equal(kennzahlen.tonereignisse.ja, false);

    for (const [name, wert] of Object.entries(kennzahlen)) {
      assert.notEqual(wert?.messbar, false, `${name} ist unerwartet nicht messbar: ${wert?.grund}`);
    }
  });

  it("Gegenprobe: derselbe Mitschnitt OHNE Fremdton meldet ja=false - ein blinder Auswerter faellt hier durch", () => {
    const kennzahlen = kennzahlenFuer({ bytes: baueMitschnitt({ mitFremdton: false }) });
    assert.equal(kennzahlen.fremdton_vor_hermes.ja, false);
    assert.equal(kennzahlen.fremdton_vor_hermes.erster_ton_ms, null);
    // Die Positiv-Kontrolle desselben Laufs: die spaeteren Agenten-Silben werden weiter gefunden.
    assert.equal(kennzahlen.erste_agenten_silbe_ms, ERWARTETE_ERSTE_SILBE_MS);
  });

  it("fehlendes recording_started_at liefert einen GRUND, nie eine 0", () => {
    const kennzahlen = kennzahlenFuer({ bytes: baueMitschnitt(), gestartetMs: NaN });
    for (const feld of ["fremdton_vor_hermes", "erste_agenten_silbe_ms", "laengste_stille_ms"]) {
      assert.equal(kennzahlen[feld].messbar, false, feld);
      assert.match(kennzahlen[feld].grund, /recording_started_at/);
    }
    // Was ohne Zeitachse trotzdem messbar bleibt, bleibt beziffert.
    assert.equal(kennzahlen.annahme_ms, ANNAHME_DAUER_MS);
  });

  it("ohne Mitschnitt traegt jede Audio-Kennzahl ihren Grund", () => {
    const kennzahlen = kennzahlenFuer({ bytes: null });
    for (const feld of ["fremdton_vor_hermes", "erste_agenten_silbe_ms", "laengste_stille_ms", "turn_luecken_ms", "klang"]) {
      assert.equal(kennzahlen[feld].messbar, false, feld);
      assert.match(kennzahlen[feld].grund, /keine_aufnahme/);
    }
  });

  it("ohne gewaehltes Bein in den Ereignissen bleibt annahme_ms unbeziffert", () => {
    const nurUnseres = sitzungsEreignisse().filter((ereignis) => ereignis.payload.payload.call_leg_id === UNSER_BEIN);
    const kennzahlen = kennzahlenFuer({ bytes: baueMitschnitt(), ereignisse: nurUnseres });
    assert.equal(kennzahlen.annahme_ms.messbar, false);
    assert.match(kennzahlen.annahme_ms.grund, /kein gewaehltes Bein/);
  });

  it("Schmalband (8 kHz) macht die Klangkennzahl unmessbar statt falsch", () => {
    const kennzahlen = kennzahlenFuer({ bytes: baueMitschnitt({ abtastrate: SCHMALBAND_ABTASTRATE }) });
    assert.equal(kennzahlen.klang.messbar, false);
    assert.match(kennzahlen.klang.grund, /Abtastrate 8000 Hz/);
  });
});

const BAND_PROBE_MS = 500;
const HOHER_TON_HZ = 4000;
const TIEFER_TON_HZ = 300;
const ANTEIL_HOCH_MIN = 0.8;
const ANTEIL_TIEF_MAX = 0.05;
// Nyquist 3000 Hz - genau auf der Bandgrenze, also ohne messbares Band darueber.
const ABTASTRATE_OHNE_BAND = 6000;

function bandAnteilVon(frequenzHz, abtastrate) {
  const werte = Float32Array.from(ton(BAND_PROBE_MS, [frequenzHz], abtastrate));
  return bandAnteil({ proben: werte, abtastrate, grenzHz: KLANG_GRENZE_HZ });
}

describe("IEP-P1 bandAnteil trennt Hoehen von Tiefen", () => {
  it("ein 4-kHz-Ton liegt fast vollstaendig oberhalb der Bandgrenze", () => {
    const anteil = bandAnteilVon(HOHER_TON_HZ, ABTASTRATE);
    assert.ok(anteil > ANTEIL_HOCH_MIN, `anteil=${anteil}`);
  });

  it("ein 300-Hz-Ton liegt fast vollstaendig darunter", () => {
    const anteil = bandAnteilVon(TIEFER_TON_HZ, ABTASTRATE);
    assert.ok(anteil < ANTEIL_TIEF_MAX, `anteil=${anteil}`);
  });

  it("liefert null, wenn die Abtastrate oberhalb der Grenze kein Band mehr traegt", () => {
    assert.equal(bandAnteilVon(TIEFER_TON_HZ, ABTASTRATE_OHNE_BAND), null);
  });
});

// G.711-Bytes mit bekannter Wirkung: 0xFF (mu-law) und 0xD5 (A-law) sind Null, der
// Wechsel 0x00/0x80 ist eine Rechteckschwingung mit voller Aussteuerung.
const MULAW_STILLE = 0xff;
const ALAW_STILLE = 0xd5;
const MULAW_LAUT_POSITIV = 0x80;
const MULAW_LAUT = Object.freeze([0x00, MULAW_LAUT_POSITIV]);
const G711_ABSCHNITT_PROBEN = 4000;
const STILL_GRENZE = 0.01;
const LAUT_GRENZE = 0.5;
const KURZE_PROBE_MS = 100;

function wiederhole(anzahl, wertFuer) {
  const werte = new Array(anzahl);
  for (let i = 0; i < anzahl; i += 1) werte[i] = wertFuer(i);
  return werte;
}

describe("IEP-P1 leseWav: G.711 wird dekodiert, Unbekanntes wirft", () => {
  it("dekodiert mu-law: die laute Haelfte wird als Ton gefunden, die stille nicht", () => {
    const bytes = [
      ...wiederhole(G711_ABSCHNITT_PROBEN, () => MULAW_STILLE),
      ...wiederhole(G711_ABSCHNITT_PROBEN, (i) => MULAW_LAUT[i % MULAW_LAUT.length]),
    ];
    const { abtastrate, kanaele } = leseWav(baueWavG711({ abtastrate: SCHMALBAND_ABTASTRATE, bytes, formatCode: FORMAT_MULAW }));
    assert.equal(abtastrate, SCHMALBAND_ABTASTRATE);
    const [werte] = kanaele;
    assert.ok(Math.abs(werte[0]) < STILL_GRENZE, "mu-law 0xFF muss Stille sein");
    assert.ok(Math.abs(werte[G711_ABSCHNITT_PROBEN + 1]) > LAUT_GRENZE, "mu-law 0x00/0x80 muss laut sein");
  });

  it("dekodiert A-law: 0xD5 ist Stille", () => {
    const bytes = wiederhole(G711_ABSCHNITT_PROBEN, () => ALAW_STILLE);
    const { kanaele } = leseWav(baueWavG711({ abtastrate: SCHMALBAND_ABTASTRATE, bytes, formatCode: FORMAT_ALAW }));
    assert.ok(Math.abs(kanaele[0][0]) < STILL_GRENZE);
  });

  it("wirft bei einem nicht unterstuetzten Formatcode statt stille Nullen zu liefern", () => {
    const spuren = [stille(KURZE_PROBE_MS), stille(KURZE_PROBE_MS)];
    assert.throws(() => leseWav(baueWavPcm16({ abtastrate: ABTASTRATE, spuren, formatCode: FORMAT_FLOAT })), WavFehler);
  });

  it("wirft ohne RIFF-Kopf und bei einem einkanaligen Mitschnitt", () => {
    assert.throws(() => leseWav(Buffer.from("kein wav")), WavFehler);
    const mono = baueWavPcm16({ abtastrate: ABTASTRATE, spuren: [stille(KURZE_PROBE_MS)] });
    assert.throws(() => ohrzeugeAudioSicht(mono), /brauchen dual/);
  });
});

describe("IEP-P1 fremdeTonEreignisse klammert unsere eigene Sprechspur aus", () => {
  it("zaehlt genau den fremden Ton, nicht unsere Sprechspur", () => {
    const ereignisse = [
      { name: "playback.started", payload: { payload: { call_leg_id: UNSER_BEIN, command_id: sprechspurKommandoId(LAUF_ID) } } },
      { name: "playback.ended", payload: { payload: { call_leg_id: UNSER_BEIN, command_id: sprechspurKommandoId(LAUF_ID) } } },
      { name: "call.answered", payload: { payload: { call_leg_id: GEWAEHLTES_BEIN } } },
      { name: "tone_stream.started", payload: { payload: { call_leg_id: GEWAEHLTES_BEIN } } },
    ];
    const fremde = fremdeTonEreignisse({ ereignisse, laufId: LAUF_ID });
    assert.equal(fremde.length, 1);
    assert.equal(fremde[0].name, "tone_stream.started");

    const kennzahlen = kennzahlenFuer({ bytes: baueMitschnitt(), ereignisse: [...sitzungsEreignisse(), ...ereignisse] });
    assert.equal(kennzahlen.tonereignisse.ja, true);
    assert.deepEqual(kennzahlen.tonereignisse.namen, ["tone_stream.started"]);
  });
});
