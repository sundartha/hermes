import { writeSync } from "node:fs";
import { Socket } from "node:net";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { echtWarten } from "../echt-warten.js";
import { wacheUeberPpid } from "./ppid-waechter.mjs";

export const STDIN_FUER_ELTERNWAECHTER = "pipe";
const STDIN = 0;
const STDERR = 2;
const ROLLE_WAECHTER = "elternwaechter";
const ROLLE_PPID_WAECHTER = "elternwaechter-ppid";
const OHNE_STDIN_PIPE = "ohne stdin-Pipe vom Elternprozess";
const OHNE_PPID_ABFRAGE = "ohne ppid-Abfrage";
const ENDE = "ende";
const EXIT_SANFT = 143;
const SANFT_FRIST_MS = 3000;

function beendeHart() {
  process.kill(process.pid, "SIGKILL");
}

async function beendeSanft() {
  parentPort.postMessage(ENDE);
  await echtWarten(SANFT_FRIST_MS);
  beendeHart();
}

const beende = () => (workerData.sanft ? beendeSanft : beendeHart)();

function brichAb(grund, fehler) {
  writeSync(STDERR, `Elternwächter ${grund}: ${fehler.message}\n`);
  beendeHart();
}

function wacheUeberStdin() {
  const leitung = new Socket({ fd: STDIN, readable: true, writable: false });
  leitung.on("error", (fehler) => brichAb(OHNE_STDIN_PIPE, fehler));
  leitung.on("close", beende);
  leitung.resume();
}

function starteWaechter(daten, grund) {
  const waechter = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: daten,
  });
  waechter.on("error", (fehler) => brichAb(grund, fehler));
  waechter.on("message", () => process.exit(EXIT_SANFT));
  waechter.unref();
}

export function starteElternwaechter({ sanft = false } = {}) {
  starteWaechter({ rolle: ROLLE_WAECHTER, sanft }, OHNE_STDIN_PIPE);
}

export function starteElternwaechterPerPpid(eltern) {
  starteWaechter({ rolle: ROLLE_PPID_WAECHTER, eltern, sanft: true }, OHNE_PPID_ABFRAGE);
}

if (!isMainThread && workerData?.rolle === ROLLE_WAECHTER) wacheUeberStdin();
if (!isMainThread && workerData?.rolle === ROLLE_PPID_WAECHTER) wacheUeberPpid(workerData.eltern, beende);
