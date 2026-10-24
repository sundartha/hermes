import { writeSync } from "node:fs";
import { Socket } from "node:net";
import { isMainThread, Worker, workerData } from "node:worker_threads";

export const STDIN_FUER_ELTERNWAECHTER = "pipe";
const STDIN = 0;
const STDERR = 2;
const ROLLE_WAECHTER = "elternwaechter";

function beendeHart() {
  process.kill(process.pid, "SIGKILL");
}

function brichAb(fehler) {
  writeSync(STDERR, `Elternwächter ohne stdin-Pipe vom Elternprozess: ${fehler.message}\n`);
  beendeHart();
}

function wacheUeberStdin() {
  const leitung = new Socket({ fd: STDIN, readable: true, writable: false });
  leitung.on("error", brichAb);
  leitung.on("close", beendeHart);
  leitung.resume();
}

export function starteElternwaechter() {
  const waechter = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: ROLLE_WAECHTER,
  });
  waechter.on("error", brichAb);
  waechter.unref();
}

if (!isMainThread && workerData === ROLLE_WAECHTER) wacheUeberStdin();
