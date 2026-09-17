// ---- IEP-P2: der Begruessungslaut als Datei, als Rezept und als ausgelieferte URL -----------
// Das committete WAV ist kein Blindgaenger: es entsteht byte-genau aus dem Rezept in
// scripts/render-begruessungslaut.mjs, traegt keine Freiton-Frequenz, ist kurz, hat genau EINEN
// hoerbaren Block und liegt an genau dem Pfad, den die Dial-Direktive als URL ausliefert.
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

// Der US-Freiton ist ein Doppelton aus genau diesen beiden Frequenzen. Unser Laut darf keine
// davon tragen, sonst klaenge er wieder nach Netz-Klingeln.
const FREITON_TIEF_HZ = 440;
const FREITON_HOCH_HZ = 480;
const FREITON_HZ = Object.freeze([FREITON_TIEF_HZ, FREITON_HOCH_HZ]);
const istFreitonFrei = (toene) => toene.every((ton) => !FREITON_HZ.includes(ton.hz));

// "Kurz" (Auftrag): der hoerbare Teil bleibt unter dieser Grenze.
const HOERBARE_OBERGRENZE_MS = 1000;
// Spaetestes Ende des EL-Annahmefensters (0,7-0,9 s). Die Nachlauf-Stille muss laenger sein,
// sonst faengt Telnyx' Ringback-Wiederholung eine Kadenz an.
const EL_ANNAHME_FENSTER_MAX_MS = 900;
// Messfenster der Huellkurve: 10 ms sind kurz genug, um eine Kadenzluecke (Freiton: 4 s Pause)
// zu sehen, und lang genug, um Nulldurchgaenge eines Tons nicht als Stille zu lesen.
const MESSFENSTER_MS = 10;
const MESSFENSTER_RAHMEN = (MESSFENSTER_MS * BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) / MS_PER_SECOND;
// Ein Fenster gilt als hoerbar, sobald irgendein Rahmen darin diesen Betrag ueberschreitet.
// Deutlich ueber der Quantisierungsschwelle, deutlich unter dem Spitzenpegel.
const HOERBAR_SCHWELLE = 200;
const EIN_BLOCK = 1;

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

const rahmenMs = (rahmen) => (rahmen / BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) * MS_PER_SECOND;

// Groesster Betrag in einem Rahmenfenster der PCM-Spur.
function fensterSpitze(puffer, vonRahmen, bisRahmen) {
  let spitze = 0;
  for (let index = vonRahmen; index < bisRahmen; index += 1) {
    spitze = Math.max(spitze, Math.abs(puffer.readInt16LE(RIFF_KOPF_BYTES + index * BYTES_PRO_RAHMEN)));
  }
  return spitze;
}

// Hoerbare Bloecke der PCM-Spur: {startMs, endeMs} je Folge zusammenhaengender Fenster ueber der
// Schwelle. Ein Freiton haette mehrere Bloecke (Kadenz), unser Laut genau einen.
function hoerbareBloecke(puffer) {
  const rahmen = (puffer.length - RIFF_KOPF_BYTES) / BYTES_PRO_RAHMEN;
  const bloecke = [];
  let offen = null;
  for (let start = 0; start < rahmen; start += MESSFENSTER_RAHMEN) {
    const ende = Math.min(rahmen, start + MESSFENSTER_RAHMEN);
    if (fensterSpitze(puffer, start, ende) > HOERBAR_SCHWELLE) {
      offen = offen ?? { startMs: rahmenMs(start), endeMs: rahmenMs(ende) };
      offen.endeMs = rahmenMs(ende);
    } else if (offen) {
      bloecke.push(offen);
      offen = null;
    }
  }
  if (offen) bloecke.push(offen);
  return bloecke;
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

  const gesamtMs =
    BEGRUESSUNGSLAUT_REZEPT.toene.reduce((summe, ton) => summe + ton.dauerMs, 0) +
    BEGRUESSUNGSLAUT_REZEPT.nachlaufStilleMs;
  const erwarteteRahmen = (gesamtMs * BEGRUESSUNGSLAUT_REZEPT.abtastrateHz) / MS_PER_SECOND;
  assert.equal(kopf.datenBytes, erwarteteRahmen * BYTES_PRO_RAHMEN);
  assert.equal(puffer.length, RIFF_KOPF_BYTES + kopf.datenBytes);
  assert.equal(kopf.riffGroesse, puffer.length - RIFF_GROESSE_VORLAUF_BYTES);
});

test("IEP-P2-A3: kurz, genau ein Tonblock, keine Freiton-Frequenz, Nachlauf hinter dem EL-Fenster", () => {
  assert.ok(istFreitonFrei(BEGRUESSUNGSLAUT_REZEPT.toene), "keine Rezept-Frequenz aus dem US-Doppelton");
  // Positiv-Kontrolle: sonst waere "kein Treffer" nicht von "sucht gar nicht" zu unterscheiden
  // (Lehre pruefkommando-ohne-positiv-kontrolle).
  assert.ok(!istFreitonFrei([{ hz: FREITON_HZ[0] }]), "die Pruefung findet eine Freiton-Frequenz");

  const bloecke = hoerbareBloecke(dateiBytes());
  assert.equal(bloecke.length, EIN_BLOCK, JSON.stringify(bloecke));
  const [block] = bloecke;
  assert.equal(block.startMs, 0, "der Laut beginnt sofort");
  assert.ok(block.endeMs <= HOERBARE_OBERGRENZE_MS, `hoerbar bis ${block.endeMs} ms`);
  assert.ok(
    BEGRUESSUNGSLAUT_REZEPT.nachlaufStilleMs > EL_ANNAHME_FENSTER_MAX_MS,
    "Nachlauf-Stille muss das EL-Annahmefenster ueberdauern, sonst entsteht eine Kadenz",
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
