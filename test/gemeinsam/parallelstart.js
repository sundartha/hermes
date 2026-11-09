import { spawn } from "node:child_process";

import { BASE_ENV, ROOT, tempDataDir } from "../helpers.js";
import { STDIN_FUER_ELTERNWAECHTER } from "./elternwaechter.mjs";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { gemeinsameUmgebung } from "./zwei-prozesse.js";

const LAEUFT_AUF = /laeuft auf http:\/\/localhost:\d+/;

function starteInstanz(t, umgebung) {
  const kind = spawn(process.execPath, ["test/helpers/server-mit-elternwaechter.mjs"], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, ...umgebung, DATA_DIR: tempDataDir() }),
    stdio: [STDIN_FUER_ELTERNWAECHTER, "pipe", "pipe"],
  });
  const ausgabe = { text: "" };
  const beendet = new Promise((fertig) => kind.once("exit", fertig));
  const bereit = new Promise((fertig) => {
    for (const strom of [kind.stdout, kind.stderr]) {
      strom.on("data", (teil) => {
        ausgabe.text += teil;
        if (LAEUFT_AUF.test(ausgabe.text)) fertig(true);
      });
    }
    void beendet.then(() => fertig(false));
  });
  t.after(async () => {
    if (kind.exitCode === null && kind.signalCode === null) {
      kind.kill("SIGCONT");
      kind.kill("SIGTERM");
    }
    await beendet;
  });
  return {
    ausgabe: () => ausgabe.text,
    bereit,
    anhalten: () => kind.kill("SIGSTOP"),
    fortsetzen: () => kind.kill("SIGCONT"),
  };
}

export function parallelStarten(t, adresse, umgebungen) {
  return umgebungen.map((env) => starteInstanz(t, gemeinsameUmgebung(adresse, env)));
}
