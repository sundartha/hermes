import { writeSync } from "node:fs";
import { Socket } from "node:net";
import { isMainThread, Worker, workerData } from "node:worker_threads";

import { wacheUeberPpid } from "../../tools/mutationspruefung/ppid-waechter.mjs";

export const STDIN_FUER_ELTERNWAECHTER = "pipe";
const STDIN = 0;
const STDERR = 2;
const ROLLE_WAECHTER = "elternwaechter";
const ROLLE_PPID_WAECHTER = "elternwaechter-ppid";
const OHNE_STDIN_PIPE = "ohne stdin-Pipe vom Elternprozess";
const OHNE_PPID_ABFRAGE = "ohne ppid-Abfrage";

function beendeHart() {
  process.kill(process.pid, "SIGKILL");
}

function brichAb(grund, fehler) {
  writeSync(STDERR, `Elternwächter ${grund}: ${fehler.message}\n`);
  beendeHart();
}

function wacheUeberStdin() {
  const leitung = new Socket({ fd: STDIN, readable: true, writable: false });
  leitung.on("error", (fehler) => brichAb(OHNE_STDIN_PIPE, fehler));
  leitung.on("close", beendeHart);
  leitung.resume();
}

function starteWaechter(daten, grund) {
  const waechter = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: daten,
  });
  waechter.on("error", (fehler) => brichAb(grund, fehler));
  waechter.unref();
}

export function starteElternwaechter() {
  starteWaechter({ rolle: ROLLE_WAECHTER }, OHNE_STDIN_PIPE);
}

export function starteElternwaechterPerPpid(eltern) {
  starteWaechter({ rolle: ROLLE_PPID_WAECHTER, eltern }, OHNE_PPID_ABFRAGE);
}

if (!isMainThread && workerData?.rolle === ROLLE_WAECHTER) wacheUeberStdin();
if (!isMainThread && workerData?.rolle === ROLLE_PPID_WAECHTER) wacheUeberPpid(workerData.eltern, beendeHart);
