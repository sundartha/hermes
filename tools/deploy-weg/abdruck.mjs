import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { istFehler, kanonisch } from "./abdruck-wert.mjs";

const ERZEUGER = fileURLToPath(new URL("./abdruck-erzeugen.mjs", import.meta.url));
const ABLAGE = [".pruefung", "abdruck"];
const SEITEN = Object.freeze(["alt", "neu"]);
const ERZEUGER_SCHUTZGRENZE_MS = 120_000;
const GIT_SCHUTZGRENZE_MS = 60_000;
const COMMIT_MUSTER = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const TEILNAME_UNERLAUBT = /[^A-Za-z0-9_./:-]/g;
const TEILNAME_LAENGE = 120;
const FESTE_ZEITZONE = "UTC";
const OHNE_HAKEN = ["-c", "core.hooksPath=/dev/null"];

function grundUmgebung() {
  return { PATH: env.PATH ?? "" };
}

function gitUmgebung() {
  return {
    ...grundUmgebung(),
    ...(env.HOME ? { HOME: env.HOME } : {}),
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

function erzeugerUmgebung(datenOrdner) {
  return {
    ...grundUmgebung(),
    NODE_ENV: "test",
    DATA_DIR: datenOrdner,
    TZ: FESTE_ZEITZONE,
  };
}

function kindLauf(befehl, argumente, { cwd, env, schutzgrenzeMs, ausgabe = "ignore" }) {
  return new Promise((fertig) => {
    let text = "";
    const kind = spawn(befehl, argumente, {
      cwd,
      env,
      stdio: ["ignore", ausgabe, "ignore"],
      timeout: schutzgrenzeMs,
      killSignal: "SIGKILL",
    });
    kind.stdout?.on("data", (stueck) => (text += stueck));
    kind.on("error", () => fertig({ status: null, text: "" }));
    kind.on("close", (status) => fertig({ status, text }));
  });
}

async function git(repoDir, argumente, { ausgabe } = {}) {
  const lauf = await kindLauf("git", ["-C", repoDir, ...argumente], {
    env: gitUmgebung(),
    schutzgrenzeMs: GIT_SCHUTZGRENZE_MS,
    ausgabe,
  });
  if (lauf.status !== 0) throw new Error(`git ${argumente[0]} gescheitert`);
  return lauf.text.trim();
}

const COMMIT_ZIEL = "^{commit}";

async function commitVon(repoDir, commit) {
  if (typeof commit !== "string" || commit === "") throw new TypeError("Commit fehlt");
  const sha = await git(repoDir, ["rev-parse", "--verify", "--quiet", "--end-of-options", commit + COMMIT_ZIEL], {
    ausgabe: "pipe",
  });
  if (!COMMIT_MUSTER.test(sha)) throw new Error("Commit nicht eindeutig");
  return sha;
}

async function arbeitsbaumEntfernen(repoDir, baum) {
  try {
    await git(repoDir, ["worktree", "remove", "--force", "--force", baum]);
  } catch {
    await rm(baum, { recursive: true, force: true });
    await git(repoDir, ["worktree", "prune"]).catch(() => undefined);
  }
}

async function erzeugen({ baum, lauf }) {
  const daten = join(lauf, "daten");
  const ausgabe = join(lauf, "abdruck.json");
  await rm(daten, { recursive: true, force: true });
  await rm(ausgabe, { force: true });
  await mkdir(daten);
  const ende = await kindLauf(process.execPath, [ERZEUGER, baum, ausgabe], {
    cwd: baum,
    env: erzeugerUmgebung(daten),
    schutzgrenzeMs: ERZEUGER_SCHUTZGRENZE_MS,
  });
  if (ende.status !== 0) throw new Error("Erzeuger gescheitert");
  const abdruck = JSON.parse(await readFile(ausgabe, "utf8"));
  if (abdruck === null || typeof abdruck !== "object" || Array.isArray(abdruck)) throw new Error("Abdruck unlesbar");
  return abdruck;
}

async function abdruckFuer({ repoDir, sha, baum, lauf }) {
  if (!sha) return null;
  try {
    await git(repoDir, [...OHNE_HAKEN, "worktree", "add", "--detach", "--quiet", baum, sha]);
    return await erzeugen({ baum, lauf });
  } catch {
    return null;
  } finally {
    await arbeitsbaumEntfernen(repoDir, baum);
  }
}

function teilname(name) {
  return name.replace(TEILNAME_UNERLAUBT, "_").slice(0, TEILNAME_LAENGE);
}

function abweichendeTeile(alt, neu) {
  const namen = new Set([...Object.keys(alt), ...Object.keys(neu)]);
  return [...namen].filter((name) => kanonisch(alt[name]) !== kanonisch(neu[name]));
}

function abdrueckeVergleichen(abdruecke) {
  const teile = new Set();
  for (const seite of SEITEN) {
    const abdruck = abdruecke[seite];
    if (!abdruck || Object.values(abdruck).some(istFehler)) teile.add(`fehler:${seite}`);
  }
  if (abdruecke.alt && abdruecke.neu) {
    for (const name of abweichendeTeile(abdruecke.alt, abdruecke.neu)) teile.add(teilname(name));
  }
  const sortiert = [...teile].sort();
  return { geaendert: sortiert.length > 0, teile: sortiert };
}

async function shasVon(repoDir, commits) {
  const shas = {};
  for (const seite of SEITEN) shas[seite] = await commitVon(repoDir, commits[seite]).catch(() => null);
  return shas;
}

export async function gespraechVergleichen({ repoDir, alt, neu }) {
  const shas = await shasVon(repoDir, { alt, neu });
  if (!shas.alt && !shas.neu) return abdrueckeVergleichen({});
  let lauf;
  try {
    const ablage = join(repoDir, ...ABLAGE);
    await mkdir(ablage, { recursive: true });
    lauf = await mkdtemp(join(ablage, "lauf-"));
    const baum = join(lauf, "baum");
    const abdruecke = {};
    for (const seite of SEITEN) abdruecke[seite] = await abdruckFuer({ repoDir, sha: shas[seite], baum, lauf });
    return abdrueckeVergleichen(abdruecke);
  } catch {
    return abdrueckeVergleichen({});
  } finally {
    if (lauf) await rm(lauf, { recursive: true, force: true }).catch(() => undefined);
  }
}
