import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BASE_ENV, ROOT, startServer, tempDataDir } from "../helpers.js";
import { STDIN_FUER_ELTERNWAECHTER } from "./elternwaechter.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import { gemeinsameUmgebung } from "./zwei-prozesse.js";

export const VORGAENGER_VARIABLE = "HERMES_VORGAENGER_COMMIT";
const STARTUP_TIMEOUT_MS = 30_000;
const GIT_PUFFER_BYTES = 512 * 1024 * 1024;
const BASIS_REFS = ["upstream/master", "origin/master"];
const LOCK_DATEI = "package-lock.json";
const MODULE_ORDNER = "node_modules";
const MODULE_CACHE = ".cache";
const ELTERNWAECHTER_DATEI = path.join(ROOT, "test", "gemeinsam", "elternwaechter.mjs");

function git(verzeichnis, ...argumente) {
  return execFileSync("git", argumente, { cwd: verzeichnis, encoding: "utf8" }).trim();
}

function ersterErfolg(versuche) {
  for (const versuch of versuche) {
    try {
      return versuch();
    } catch {
      continue;
    }
  }
  return null;
}

function commitBestimmen(repo, festgelegt) {
  const kopf = git(repo, "rev-parse", "HEAD");
  if (festgelegt) return git(repo, "rev-parse", "--verify", `${festgelegt}^{commit}`);
  const basis = ersterErfolg(BASIS_REFS.map((ref) => () => git(repo, "merge-base", "HEAD", ref)));
  if (!basis) throw new Error(`kein Ref aus ${BASIS_REFS.join(", ")}`);
  return basis === kopf ? git(repo, "rev-parse", "HEAD^1") : basis;
}

export function vorgaengerCommit({
  repo = ROOT,
  festgelegt = process.env[VORGAENGER_VARIABLE],
} = {}) {
  try {
    return commitBestimmen(repo, festgelegt);
  } catch (fehler) {
    throw new Error(
      `Vorgänger nicht bestimmbar, ${VORGAENGER_VARIABLE} auf einen gültigen Commit setzen: ${fehler.message}`,
      { cause: fehler },
    );
  }
}

function entpacken(commit, ziel) {
  const archiv = execFileSync("git", ["archive", "--format=tar", commit], {
    cwd: ROOT,
    maxBuffer: GIT_PUFFER_BYTES,
  });
  execFileSync("tar", ["-x", "--exclude=.env*", "-C", ziel], {
    input: archiv,
    maxBuffer: GIT_PUFFER_BYTES,
  });
}

function hashVon(datei) {
  return createHash("sha256").update(fs.readFileSync(datei)).digest("hex");
}

function offlineInstallieren(wurzel) {
  execFileSync("npm", ["ci", "--offline", "--ignore-scripts"], { cwd: wurzel, stdio: "ignore" });
}

export function abhaengigkeitenBereitstellen(
  wurzel,
  { quelle = ROOT, installieren = offlineInstallieren } = {},
) {
  const ziel = path.join(wurzel, MODULE_ORDNER);
  if (hashVon(path.join(quelle, LOCK_DATEI)) !== hashVon(path.join(wurzel, LOCK_DATEI))) {
    installieren(wurzel);
    return;
  }
  fs.mkdirSync(ziel);
  for (const eintrag of fs.readdirSync(path.join(quelle, MODULE_ORDNER))) {
    if (eintrag === MODULE_CACHE) continue;
    fs.symlinkSync(path.join(quelle, MODULE_ORDNER, eintrag), path.join(ziel, eintrag));
  }
}

function startSkript() {
  return [
    `const { starteElternwaechter } = await import(${JSON.stringify(pathToFileURL(ELTERNWAECHTER_DATEI).href)});`,
    "starteElternwaechter();",
    'await import("./src/server.js");',
  ].join("\n");
}

function aufPortWarten(child, ausgabe) {
  return new Promise((resolve, reject) => {
    const frist = AbortSignal.timeout(STARTUP_TIMEOUT_MS);
    frist.addEventListener("abort", () =>
      reject(new Error(`Vorgänger-Start Timeout. Output:\n${ausgabe.text}`)),
    );
    const pruefen = () => {
      const treffer = ausgabe.text.match(/laeuft auf http:\/\/localhost:(\d+)/);
      if (!treffer) return;
      child.stdout.off("data", pruefen);
      resolve(Number.parseInt(treffer[1], 10));
    };
    child.stdout.on("data", pruefen);
    child.on("exit", (code) => {
      reject(new Error(`Vorgänger vorzeitig beendet (code ${code}). Output:\n${ausgabe.text}`));
    });
  });
}

export const WURZEL_PRAEFIX = "hermes-vorgaenger-";

export async function vorgaengerStarten(t, { adresse, env = {}, festgelegt }) {
  const commit = vorgaengerCommit(festgelegt === undefined ? {} : { festgelegt });
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), WURZEL_PRAEFIX));
  let child = null;
  const entfernen = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const beendet = new Promise((fertig) => child.once("exit", fertig));
      child.kill("SIGTERM");
      await beendet;
    }
    await fs.promises.rm(wurzel, { recursive: true, force: true });
  };
  t.after(entfernen);
  try {
    entpacken(commit, wurzel);
    abhaengigkeitenBereitstellen(wurzel);
    const dataDir = tempDataDir();
    const umgebung = {
      PATH: process.env.PATH,
      ...BASE_ENV,
      ...gemeinsameUmgebung(adresse, env),
      DATA_DIR: dataDir,
    };
    child = spawn(process.execPath, ["--input-type=module", "-e", startSkript()], {
      cwd: wurzel,
      env: umgebung,
      stdio: [STDIN_FUER_ELTERNWAECHTER, "pipe", "pipe"],
    });
    const ausgabe = { text: "" };
    for (const kanal of [child.stdout, child.stderr])
      kanal.on("data", (d) => (ausgabe.text += d.toString()));
    const port = await aufPortWarten(child, ausgabe);
    return vorgaengerProzess({
      port,
      child,
      wurzel,
      commit,
      dataDir,
      umgebung,
      ausgabe,
      entfernen,
    });
  } catch (fehler) {
    await entfernen();
    fehler.wurzel = wurzel;
    throw fehler;
  }
}

function vorgaengerProzess({ port, child, wurzel, commit, dataDir, umgebung, ausgabe, entfernen }) {
  return {
    port,
    localUrl: `http://localhost:${port}`,
    child,
    wurzel,
    commit,
    dataDir,
    umgebung,
    get stdout() {
      return ausgabe.text;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const beendet = new Promise((fertig) => child.once("exit", fertig));
      child.kill("SIGTERM");
      await beendet;
    },
    entfernen,
  };
}

export async function neuStarten(t, env = {}) {
  let neu = null;
  t.after(() => neu?.stop());
  const db = await echteDatenbank(t);
  if (!db) return null;
  neu = await startServer({ env: gemeinsameUmgebung(db.adresse, env) });
  return { db, neu };
}

export async function neuUndVorgaenger(t, env = {}) {
  const neuer = await neuStarten(t, env);
  if (!neuer) return null;
  const vorgaenger = await vorgaengerStarten(t, { adresse: neuer.db.adresse, env });
  return { ...neuer, vorgaenger };
}
