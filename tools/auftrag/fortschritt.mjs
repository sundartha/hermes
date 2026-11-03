import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env as prozessUmgebung } from "node:process";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";

import { neuerTempOrdner } from "../temp-ordner.mjs";

export const FORTSCHRITT_DATEI = "HERMES_FORTSCHRITT_DATEI";
const ARBEITER = new URL("./fortschritt-arbeiter.mjs", import.meta.url);
const ZEILENUMBRUCH = "\n";
const TAKT_MS = 1000;
const ANLAUF_MS = 60_000;
const NICHT_GESTARTET = 0;
const STANDARD = { zeige: (zeile) => console.error(zeile), taktMs: TAKT_MS, anlaufMs: ANLAUF_MS, arbeiter: ARBEITER };

export function schreibeFortschritt(zeile, ziel) {
  console.error(zeile);
  if (ziel) appendFileSync(ziel, zeile + ZEILENUMBRUCH);
}

function warteSynchron(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
}

function vollstaendigeZeilen(datei) {
  return (existsSync(datei) ? readFileSync(datei, "utf8") : "").split(ZEILENUMBRUCH).slice(0, -1);
}

function starteArbeiter(name, befehl, { arbeiter, ...optionen }) {
  const datei = join(neuerTempOrdner(), "fortschritt.log");
  writeFileSync(datei, "");
  const kanal = new MessageChannel();
  const gestartet = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const umgebung = { ...(optionen.env ?? prozessUmgebung), [FORTSCHRITT_DATEI]: datei };
  const argumente = [name, befehl, { ...optionen, env: umgebung }];
  new Worker(arbeiter, { workerData: { port: kanal.port2, argumente, gestartet }, transferList: [kanal.port2] }).unref();
  return { datei, kanal, gestartet };
}

function zeigeNeue(datei, gezeigt, zeige) {
  const zeilen = vollstaendigeZeilen(datei);
  for (const zeile of zeilen.slice(gezeigt)) zeige(zeile);
  return zeilen.length;
}

function nichtAngelaufen(gestartet, anlaufEnde) {
  return Atomics.load(gestartet, 0) === NICHT_GESTARTET && Date.now() > anlaufEnde;
}

export function fuehreAusMitFortschritt(name, befehl, optionen) {
  const { zeige, taktMs, anlaufMs, ...ausfuehrung } = { ...STANDARD, ...optionen };
  const { datei, kanal, gestartet } = starteArbeiter(name, befehl, ausfuehrung);
  const anlaufEnde = Date.now() + anlaufMs;
  let gezeigt = 0;
  let antwort = null;
  while (antwort === null) {
    warteSynchron(taktMs);
    antwort = receiveMessageOnPort(kanal.port1)?.message ?? null;
    gezeigt = zeigeNeue(datei, gezeigt, zeige);
    if (antwort === null && nichtAngelaufen(gestartet, anlaufEnde)) throw new Error(`${name}: der Arbeiter für die Fortschrittszeilen ist nach ${anlaufMs} ms nicht angelaufen`);
  }
  kanal.port1.close();
  if (antwort.fehler !== undefined) throw new Error(antwort.fehler);
  return antwort.ergebnis;
}
