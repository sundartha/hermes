import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 170000 };
const SKRIPT = "test/gemeinsam/widget-anruffolge.mjs";
const PNG_KOPF = "89504e470d0a1a0a";
const BREITE_OFFSET = 16;
const HOEHE_OFFSET = 20;
const RING_DICHTE = 3;
const RING_PX = 72;

const starte = (args) => new Promise((resolve) => {
  execFile(process.execPath, [SKRIPT, ...args], { maxBuffer: 1 << 26 }, (fehler, stdout, stderr) => resolve({ code: fehler ? fehler.code : 0, stdout, stderr }));
});

const png = (pfad) => {
  const bytes = readFileSync(pfad);
  return { kopf: bytes.subarray(0, 8).toString("hex"), breite: bytes.readUInt32BE(BREITE_OFFSET), hoehe: bytes.readUInt32BE(HOEHE_OFFSET) };
};

test("--hilfe nennt Aufruf, Modi und Grenzen und läuft ohne Chromium", async () => {
  const { code, stdout } = await starte(["--hilfe"]);
  assert.equal(code, 0);
  assert.match(stdout, /node test\/gemeinsam\/widget-anruffolge\.mjs PFAD/);
  for (const modus of ["anruffolge", "ladezeit", "ueberlauf", "belege"]) assert.match(stdout, new RegExp(`\\b${modus}\\b`));
  assert.match(stdout, /lokal ausgeliefert, also ohne Netzübertragung/);
  assert.match(stdout, /Host ist simuliert/);
  assert.match(stdout, /Headless-Chromium mit 60 Hz/);
});

test("fehlender Pfad, unbekannte Datei, Szenario und Modus enden mit Exit 1 und einer Meldung", async () => {
  const ohne = await starte([]);
  assert.equal(ohne.code, 1);
  assert.match(ohne.stderr, /PFAD fehlt oder nicht gefunden/);
  const fehlt = await starte([join(tmpdir(), "gibt-es-nicht.html")]);
  assert.equal(fehlt.code, 1);
  assert.match(fehlt.stderr, /gibt-es-nicht\.html/);
  const datei = join(mkdtempSync(join(tmpdir(), "anruffolge-test-")), "karte.html");
  writeFileSync(datei, "<html></html>");
  const szenario = await starte([datei, "--szenario", "gibt_es_nicht"]);
  assert.equal(szenario.code, 1);
  assert.match(szenario.stderr, /unbekanntes Szenario: gibt_es_nicht/);
  const modus = await starte([datei, "--nur", "video"]);
  assert.equal(modus.code, 1);
  assert.match(modus.stderr, /unbekannter Modus: video/);
});

test("Kommandozeile gegen ein Widget-HTML liefert JSON mit allen Abschnitten und legt die Beleg-Dateien an", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const ordner = mkdtempSync(join(tmpdir(), "anruffolge-belege-"));
  const datei = join(ordner, "call.html");
  writeFileSync(datei, call);
  const { code, stdout, stderr } = await starte([datei, "--ordner", ordner]);
  assert.equal(code, 0, stderr);
  const ausgabe = JSON.parse(stdout);
  assert.equal(ausgabe.pfad, datei);
  assert.equal(ausgabe.szenario, "voll_de");
  assert.equal(ausgabe.anruffolge.szenario, "voll_de");
  assert.equal(typeof ausgabe.anruffolge.fenster, "string");
  assert.equal(typeof ausgabe.ladezeit.fcp_ms, "number");
  assert.deepEqual(ausgabe.ueberlauf.treffer, []);
  assert.equal(ausgabe.ueberlauf.lang, "de");
  const erwartet = ["waehlen", "verbunden", "ergebnis"].map((zustand) => `voll_de-${zustand}.png`).concat(["voll_de-ring-in_progress.png", "voll_de-ring-completed.png"]);
  const dateien = ausgabe.belege.dateien;
  assert.deepEqual(dateien.map((pfad) => pfad.slice(ordner.length + 1)).sort(), [...erwartet].sort());
  for (const pfad of dateien) assert.ok(existsSync(pfad));
  for (const zustand of ["waehlen", "verbunden", "ergebnis"]) {
    const bild = png(join(ordner, `voll_de-${zustand}.png`));
    assert.deepEqual(bild, { kopf: PNG_KOPF, breite: 420, hoehe: 640 });
  }
  for (const status of ["in_progress", "completed"]) {
    const ring = png(join(ordner, `voll_de-ring-${status}.png`));
    assert.equal(ring.kopf, PNG_KOPF);
    assert.equal(ring.breite, ring.hoehe);
    assert.ok(ring.breite >= RING_PX * RING_DICHTE);
  }
});

test("--nur beschränkt die Ausgabe auf die genannten Abschnitte", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const datei = join(mkdtempSync(join(tmpdir(), "anruffolge-nur-")), "call.html");
  writeFileSync(datei, call);
  const { code, stdout, stderr } = await starte([datei, "--nur", "ueberlauf"]);
  assert.equal(code, 0, stderr);
  const ausgabe = JSON.parse(stdout);
  assert.deepEqual(Object.keys(ausgabe).sort(), ["pfad", "szenario", "tempo", "ueberlauf"]);
});
