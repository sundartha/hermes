import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { Verlauf, auftragsdateien } from "./verlauf.mjs";

const EXIT_OHNE_STATUS = 1;
const MAX_FEHLERAUSGABE_ZEICHEN = 2000;
const GNADENFRIST_MS = 10_000;
const ABBRUCH_SIGNALE = ["SIGINT", "SIGTERM"];

const { befehl, eingabe, auftrag, pruefleiter } = JSON.parse(readFileSync(0, "utf8"));
const [programm, ...argumente] = befehl;
const verlauf = new Verlauf(auftragsdateien(auftrag), pruefleiter);
const kind = spawn(programm, argumente, { detached: true, stdio: ["pipe", "pipe", "pipe"] });
let aktion = null;
let fehlerausgabe = "";

function signalisiere(signal) {
  try {
    process.kill(-kind.pid, signal);
    return true;
  } catch {
    return false;
  }
}

function beende() {
  signalisiere("SIGTERM");
  setTimeout(() => signalisiere("SIGKILL"), GNADENFRIST_MS).unref();
}

function merkeFehler(text) {
  fehlerausgabe = `${fehlerausgabe}${text}`.slice(-MAX_FEHLERAUSGABE_ZEICHEN);
}

for (const signal of ABBRUCH_SIGNALE) {
  process.on(signal, () => {
    beende();
    process.exit(EXIT_OHNE_STATUS);
  });
}

kind.on("error", (fehler) => merkeFehler(`${programm} ließ sich nicht ausführen: ${fehler.message}`));
kind.stdin.on("error", (fehler) => merkeFehler(fehler.message));
kind.stderr.on("data", (stueck) => merkeFehler(String(stueck)));
kind.stdin.end(eingabe);

createInterface({ input: kind.stdout }).on("line", (zeile) => {
  const neu = verlauf.lies(zeile);
  if (neu === null || aktion !== null) return;
  aktion = neu;
  beende();
});

kind.on("close", (code) => {
  const exitCode = code ?? EXIT_OHNE_STATUS;
  if (exitCode !== 0) verlauf.pruefeLimit(fehlerausgabe);
  process.stdout.write(JSON.stringify({ exitCode, aktion, fehlerausgabe, ...verlauf.zusammenfassung() }));
});
