// WAV-Auswertung des Ohrzeugen (IEP-P1) ohne Fremdbibliothek: RIFF lesen, Kanaele trennen,
// Huellkurve, Ton-/Stille-Segmente, Grundrauschen, Bandanteil.
//
// REIN: kein IO, kein fetch, keine Uhr, kein config - alles kommt als Argument herein.
// Nur so laesst sich die Positiv-Kontrolle ("bekannter Fremdton, bekannte Stille") ohne
// Anruf fahren.
//
// Ein nicht unterstuetztes Format WIRFT. Ein Auswerter, der im Zweifel 0 liefert, sieht
// aus wie ein stiller Anruf - und genau das waere der Befund, den wir suchen.

export const FENSTER_MS = 20;
// Absoluter Boden: darunter ist es auch dann Stille, wenn der Mitschnitt fast rauschfrei ist.
const STILLE_SCHWELLE_DBFS = -50;
// Relativ zum Grundrauschen: ein Mitschnitt mit Leitungsrauschen haette sonst nur "Ton".
const RAUSCH_FAKTOR = 3;
const RAUSCH_PERZENTIL = 10;
// Statt -Infinity, damit jede Kennzahl JSON-faehig bleibt.
const DBFS_BODEN = -120;

const MS_JE_S = 1000;
const PROZENT = 100;
const DBFS_JE_DEKADE = 20;

// RIFF/WAVE-Kopf: "RIFF" + Groesse + "WAVE" = 12 Bytes, danach Chunks aus 8 Byte Kopf.
const KOPF_LAENGE = 12;
const CHUNK_KOPF_LAENGE = 8;
const TAG_LAENGE = 4;
const FORMAT_PCM = 1;
const FORMAT_ALAW = 6;
const FORMAT_MULAW = 7;
const PCM16_BITS = 16;
const PCM16_BYTES = 2;
const PCM16_MAX = 32768;
const G711_BYTES = 1;

// Blockgroesse der Bandanalyse (Zweierpotenz, Radix-2-FFT); die reale FFT liefert
// FFT_BLOCK/2 nutzbare Bins bis zur Nyquist-Frequenz.
const FFT_BLOCK = 512;
// Reale Eingangsdaten -> Hermitesche Symmetrie: nur die untere Haelfte der Bins traegt
// Information (>> 1 halbiert die Zweierpotenz).
const SPEKTRUM_BINS = FFT_BLOCK >> 1;
const NYQUIST_TEILER = 2;
// Voller Kreis im Bogenmass; Hann-Fenster und Drehfaktor teilen ihn (G5).
const VOLLER_KREIS = Math.PI + Math.PI;
const ZEHNER_BASIS = 10;
// RIFF-Chunks sind auf gerade Byte-Grenzen ausgerichtet.
const CHUNK_AUSRICHTUNG = 2;
// Hann-Fenster: w(i) = a - a*cos(2*pi*i/(N-1)).
const HANN_A = 0.5;

export class WavFehler extends Error {}

// --- RIFF lesen ---------------------------------------------------------------------------

function tag(daten, offset) {
  let text = "";
  for (let i = 0; i < TAG_LAENGE; i += 1) text += String.fromCharCode(daten[offset + i]);
  return text;
}

function leseFormat(sicht, ab) {
  const CODE = 0;
  const KANAELE = 2;
  const ABTASTRATE = 4;
  const BITS = 14;
  return {
    code: sicht.getUint16(ab + CODE, true),
    kanaele: sicht.getUint16(ab + KANAELE, true),
    abtastrate: sicht.getUint32(ab + ABTASTRATE, true),
    bits: sicht.getUint16(ab + BITS, true),
  };
}

// G.711 A-law nach linear (ITU-T-Referenzalgorithmus).
const ALAW_MASKE = 0x55;
const ALAW_QUANT = 0x0f;
const ALAW_SEGMENT = 0x70;
const ALAW_VORZEICHEN = 0x80;
const ALAW_SEGMENT_SCHIEBUNG = 4;
const ALAW_BASIS_SCHIEBUNG = 4;
const ALAW_OFFSET_KLEIN = 8;
const ALAW_OFFSET_GROSS = 0x108;

function aLawZuFloat(byte) {
  const wert = byte ^ ALAW_MASKE;
  const segment = (wert & ALAW_SEGMENT) >> ALAW_SEGMENT_SCHIEBUNG;
  let stufe = (wert & ALAW_QUANT) << ALAW_BASIS_SCHIEBUNG;
  if (segment === 0) stufe += ALAW_OFFSET_KLEIN;
  else if (segment === 1) stufe += ALAW_OFFSET_GROSS;
  else stufe = (stufe + ALAW_OFFSET_GROSS) << (segment - 1);
  return ((wert & ALAW_VORZEICHEN) ? stufe : -stufe) / PCM16_MAX;
}

// G.711 mu-law nach linear (ITU-T-Referenzalgorithmus).
const MULAW_BIAS = 0x84;
const MULAW_QUANT = 0x0f;
const MULAW_SEGMENT = 0x70;
const MULAW_VORZEICHEN = 0x80;
const MULAW_SEGMENT_SCHIEBUNG = 4;
const MULAW_BASIS_SCHIEBUNG = 3;
const BYTE_MASKE = 0xff;

function muLawZuFloat(byte) {
  const wert = ~byte & BYTE_MASKE;
  const segment = (wert & MULAW_SEGMENT) >> MULAW_SEGMENT_SCHIEBUNG;
  const stufe = (((wert & MULAW_QUANT) << MULAW_BASIS_SCHIEBUNG) + MULAW_BIAS) << segment;
  return ((wert & MULAW_VORZEICHEN) ? MULAW_BIAS - stufe : stufe - MULAW_BIAS) / PCM16_MAX;
}

function probenLeser(format) {
  if (format.code === FORMAT_PCM && format.bits === PCM16_BITS) {
    return { bytes: PCM16_BYTES, lies: (sicht, ab) => sicht.getInt16(ab, true) / PCM16_MAX };
  }
  if (format.code === FORMAT_ALAW) return { bytes: G711_BYTES, lies: (sicht, ab) => aLawZuFloat(sicht.getUint8(ab)) };
  if (format.code === FORMAT_MULAW) return { bytes: G711_BYTES, lies: (sicht, ab) => muLawZuFloat(sicht.getUint8(ab)) };
  throw new WavFehler(`WAV-Formatcode ${format.code} (${format.bits} bit) wird nicht ausgewertet - lieber kein Wert als eine stille Null`);
}

function teileKanaele({ sicht, format, datenTeil }) {
  const leser = probenLeser(format);
  const rahmenBytes = leser.bytes * format.kanaele;
  const rahmen = Math.floor(datenTeil.laenge / rahmenBytes);
  const kanaele = Array.from({ length: format.kanaele }, () => new Float32Array(rahmen));
  for (let rahmenNr = 0; rahmenNr < rahmen; rahmenNr += 1) {
    const rahmenAb = datenTeil.ab + rahmenNr * rahmenBytes;
    for (let kanal = 0; kanal < format.kanaele; kanal += 1) {
      kanaele[kanal][rahmenNr] = leser.lies(sicht, rahmenAb + kanal * leser.bytes);
    }
  }
  return kanaele;
}

function sucheChunks(daten, sicht) {
  const gefunden = { format: null, datenTeil: null };
  let offset = KOPF_LAENGE;
  while (offset + CHUNK_KOPF_LAENGE <= daten.byteLength) {
    const name = tag(daten, offset);
    const laenge = sicht.getUint32(offset + TAG_LAENGE, true);
    const inhaltAb = offset + CHUNK_KOPF_LAENGE;
    if (name === "fmt ") gefunden.format = leseFormat(sicht, inhaltAb);
    if (name === "data") gefunden.datenTeil = { ab: inhaltAb, laenge: Math.min(laenge, daten.byteLength - inhaltAb) };
    offset = inhaltAb + laenge + (laenge % CHUNK_AUSRICHTUNG);
  }
  return gefunden;
}

/** Liest einen RIFF/WAVE-Mitschnitt in getrennte Kanaele. Wirft WavFehler statt zu raten. */
export function leseWav(bytes) {
  const daten = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (daten.byteLength < KOPF_LAENGE || tag(daten, 0) !== "RIFF" || tag(daten, KOPF_LAENGE - TAG_LAENGE) !== "WAVE") {
    throw new WavFehler(`Kein RIFF/WAVE-Kopf (${daten.byteLength} Bytes) - Mitschnitt nicht auswertbar`);
  }
  const sicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const { format, datenTeil } = sucheChunks(daten, sicht);
  if (!format || !datenTeil) throw new WavFehler("RIFF ohne fmt- oder data-Chunk - Mitschnitt nicht auswertbar");
  if (!(format.kanaele > 0) || !(format.abtastrate > 0)) throw new WavFehler("WAV-Kopf nennt 0 Kanaele oder 0 Hz - Mitschnitt nicht auswertbar");
  return { abtastrate: format.abtastrate, kanaele: teileKanaele({ sicht, format, datenTeil }) };
}

// --- Huellkurve und Segmente ---------------------------------------------------------------

/** RMS je FENSTER_MS. Der Index eines Wertes ist damit zugleich seine Startzeit / FENSTER_MS. */
export function huellkurve({ proben, abtastrate }) {
  const fenster = Math.max(1, Math.round((abtastrate * FENSTER_MS) / MS_JE_S));
  const anzahl = Math.floor(proben.length / fenster);
  const werte = new Float32Array(anzahl);
  for (let i = 0; i < anzahl; i += 1) {
    let summe = 0;
    for (let k = i * fenster; k < (i + 1) * fenster; k += 1) summe += proben[k] * proben[k];
    werte[i] = Math.sqrt(summe / fenster);
  }
  return werte;
}

function alsDbfs(rms) {
  return rms > 0 ? DBFS_JE_DEKADE * Math.log10(rms) : DBFS_BODEN;
}

function ausDbfs(dbfs) {
  return Math.pow(ZEHNER_BASIS, dbfs / DBFS_JE_DEKADE);
}

function perzentil(werte, anteilProzent) {
  if (werte.length === 0) return 0;
  const sortiert = Float32Array.from(werte).sort();
  const index = Math.min(sortiert.length - 1, Math.floor((sortiert.length * anteilProzent) / PROZENT));
  return sortiert[index];
}

/** Grundrauschen in dBFS: das RAUSCH_PERZENTIL-Perzentil der Huellkurve. */
export function grundrauschen(huellkurveWerte) {
  return huellkurveWerte.length === 0 ? null : alsDbfs(perzentil(huellkurveWerte, RAUSCH_PERZENTIL));
}

// DIE EINE Schwelle, die (ii) Fremdton, (v) Stille und (vi) Turn-Luecken teilen (G5).
export function tonSchwelle(huellkurveWerte) {
  return Math.max(ausDbfs(STILLE_SCHWELLE_DBFS), RAUSCH_FAKTOR * perzentil(huellkurveWerte, RAUSCH_PERZENTIL));
}

function segmenteWo(huellkurveWerte, trifftZu) {
  const segmente = [];
  let start = null;
  const schliesse = (bis) => segmente.push({ startMs: start * FENSTER_MS, endeMs: bis * FENSTER_MS, dauerMs: (bis - start) * FENSTER_MS });
  for (let i = 0; i < huellkurveWerte.length; i += 1) {
    const passt = trifftZu(huellkurveWerte[i]);
    if (passt && start === null) start = i;
    if (!passt && start !== null) {
      schliesse(i);
      start = null;
    }
  }
  if (start !== null) schliesse(huellkurveWerte.length);
  return segmente;
}

export function tonSegmente({ huellkurve: huellkurveWerte, schwelle }) {
  return segmenteWo(huellkurveWerte, (wert) => wert >= schwelle);
}

export function stilleSegmente({ huellkurve: huellkurveWerte, schwelle, minMs }) {
  return segmenteWo(huellkurveWerte, (wert) => wert < schwelle).filter((segment) => segment.dauerMs >= minMs);
}

// --- Bandanteil (Klangkennzahl) -------------------------------------------------------------

// Periodogramm EINES Blocks: Hann-Fenster, iterative Radix-2-FFT, Betragsquadrat je Bin.
// Bewusst EINE Funktion - die FFT arbeitet in-place auf ihren eigenen Puffern, ein Helfer
// muesste sie als Parameter mutieren.
function periodogramm(block) {
  const re = new Float64Array(FFT_BLOCK);
  const im = new Float64Array(FFT_BLOCK);
  for (let i = 0; i < FFT_BLOCK; i += 1) {
    re[i] = block[i] * (HANN_A - HANN_A * Math.cos((VOLLER_KREIS * i) / (FFT_BLOCK - 1)));
  }
  // Bit-Umkehr: bringt die Eingaben in die Reihenfolge, die die Schmetterlinge erwarten.
  for (let i = 1, j = 0; i < FFT_BLOCK; i += 1) {
    let bit = SPEKTRUM_BINS;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let stufe = NYQUIST_TEILER; stufe <= FFT_BLOCK; stufe <<= 1) {
    const grundwinkel = -VOLLER_KREIS / stufe;
    const haelfte = stufe >> 1;
    for (let anfang = 0; anfang < FFT_BLOCK; anfang += stufe) {
      for (let k = 0; k < haelfte; k += 1) {
        const cos = Math.cos(grundwinkel * k);
        const sin = Math.sin(grundwinkel * k);
        const links = anfang + k;
        const rechts = links + haelfte;
        const drehRe = re[rechts] * cos - im[rechts] * sin;
        const drehIm = re[rechts] * sin + im[rechts] * cos;
        re[rechts] = re[links] - drehRe;
        im[rechts] = im[links] - drehIm;
        re[links] += drehRe;
        im[links] += drehIm;
      }
    }
  }
  const spektrum = new Float64Array(SPEKTRUM_BINS);
  for (let bin = 0; bin < SPEKTRUM_BINS; bin += 1) spektrum[bin] = re[bin] * re[bin] + im[bin] * im[bin];
  return spektrum;
}

// Ueber alle vollen Bloecke summiertes Periodogramm. Geteilt von bandAnteil und spitzenBin
// (G5) - es gibt genau EINE FFT in diesem Repo.
function summiertesSpektrum(proben) {
  const spektrum = new Float64Array(SPEKTRUM_BINS);
  for (let ab = 0; ab + FFT_BLOCK <= proben.length; ab += FFT_BLOCK) {
    const blockSpektrum = periodogramm(proben.subarray(ab, ab + FFT_BLOCK));
    for (let bin = 0; bin < SPEKTRUM_BINS; bin += 1) spektrum[bin] += blockSpektrum[bin];
  }
  return spektrum;
}

/**
 * Energieanteil oberhalb grenzHz am Gesamtspektrum. null, wenn die Abtastrate oberhalb
 * grenzHz gar kein Band mehr traegt oder zu wenig Audio fuer einen Block vorliegt.
 */
export function bandAnteil({ proben, abtastrate, grenzHz }) {
  if (abtastrate / NYQUIST_TEILER <= grenzHz || proben.length < FFT_BLOCK) return null;
  const spektrum = summiertesSpektrum(proben);
  const grenzBin = Math.ceil((grenzHz * FFT_BLOCK) / abtastrate);
  let oben = 0;
  let gesamt = 0;
  for (let bin = 0; bin < SPEKTRUM_BINS; bin += 1) {
    gesamt += spektrum[bin];
    if (bin >= grenzBin) oben += spektrum[bin];
  }
  return gesamt > 0 ? oben / gesamt : null;
}

/**
 * Staerkster Spektralanteil: { hz, anteil }. `anteil` ist seine Energie gegen die
 * Gesamtenergie - die Messform von "ist das ein Ton oder ein Rauschen". Ein reiner Sinus
 * buendelt fast alles in einem Bin, breitbandiges Rauschen verteilt es.
 * null, wenn zu wenig Audio fuer einen Block vorliegt oder das Signal stumm ist.
 */
export function spitzenBin({ proben, abtastrate }) {
  if (proben.length < FFT_BLOCK) return null;
  const spektrum = summiertesSpektrum(proben);
  let gesamt = 0;
  let groesster = 0;
  let groessterBin = 0;
  for (let bin = 0; bin < SPEKTRUM_BINS; bin += 1) {
    gesamt += spektrum[bin];
    if (spektrum[bin] > groesster) {
      groesster = spektrum[bin];
      groessterBin = bin;
    }
  }
  return gesamt > 0 ? { hz: (groessterBin * abtastrate) / FFT_BLOCK, anteil: groesster / gesamt } : null;
}
