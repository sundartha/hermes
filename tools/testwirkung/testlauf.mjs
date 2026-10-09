import { spawn, spawnSync } from "node:child_process";
import { relative } from "node:path";
import { cwd, env } from "node:process";
import { fileURLToPath } from "node:url";

import { TESTGRUPPE } from "../testgruppe.mjs";

const TESTPARALLEL = 4;
const MS_JE_MINUTE = 60_000;
const ZEITGRENZE_MINUTEN = 10;
const MAX_AUSGABE = 268_435_456;
const MELDER = fileURLToPath(new URL("melder.mjs", import.meta.url));
const OHNE_PRUEFUNG = fileURLToPath(new URL("ohne-pruefung.mjs", import.meta.url));
export const UNTER_ATTRAPPE = ["--import", OHNE_PRUEFUNG];
const TESTKONTEXT = "NODE_TEST_CONTEXT";

function eintragIn(verzeichnis) {
  return (zeile) => {
    const { name, datei, bestanden, zeile: aufrufzeile, spalte } = JSON.parse(zeile);
    const pfad = datei?.startsWith("file:") ? fileURLToPath(datei) : (datei ?? "");
    return { datei: relative(verzeichnis, pfad), name, bestanden, zeile: aufrufzeile, spalte };
  };
}

function eigenstaendig() {
  const { [TESTKONTEXT]: _geerbt, ...umgebung } = env;
  return umgebung;
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

export function testlauf(lauf) {
  const { argumente, optionen } = aufruf(lauf);
  const beginn = Date.now();
  const ergebnis = spawnSync(process.execPath, argumente, { ...optionen, encoding: "utf8", maxBuffer: MAX_AUSGABE });
  berichteDauer(beginn);
  if (ergebnis.error !== undefined || ergebnis.signal !== null) throw abgebrochen(ergebnis.error?.message ?? ergebnis.signal);
  const zeilen = ergebnis.stdout.split("\n");
  return zeilen.filter(Boolean).map(eintragIn(optionen.cwd));
}

export function testlaufNebenher(lauf) {
  const { argumente, optionen } = aufruf(lauf);
  const beginn = Date.now();
  return new Promise((fertig, gescheitert) => {
    const kind = spawn(process.execPath, argumente, { ...optionen, stdio: "ignore" });
    kind.on("error", (fehler) => gescheitert(abgebrochen(fehler.message)));
    kind.on("exit", (_status, signal) => {
      berichteDauer(beginn);
      return signal === null ? fertig() : gescheitert(abgebrochen(signal));
    });
  });
}
