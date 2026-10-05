import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REPO_ROOT,
  RUNNER,
  commitAll,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  writeFiles,
} from "../probe-repo.js";

export const WARTESCHLANGE = join(REPO_ROOT, "tools/warteschlange.mjs");
export const REPO = "sundartha/hermes";
export const API_PFAD = `/repos/${REPO}`;
export const ZWEITER_LAUF = { TESTS_ZWEITER_LAUF: "ja" };
const AUSFUEHRBAR = 0o755;
const FREMDE_UMGEBUNG = /^(?:GITHUB_|RUNNER_|GH_|TESTS_ZWEITER_LAUF$|TESTKOSTEN_DATEI$)/;
const BASIS_DATEIEN = {
  "package.json": `${JSON.stringify({ name: "warteschlange-probe", type: "module" })}\n`,
  "tools/gate-tests.json": "{}\n",
};

export const PROBE_GIT = {
  GIT_AUTHOR_NAME: "Probe",
  GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "Probe",
  GIT_COMMITTER_EMAIL: "probe@example.invalid",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "core.hooksPath",
  GIT_CONFIG_VALUE_1: "/dev/null",
};

export function saubereUmgebung(zusatz = {}) {
  const geerbt = Object.entries(isolatedEnvironment()).filter(
    ([name]) => !FREMDE_UMGEBUNG.test(name),
  );
  return { ...Object.fromEntries(geerbt), ...zusatz };
}

function gitIn(ordner, args) {
  const lauf = spawnSync("git", args, {
    cwd: ordner,
    encoding: "utf8",
    env: saubereUmgebung(PROBE_GIT),
  });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

export function wegwerfRepo(context, dateien = {}) {
  const ordner = probeRepository(context, { ...BASIS_DATEIEN, ...dateien });
  const origin = probeDirectory(context, {});
  gitIn(origin, ["init", "-q", "--bare"]);
  gitIn(ordner, ["branch", "-M", "master"]);
  gitIn(ordner, ["remote", "add", "origin", origin]);
  gitIn(ordner, ["push", "-q", "origin", "master"]);
  const git = (args) => gitIn(ordner, args);
  return {
    ordner,
    origin,
    git,
    imOrigin: (args) => gitIn(origin, args),
    committe(neu, nachricht) {
      writeFiles(ordner, neu);
      commitAll(ordner, nachricht);
      return git(["rev-parse", "HEAD"]);
    },
  };
}

function zeilenAus(pfad) {
  if (!existsSync(pfad)) return [];
  return readFileSync(pfad, "utf8").split("\n").filter(Boolean);
}

export function ghErsatz(context, { exitCode = 0 } = {}) {
  const ordner = probeDirectory(context, {
    "gh.mjs": [
      "#!/usr/bin/env node",
      'import { appendFileSync } from "node:fs";',
      "appendFileSync(process.env.ERSATZ_GH_PROTOKOLL, JSON.stringify(process.argv.slice(2)) + '\\n');",
      `process.exitCode = ${exitCode};`,
      "",
    ].join("\n"),
  });
  const programm = join(ordner, "gh.mjs");
  chmodSync(programm, AUSFUEHRBAR);
  const protokoll = join(ordner, "gh.log");
  return {
    umgebung: { HERMES_GH: programm, ERSATZ_GH_PROTOKOLL: protokoll },
    aufrufe: () => zeilenAus(protokoll).map((zeile) => JSON.parse(zeile)),
  };
}

export function ausgabeDatei(context) {
  const pfad = join(probeDirectory(context, { "ausgabe.txt": "" }), "ausgabe.txt");
  const werte = () =>
    Object.fromEntries(
      zeilenAus(pfad).map((zeile) => [zeile.slice(0, zeile.indexOf("=")), zeile.slice(zeile.indexOf("=") + 1)]),
    );
  return { pfad, werte };
}

export function ereignis(context, workflowRun) {
  const ordner = probeDirectory(context, {
    "ereignis.json": JSON.stringify({ workflow_run: workflowRun }),
  });
  return join(ordner, "ereignis.json");
}

export async function warteschlange(args, { cwd, umgebung }) {
  const kind = spawn(process.execPath, [WARTESCHLANGE, ...args], {
    cwd,
    env: saubereUmgebung(umgebung),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ausgaben = { stdout: "", stderr: "" };
  kind.stdout.on("data", (stueck) => (ausgaben.stdout += stueck));
  kind.stderr.on("data", (stueck) => (ausgaben.stderr += stueck));
  const [status] = await once(kind, "close");
  return { status, ...ausgaben };
}

export function testlaeufer(ordner, umgebung = {}) {
  const lauf = spawnSync(process.execPath, [RUNNER, "regression"], {
    cwd: ordner,
    encoding: "utf8",
    env: saubereUmgebung({ NODE_ENV: "test", ...umgebung }),
  });
  const pfad = join(ordner, ".pruefung/wackelig.json");
  const wackelig = existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf8")) : null;
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}`, wackelig };
}

export function warteschlangenAttrappe(repo, eintraege) {
  const ergebnisse = [];
  for (const { name, commits } of eintraege) {
    repo.git(["checkout", "-q", "-B", `gh-readonly-queue/master/${name}`, "origin/master"]);
    for (const commit of commits) repo.git(["cherry-pick", "--allow-empty", commit]);
    const lauf = testlaeufer(repo.ordner, ZWEITER_LAUF);
    const uebernommen = lauf.status === 0;
    if (uebernommen) repo.git(["push", "-q", "origin", "HEAD:refs/heads/master"]);
    repo.git(["fetch", "-q", "origin"]);
    ergebnisse.push({ name, uebernommen, ...lauf });
  }
  return ergebnisse;
}
