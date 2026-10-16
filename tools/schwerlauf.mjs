import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import process, { argv } from "node:process";
import { setTimeout as warte } from "node:timers/promises";
import { parseArgs } from "node:util";

import { nimmSperreAuchFuerKindprozesse, stand } from "./schwerlauf/sperre.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const EXIT_FRIST = 124;
const TRENNER = "--";
const ERSTES_ARGUMENT = 2;
const MS_PRO_SEKUNDE = 1000;
const SEKUNDEN = /^[1-9]\d*$/;
const NACHFRIST_MS = 3000;
const KEIN_PROZESS = "ESRCH";
const WEITERGEREICHTE_SIGNALE = ["SIGINT", "SIGTERM", "SIGHUP"];
const OPTIONEN = {
  stand: { type: "boolean", default: false },
  allein: { type: "boolean", default: false },
  frist: { type: "string" },
};
const AUFRUF =
  "Aufruf: node tools/schwerlauf.mjs [--allein] [--frist <sekunden ab Erhalt des Platzes>] -- <befehl> [<argument> ...] | --stand";

function optionenAus(vorne) {
  try {
    return parseArgs({ args: vorne, options: OPTIONEN }).values;
  } catch {
    return null;
  }
}

function gueltigeFrist(frist) {
  return frist === undefined || SEKUNDEN.test(frist);
}

function aufruf(argumente) {
  const trenner = argumente.indexOf(TRENNER);
  const vorne = trenner === -1 ? argumente : argumente.slice(0, trenner);
  const [befehl, ...rest] = trenner === -1 ? [] : argumente.slice(trenner + 1);
  const values = optionenAus(vorne);
  if (values === null) return null;
  if (values.stand) return trenner === -1 && vorne.length === 1 ? { stand: true } : null;
  if (befehl === undefined || !gueltigeFrist(values.frist)) return null;
  return { allein: values.allein, frist: values.frist === undefined ? undefined : Number(values.frist), befehl, rest };
}

function signalAnGruppe(kind, signal) {
  try {
    process.kill(-kind.pid, signal);
  } catch (fehler) {
    if (fehler.code !== KEIN_PROZESS) throw fehler;
  }
}

function reicheSignaleWeiter(kind) {
  const weiter = WEITERGEREICHTE_SIGNALE.map((signal) => [signal, () => signalAnGruppe(kind, signal)]);
  for (const [signal, handler] of weiter) process.on(signal, handler);
  return () => {
    for (const [signal, handler] of weiter) process.off(signal, handler);
  };
}

async function beendeGruppe(kind) {
  signalAnGruppe(kind, "SIGTERM");
  await warte(NACHFRIST_MS);
  signalAnGruppe(kind, "SIGKILL");
}

async function laufeMitFrist(befehl, rest, frist) {
  const kind = spawn(befehl, rest, { stdio: "inherit", detached: true });
  const beendet = once(kind, "exit");
  const aufraeumen = reicheSignaleWeiter(kind);
  const abgelaufen = Symbol("abgelaufen");
  const uhr = new AbortController();
  try {
    const ergebnis = await Promise.race([beendet, warte(frist * MS_PRO_SEKUNDE, abgelaufen, { signal: uhr.signal })]);
    if (ergebnis !== abgelaufen) return { status: ergebnis[0] };
    await beendeGruppe(kind);
    await beendet;
    return { abgelaufen: true };
  } finally {
    uhr.abort();
    aufraeumen();
  }
}

function laufe(befehl, rest, frist) {
  if (frist === undefined) return spawnSync(befehl, rest, { stdio: "inherit" });
  return laufeMitFrist(befehl, rest, frist);
}

async function main(argumente) {
  const auftrag = aufruf(argumente);
  if (auftrag === null) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  if (auftrag.stand) {
    console.log(await stand());
    return 0;
  }
  const { allein, frist, befehl, rest } = auftrag;
  const anlass = [befehl, ...rest].join(" ");
  await nimmSperreAuchFuerKindprozesse(anlass, { allein });
  const lauf = await laufe(befehl, rest, frist);
  if (lauf.abgelaufen) {
    console.error(`Frist von ${frist} s ab Erhalt des Platzes abgelaufen, der Lauf wurde beendet: ${anlass}`);
    return EXIT_FRIST;
  }
  if (lauf.error) throw lauf.error;
  return lauf.status ?? EXIT_ABBRUCH;
}

try {
  process.exitCode = await main(argv.slice(ERSTES_ARGUMENT));
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
