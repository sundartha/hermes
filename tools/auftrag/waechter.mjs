import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { DECKEL, Verlauf } from "./verlauf.mjs";

const EXIT_OHNE_STATUS = 1;
const MAX_FEHLERAUSGABE_ZEICHEN = 2000;
const GNADENFRIST_MS = 10_000;
const ABBRUCH_SIGNALE = ["SIGINT", "SIGTERM"];

async function liesEingang() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const stueck of process.stdin) text += stueck;
  return text;
}

let fruehesBeende = null;
let aufBeende = (grund) => {
  fruehesBeende ??= grund;
};
process.on("message", (befehl) => {
  if (befehl?.art === "beende") aufBeende(befehl.grund);
});
process.channel?.unref();

const { befehl, eingabe, kontextGrenze, vollstaendig } = JSON.parse(await liesEingang());
const [programm, ...argumente] = befehl;
const beiNachricht = process.send === undefined ? null : (groesse, zuvor) => process.connected && process.send({ nachricht: groesse, zuvor });
const verlauf = new Verlauf({ kontextGrenze, beiNachricht });
let kind = null;
let aktion = null;
let fehlerausgabe = "";

function signalisiere(signal) {
  if (kind === null) return false;
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

function schreibeErgebnis(exitCode) {
  process.stdout.write(JSON.stringify({ exitCode, aktion, fehlerausgabe, ...verlauf.zusammenfassung({ vollstaendig }) }));
}

function starteKind() {
  kind = spawn(programm, argumente, { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  aufBeende = (grund) => {
    if (verlauf.abgeschlossen || aktion !== null) return;
    aktion = { art: DECKEL, grund };
    beende();
  };
  beobachteKind();
}

function beobachteKind() {
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
    schreibeErgebnis(exitCode);
  });
}

if (fruehesBeende === null) {
  starteKind();
} else {
  aktion = { art: DECKEL, grund: fruehesBeende };
  schreibeErgebnis(EXIT_OHNE_STATUS);
}
