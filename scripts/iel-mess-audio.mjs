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

const CHUNK_AUSRICHTUNG = 2;

export class WavFehler extends Error {}

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

export function leseWav(bytes) {
  const daten = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (daten.byteLength < KOPF_LAENGE || tag(daten, 0) !== "RIFF" || tag(daten, KOPF_LAENGE - TAG_LAENGE) !== "WAVE") {
    throw new WavFehler(`Kein RIFF/WAVE-Kopf (${daten.byteLength} Bytes) - Mitschnitt nicht auswertbar`);
  }
  const sicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const { format, datenTeil } = sucheChunks(daten, sicht);
  if (!format || !datenTeil) throw new WavFehler("RIFF ohne fmt- oder data-Chunk - Mitschnitt nicht auswertbar");
  if (!(format.kanaele > 0) || !(format.abtastrate > 0)) throw new WavFehler("WAV-Kopf nennt 0 Kanaele oder 0 Hz - Mitschnitt nicht auswertbar");
  return { abtastrate: format.abtastrate, format, kanaele: teileKanaele({ sicht, format, datenTeil }) };
}
