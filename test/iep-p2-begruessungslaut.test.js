// ---- IEP-P2c: der Begruessungslaut aus der abgenommenen ElevenLabs-Quelle -------------------
// Owner-Entscheidung 2026-09-17: der gerechnete Laut (IEP-P2b, Komfortrauschen) ist
// durchgefallen ("hoert sich an wie Gewitter"). Der Owner hat einen von ElevenLabs erzeugten
// Soundeffekt ausgewaehlt und abgenommen: weiches Abheben des Hoerers, danach ruhige Leitung.
// Diese Datei ist kein Blindgaenger, sondern hat einen dokumentierten, wiederholbaren Weg
// (scripts/render-begruessungslaut.mjs), aber KEIN Test pinnt sie byte-genau - ein Nachlauf des
// Umwandlers trifft die abgenommene Datei hoerbar, nicht byte-identisch (Container-Polsterung
// von afconvert, +-1 LSB Rundung). Diese Tests beschreiben die Eigenschaften der Datei.
// Namen beginnen mit "IEP-P2c-A<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { leseWav } from "../scripts/iel-mess-audio.mjs";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "../src/elevenlabs/inbound-rueckfall.js";
import { config } from "../src/config.js";
import { BASE_ENV, ROOT, startServer } from "./helpers.js";

const HTTP_OK = 200;

// Schranken - jede mit dem heute (2026-09-17) gemessenen Abstand als Kommentar.
const SOLL_ABTASTRATE_HZ = 8000;
const SOLL_KANAELE = 1;
const SOLL_BIT_TIEFE = 16;
const SOLL_FORMAT_TAG = 1; // unkomprimiertes PCM

const DAUER_MIN_MS = 2000; // gemessen 3000
const DAUER_MAX_MS = 5000; // kuerzer hiesse: der Klick faellt in das EL-Annahmefenster ein zweites Mal
const EL_ANNAHME_FENSTER_MAX_MS = 900; // Bestand (IEP-P2): die Datei muss es ueberdauern

const PEGEL_MAX_DBFS = -18; // gemessen -20,00 - nie aufdringlich
const PEGEL_MIN_DBFS = -26; // gemessen -20,00 - der erste Entwurf lag bei -40 und war am Telefon nicht wahrnehmbar

const AUSBLENDE_MS = 150;
const AUSBLENDE_DAEMPFUNG_MIN_DB = 30; // gemessen 58,3 dB

const INT16_SKALA = 32768;
const UEBERSTEUERUNG_GRENZE = 32767; // gemessen 0 Samples

const PERZENTIL_99 = 99;
const PROZENT = 100;
const DBFS_JE_DEKADE = 20;
const DBFS_NACHKOMMA = 2;
const MS_PER_SECOND = 1000;
const DEZIBEL_BASIS = 10;

// Positiv-Kontrollen (Lehre pruefkommando-ohne-positiv-kontrolle): reine Verfaelschungen der
// gemessenen Datei, jede muss an genau der Schranke durchfallen, die sie beweisen soll.
const LEISE_FAKTOR_DBFS = -40; // "unhoerbar" - der tatsaechliche erste Entwurf
const LAUT_FAKTOR_DBFS = -6; // "aufdringlich"
const UEBERSTEUERUNG_FAKTOR = 100; // "geklemmt"

const AUSLIEFERUNG_PFAD = path.join(ROOT, "public", EL_BEGRUESSUNGSLAUT_PFAD);

function dateiBytes() {
  return fs.readFileSync(AUSLIEFERUNG_PFAD);
}

// --- gemeinsame reine Messfunktionen (EINE Quelle fuer Ist-Messung und Positiv-Kontrolle) -----

function dbfs(linear) {
  return linear > 0 ? DBFS_JE_DEKADE * Math.log10(linear) : -Infinity;
}

function spitzenpegelDbfs(proben) {
  const spitze = proben.reduce((groesster, wert) => Math.max(groesster, Math.abs(wert)), 0);
  return dbfs(spitze);
}

function uebersteuerteSamples(proben) {
  let anzahl = 0;
  for (const wert of proben) {
    if (Math.abs(Math.round(wert * INT16_SKALA)) > UEBERSTEUERUNG_GRENZE) anzahl += 1;
  }
  return anzahl;
}

function dauerMs(proben, abtastrate) {
  return (proben.length * MS_PER_SECOND) / abtastrate;
}

// dB-Daempfung des letzten Samples gegen die Dateispitze - die Messform von "weiche Ausblende".
function ausblendeDaempfungDb(proben) {
  const spitze = spitzenpegelDbfs(proben);
  const letzteSpitze = dbfs(Math.abs(proben[proben.length - 1]));
  return spitze - letzteSpitze;
}

function alsInt16Flanken(proben) {
  const flanken = [];
  for (let i = 1; i < proben.length; i += 1) {
    flanken.push(Math.abs(Math.round(proben[i] * INT16_SKALA) - Math.round(proben[i - 1] * INT16_SKALA)));
  }
  return flanken;
}

function nahtFlanke(proben) {
  return Math.abs(Math.round(proben[0] * INT16_SKALA) - Math.round(proben[proben.length - 1] * INT16_SKALA));
}

function innenFlankenP99(proben) {
  const sortiert = Float64Array.from(alsInt16Flanken(proben)).sort();
  const index = Math.min(sortiert.length - 1, Math.floor((sortiert.length * PERZENTIL_99) / PROZENT));
  return sortiert[index];
}

// --- Faelle -------------------------------------------------------------------------------

test("IEP-P2c-A1: das Asset liegt an genau dem Pfad, den die Dial-Direktive ausliefert", () => {
  assert.equal(AUSLIEFERUNG_PFAD, path.join(config.server.publicDir, EL_BEGRUESSUNGSLAUT_PFAD));
  assert.ok(fs.existsSync(AUSLIEFERUNG_PFAD));
});

test("IEP-P2c-A2: Telefonie-Format - 8000 Hz, mono, 16 bit PCM", () => {
  const { format, kanaele } = leseWav(dateiBytes());
  assert.equal(format.code, SOLL_FORMAT_TAG);
  assert.equal(format.kanaele, SOLL_KANAELE);
  assert.equal(format.abtastrate, SOLL_ABTASTRATE_HZ);
  assert.equal(format.bits, SOLL_BIT_TIEFE);
  assert.equal(kanaele.length, SOLL_KANAELE);
});

test("IEP-P2c-A3: Dauer im erwarteten Fenster und laenger als das EL-Annahmefenster", () => {
  const { abtastrate, kanaele } = leseWav(dateiBytes());
  const dauer = dauerMs(kanaele[0], abtastrate);
  assert.ok(dauer >= DAUER_MIN_MS && dauer <= DAUER_MAX_MS, `Dauer ${dauer} ms ausserhalb [${DAUER_MIN_MS}, ${DAUER_MAX_MS}]`);
  assert.ok(dauer > EL_ANNAHME_FENSTER_MAX_MS, `Dauer ${dauer} ms ueberdauert das EL-Annahmefenster (${EL_ANNAHME_FENSTER_MAX_MS} ms) nicht`);
});

test("IEP-P2c-A4: Spitzenpegel zwischen -26 und -18 dBFS, kein Uebersteuern", () => {
  const { kanaele } = leseWav(dateiBytes());
  const proben = kanaele[0];
  const pegel = spitzenpegelDbfs(proben);
  assert.ok(pegel >= PEGEL_MIN_DBFS && pegel <= PEGEL_MAX_DBFS, `Spitzenpegel ${pegel.toFixed(DBFS_NACHKOMMA)} dBFS ausserhalb [${PEGEL_MIN_DBFS}, ${PEGEL_MAX_DBFS}]`);
  assert.equal(uebersteuerteSamples(proben), 0, "Datei uebersteuert");
});

test("IEP-P2c-A5: weiche Ausblende am Ende, Schleifennaht ohne Knack", () => {
  const { kanaele } = leseWav(dateiBytes());
  const proben = kanaele[0];
  const daempfung = ausblendeDaempfungDb(proben);
  assert.ok(daempfung >= AUSBLENDE_DAEMPFUNG_MIN_DB, `Ausblende-Daempfung ${daempfung.toFixed(DBFS_NACHKOMMA)} dB < ${AUSBLENDE_DAEMPFUNG_MIN_DB}`);

  const naht = nahtFlanke(proben);
  const p99 = innenFlankenP99(proben);
  assert.ok(naht <= p99, `Naht-Flanke ${naht} > p99 der Innenflanken ${p99}`);
});

test("IEP-P2c-A6: die Schranken beissen - vier verfaelschte Fassungen fallen an genau ihnen durch", () => {
  const { abtastrate, kanaele } = leseWav(dateiBytes());
  const proben = kanaele[0];

  const skaliertAuf = (dbfsWert) => {
    const faktor = Math.pow(DEZIBEL_BASIS, dbfsWert / DBFS_JE_DEKADE) / Math.pow(DEZIBEL_BASIS, spitzenpegelDbfs(proben) / DBFS_JE_DEKADE);
    return Float64Array.from(proben, (wert) => wert * faktor);
  };

  const zuLeise = skaliertAuf(LEISE_FAKTOR_DBFS);
  assert.ok(spitzenpegelDbfs(zuLeise) < PEGEL_MIN_DBFS, "zu-leise-Fassung haette die Untergrenze unterschreiten muessen");

  const zuLaut = skaliertAuf(LAUT_FAKTOR_DBFS);
  assert.ok(spitzenpegelDbfs(zuLaut) > PEGEL_MAX_DBFS, "zu-laute-Fassung haette die Obergrenze ueberschreiten muessen");

  const geklemmt = Float64Array.from(proben, (wert) => Math.max(-1, Math.min(1, wert * UEBERSTEUERUNG_FAKTOR)));
  assert.ok(uebersteuerteSamples(geklemmt) > 0, "geklemmte Fassung haette uebersteuern muessen");

  // Ausblende entfernt: das Ende bleibt konstant auf Dateispitze statt abzuklingen - genau das
  // schluckt eine fehlende Ausblende, das letzte Sample bleibt laut.
  const ohneAusblende = Float64Array.from(proben);
  const ausblendeRahmen = Math.round((AUSBLENDE_MS * abtastrate) / MS_PER_SECOND);
  const start = Math.max(0, ohneAusblende.length - ausblendeRahmen);
  const spitze = proben.reduce((groesster, wert) => Math.max(groesster, Math.abs(wert)), 0);
  for (let i = start; i < ohneAusblende.length; i += 1) ohneAusblende[i] = spitze;
  const daempfungOhne = ausblendeDaempfungDb(ohneAusblende);
  assert.ok(daempfungOhne < AUSBLENDE_DAEMPFUNG_MIN_DB, "Fassung ohne Ausblende haette die Daempfungs-Untergrenze unterschreiten muessen");
});

test("IEP-P2c-A7: der bestehende public-Mount liefert das Asset ohne jede Auth aus", async () => {
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

test("IEP-P2c-A8: ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED steht kohaerent in config.js, .env.example, render.yaml, BASE_ENV", () => {
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
