import { spawn, spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { relative } from "node:path";
import { cwd, env } from "node:process";
import { fileURLToPath } from "node:url";

import { omitKeys } from "../../src/utils/object.js";
import { TESTGRUPPE } from "../testgruppe.mjs";

const TESTPARALLEL = 4;
const GEMESSENE_KERNE_JE_LAUF = 2;
const MS_JE_SEKUNDE = 1000;
const MS_JE_MINUTE = 60_000;
const ZEITGRENZE_MINUTEN = 10;
const MAX_AUSGABE = 268_435_456;
const MELDER = fileURLToPath(new URL("melder.mjs", import.meta.url));
const OHNE_PRUEFUNG = fileURLToPath(new URL("ohne-pruefung.mjs", import.meta.url));
export const UNTER_ATTRAPPE = ["--import", OHNE_PRUEFUNG];
const TESTKONTEXT = "NODE_TEST_CONTEXT";
const GLEICHZEITIG = "TESTWIRKUNG_GLEICHZEITIG";
const ANZAHL = /^[1-9]\d*$/;
const NUR_STDOUT = ["ignore", "pipe", "ignore"];
const plaetze = { frei: undefined, wartend: [], laufend: new Set(), abbruch: undefined };

function eintragIn(verzeichnis) {
  return (zeile) => {
    const { name, datei, bestanden, uebersprungen, zeile: aufrufzeile, spalte } = JSON.parse(zeile);
    const pfad = datei?.startsWith("file:") ? fileURLToPath(datei) : (datei ?? "");
    return { datei: relative(verzeichnis, pfad), name, bestanden, uebersprungen, zeile: aufrufzeile, spalte };
  };
}

function eigenstaendig() {
  return omitKeys(env, [TESTKONTEXT]);
}

function aufruf({ dateien, muster, vorspann, verzeichnis = cwd(), umgebung = {} }) {
  const argumente = [TESTGRUPPE, ...vorspann, "--test", `--test-concurrency=${TESTPARALLEL}`, `--test-reporter=${MELDER}`];
  const filter = muster.map((quelle) => `--test-name-pattern=${quelle}`);
  const optionen = { cwd: verzeichnis, env: { ...eigenstaendig(), ...umgebung } };
  return { argumente: [...argumente, ...filter, ...dateien], optionen };
}

function berichteDauer(beginn) {
  const minuten = (Date.now() - beginn) / MS_JE_MINUTE;
  if (minuten <= ZEITGRENZE_MINUTEN) return;
  console.log(`Hinweis: Ein Testlauf dauerte ${Math.ceil(minuten)} Minuten, länger als ${ZEITGRENZE_MINUTEN}.`);
}

function abgebrochen(grund) {
  return new Error(`Testlauf abgebrochen: ${grund}`);
}

function eintraegeAus(ausgabe, verzeichnis) {
  return ausgabe.split("\n").filter(Boolean).map(eintragIn(verzeichnis));
}

export function testlauf({ mitUebersprungenen = false, ...lauf }) {
  const { argumente, optionen } = aufruf(lauf);
  const beginn = Date.now();
  const ergebnis = spawnSync(process.execPath, argumente, { ...optionen, encoding: "utf8", maxBuffer: MAX_AUSGABE });
  berichteDauer(beginn);
  if (ergebnis.error !== undefined || ergebnis.signal !== null) throw abgebrochen(ergebnis.error?.message ?? ergebnis.signal);
  const eintraege = eintraegeAus(ergebnis.stdout, optionen.cwd);
  return eintraege.filter(({ uebersprungen }) => mitUebersprungenen || !uebersprungen);
}

function grenze() {
  const wert = env[GLEICHZEITIG];
  if (wert === undefined) return Math.max(1, Math.floor(availableParallelism() / GEMESSENE_KERNE_JE_LAUF));
  if (!ANZAHL.test(wert)) throw new Error(`${GLEICHZEITIG}=${wert} ist keine Zahl von Läufen ab 1.`);
  return Number(wert);
}

async function platzBelegen() {
  plaetze.frei ??= grenze();
  if (plaetze.frei > 0) plaetze.frei -= 1;
  else await new Promise((weiter) => plaetze.wartend.push(weiter));
  if (plaetze.abbruch === undefined) return;
  platzFreigeben();
  throw plaetze.abbruch;
}

function platzFreigeben() {
  const naechster = plaetze.wartend.shift();
  if (naechster === undefined) plaetze.frei += 1;
  else naechster();
}

export function laeufeAbbrechen(fehler) {
  plaetze.abbruch ??= fehler;
  for (const kind of plaetze.laufend) kind.kill("SIGTERM");
  return plaetze.abbruch;
}

function ausgabeDes(argumente, optionen) {
  return new Promise((fertig, gescheitert) => {
    const kind = spawn(process.execPath, argumente, { ...optionen, stdio: NUR_STDOUT });
    const teile = [];
    plaetze.laufend.add(kind);
    kind.stdout.setEncoding("utf8");
    kind.stdout.on("data", (teil) => teile.push(teil));
    kind.on("error", (fehler) => {
      plaetze.laufend.delete(kind);
      gescheitert(laeufeAbbrechen(abgebrochen(fehler.message)));
    });
    kind.on("close", (_status, signal) => {
      plaetze.laufend.delete(kind);
      return signal === null ? fertig(teile.join("")) : gescheitert(laeufeAbbrechen(abgebrochen(signal)));
    });
  });
}

function laufzeile(name, { dateien, eintraege, beginn }) {
  const sekunden = Math.round((Date.now() - beginn) / MS_JE_SEKUNDE);
  return `Testwirkung: ${name} ${dateien.length} Dateien ${eintraege.length} Tests ${sekunden} s`;
}

export async function testlaufGleichzeitig({ name, mitUebersprungenen = false, ...lauf }) {
  await platzBelegen();
  try {
    const { argumente, optionen } = aufruf(lauf);
    const beginn = Date.now();
    const eintraege = eintraegeAus(await ausgabeDes(argumente, optionen), optionen.cwd);
    berichteDauer(beginn);
    console.log(laufzeile(name, { dateien: lauf.dateien, eintraege, beginn }));
    return eintraege.filter(({ uebersprungen }) => mitUebersprungenen || !uebersprungen);
  } finally {
    platzFreigeben();
  }
}
