import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { setTimeout as warten } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const TESTGRUPPE = fileURLToPath(import.meta.url);
export const EXIT_PROZESS_UEBRIG = 3;

const ELTERN = process.ppid;
const ABBRUCHSIGNALE = ["SIGTERM", "SIGINT", "SIGHUP"];
const ELTERNABFRAGE_MS = 2000;
const AUSKLANG_MS = 5000;
const NACHFRIST_MS = 2000;
const ABFRAGE_MS = 50;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const KEIN_PROZESS = "ESRCH";
const PROZESSLISTE = ["-A", "-ww", "-o", "pid=,pgid=,stat=,command="];
const PROZESSZEILE = /^ *(\d+) +(\d+) +(\S+) +(.*)$/;
const ZOMBIE = "Z";
const MAX_AUSGABE = 268_435_456;
const ERSTES_ARGUMENT = 2;

function lebt(gruppe) {
  try {
    process.kill(-gruppe, 0);
    return true;
  } catch (fehler) {
    return fehler.code !== KEIN_PROZESS;
  }
}

function signalisiere(gruppe, signal) {
  try {
    process.kill(-gruppe, signal);
    return true;
  } catch {
    return false;
  }
}

async function geleert(gruppe, fristMs) {
  const ende = Date.now() + fristMs;
  while (lebt(gruppe) && Date.now() < ende) await warten(ABFRAGE_MS);
  return !lebt(gruppe);
}

async function beende(gruppe) {
  signalisiere(gruppe, "SIGTERM");
  if (await geleert(gruppe, NACHFRIST_MS)) return;
  signalisiere(gruppe, "SIGKILL");
  await geleert(gruppe, NACHFRIST_MS);
}

function mitglieder(gruppe) {
  const liste = spawnSync("ps", PROZESSLISTE, { encoding: "utf8", maxBuffer: MAX_AUSGABE });
  return (liste.stdout ?? "").split("\n").flatMap((zeile) => {
    const [, nummer, gruppennummer, zustand, kommando] = PROZESSZEILE.exec(zeile) ?? [];
    const dabei = Number(gruppennummer) === gruppe && !zustand.startsWith(ZOMBIE);
    return dabei ? [`${nummer} ${kommando}`] : [];
  });
}

async function reste(gruppe) {
  return (await geleert(gruppe, AUSKLANG_MS)) ? [] : mitglieder(gruppe);
}

function melde(uebrig) {
  for (const rest of uebrig)
    process.stderr.write(`Verstoß: Prozess nach dem Testlauf übrig: ${rest}\n`);
}

function nie() {
  return new Promise(() => {});
}

function waechter(abbrechen) {
  const halter = new Map(
    ABBRUCHSIGNALE.map((signal) => [
      signal,
      () => abbrechen(() => process.kill(process.pid, signal)),
    ]),
  );
  for (const [signal, funktion] of halter) process.on(signal, funktion);
  const abfrage = setInterval(() => {
    if (process.ppid !== ELTERN) abbrechen(() => process.exit(EXIT_ROT));
  }, ELTERNABFRAGE_MS);
  abfrage.unref();
  return () => {
    clearInterval(abfrage);
    for (const [signal, funktion] of halter) process.off(signal, funktion);
  };
}

export function gruppenlauf(argumente, optionen) {
  const kind = spawn(process.execPath, argumente, { ...optionen, detached: true });
  const gruppe = kind.pid;
  const zustand = { abgebrochen: false };
  const geschlossen = new Promise((fertig) => kind.on("close", fertig));
  const beendet = new Promise((fertig) =>
    kind.on("exit", (code, signal) => fertig({ code, signal })),
  );
  const aufhoeren = waechter((enden) => {
    if (zustand.abgebrochen) return;
    zustand.abgebrochen = true;
    beende(gruppe).then(() => {
      aufhoeren();
      enden();
    });
  });
  const ende = beendet.then(async ({ code, signal }) => {
    const uebrig = signal === null && !zustand.abgebrochen ? await reste(gruppe) : [];
    if (zustand.abgebrochen) return nie();
    melde(uebrig);
    await beende(gruppe);
    await geschlossen;
    aufhoeren();
    return { code: uebrig.length > 0 && code === EXIT_GRUEN ? EXIT_PROZESS_UEBRIG : code, signal };
  });
  return { kind, ende };
}

async function main() {
  const { ende } = gruppenlauf(process.argv.slice(ERSTES_ARGUMENT), { stdio: "inherit" });
  const { code, signal } = await ende;
  if (signal === null) process.exit(code);
  process.kill(process.pid, signal);
}

function direktGestartet() {
  try {
    return realpathSync(process.argv[1]) === TESTGRUPPE;
  } catch {
    return false;
  }
}

if (direktGestartet()) main();
