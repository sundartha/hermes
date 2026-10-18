import { spawn } from "node:child_process";
import { once } from "node:events";

const KEIN_PROZESS = "ESRCH";
const NUR_NOCH_ZOMBIES = "EPERM";

function nichtsMehrZuBeenden({ code }) {
  return code === KEIN_PROZESS || (code === NUR_NOCH_ZOMBIES && process.platform === "darwin");
}

function beendeGruppe(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (fehler) {
    if (!nichtsMehrZuBeenden(fehler)) throw fehler;
  }
}

export async function inEigenerGruppe(args, optionen) {
  const kind = spawn(process.execPath, args, { ...optionen, detached: true });
  const aufraeumen = () => beendeGruppe(kind.pid);
  process.once("exit", aufraeumen);
  try {
    const [exit] = await once(kind, "exit");
    return exit;
  } finally {
    process.removeListener("exit", aufraeumen);
    aufraeumen();
  }
}
