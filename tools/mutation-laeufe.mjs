import { spawn } from "node:child_process";

const ALS_EIGENE_PROZESSGRUPPE = { detached: true };
const PROZESS_SCHON_BEENDET = "ESRCH";
export const ABBRUCH_NACHFRIST_MS = 10_000;

function laeuftNoch(kind) {
  return kind.exitCode === null && kind.signalCode === null;
}

function signalisiere(kind, signal) {
  if (!laeuftNoch(kind)) return;
  try {
    process.kill(-kind.pid, signal);
  } catch (fehler) {
    if (fehler.code !== PROZESS_SCHON_BEENDET) throw fehler;
  }
}

export function starteLauf(argumente, optionen, laeufe) {
  const kind = spawn(process.execPath, argumente, { ...optionen, ...ALS_EIGENE_PROZESSGRUPPE });
  laeufe.add(kind);
  return new Promise((fertig) => kind.on("exit", (code) => fertig(laeufe.delete(kind) && code === 0)));
}

export function beendeRestlaeufe(laeufe) {
  for (const kind of laeufe) {
    signalisiere(kind, "SIGTERM");
    setTimeout(() => signalisiere(kind, "SIGKILL"), ABBRUCH_NACHFRIST_MS).unref();
  }
}
