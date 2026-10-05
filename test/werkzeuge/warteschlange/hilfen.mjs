import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
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
const HTTP_OK = 200;
const HTTP_NICHT_DA = 404;
const FREMDE_UMGEBUNG = /^(?:GITHUB_|RUNNER_|GH_|TESTS_ZWEITER_LAUF$|TESTKOSTEN_DATEI$)/;
const BASIS_DATEIEN = {
  ".gitignore": ".pruefung/\nmerker.txt\n",
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
      "const eintrag = { args: process.argv.slice(2), token: process.env.GH_TOKEN };",
      "appendFileSync(process.env.ERSATZ_GH_PROTOKOLL, JSON.stringify(eintrag) + '\\n');",
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

export const CI_NUMMER = 11;
export const CI_ROUTE = [`GET ${API_PFAD}/actions/workflows/ci.yml`, { id: CI_NUMMER }];

export function ciEreignis(context, felder) {
  const workflowRun = {
    path: ".github/workflows/ci.yml",
    workflow_id: CI_NUMMER,
    head_repository: { full_name: REPO },
    html_url: `https://github.com/${REPO}/actions/runs/77`,
    id: 77,
    ...felder,
  };
  const ordner = probeDirectory(context, {
    "ereignis.json": JSON.stringify({ workflow_run: workflowRun }),
  });
  return join(ordner, "ereignis.json");
}

export function warteschlange(args, optionen) {
  return starteWerkzeug([WARTESCHLANGE, ...args], optionen);
}

const MAX_AUSGABE = 67_108_864;

export function starteWerkzeug(befehl, { cwd, umgebung } = {}) {
  const optionen = { cwd, env: saubereUmgebung(umgebung), maxBuffer: MAX_AUSGABE };
  return new Promise((fertig) => {
    execFile(process.execPath, befehl, optionen, (fehler, stdout, stderr) => {
      const status = fehler === null ? 0 : (fehler.code ?? 1);
      fertig({ status, stdout, stderr });
    });
  });
}

export function schreibAufrufe(anfragen) {
  return anfragen
    .filter(({ methode }) => methode !== "GET")
    .map(({ methode, pfad }) => `${methode} ${pfad}`);
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

async function rumpfVon(anfrage) {
  let text = "";
  for await (const stueck of anfrage) text += stueck;
  return text === "" ? null : JSON.parse(text);
}

export async function githubAttrappe(context, routen) {
  const anfragen = [];
  const server = createServer(async (anfrage, antwort) => {
    const pfad = new URL(anfrage.url, "http://attrappe").pathname;
    const eintrag = {
      methode: anfrage.method,
      pfad,
      rumpf: await rumpfVon(anfrage),
      token: (anfrage.headers.authorization ?? "").replace(/^Bearer /, ""),
    };
    anfragen.push(eintrag);
    const route = routen.get(`${eintrag.methode} ${pfad}`);
    const wert = typeof route === "function" ? route(eintrag) : route;
    antwort.writeHead(wert === undefined ? HTTP_NICHT_DA : HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify(wert ?? { message: "Not Found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, anfragen, graphql: `${url}/graphql` };
}

export const ROTER_TEST = "test/zahl.test.js";
export const ROTER_NAME = "ZAHL ist 2";
const ZAHL_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { ZAHL } from "../src/zahl.js";',
  `test(${JSON.stringify(ROTER_NAME)}, () => assert.equal(ZAHL, 2));`,
  "",
].join("\n");

export function kaputterMerge(context, { zweig = "zahl", zweiterCommit = {} } = {}) {
  const repo = wegwerfRepo(context, {
    "src/zahl.js": "export const ZAHL = 2;\n",
    [ROTER_TEST]: ZAHL_TEST,
  });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["checkout", "-q", "-b", zweig]);
  const erster = repo.committe({ "src/neu.js": "export const NEU = 1;\n" }, "Füge NEU hinzu");
  const zweiter = repo.committe(
    { "src/zahl.js": "export const ZAHL = 3;\n", ...zweiterCommit },
    "Setze ZAHL auf 3\n\nAuftrag: phase-zahl/a1",
  );
  repo.git(["checkout", "-q", "master"]);
  repo.git(["merge", "-q", "--ff-only", zweig]);
  repo.git(["push", "-q", "origin", "master"]);
  const pull = {
    number: 7,
    merged_at: "2026-10-05T12:00:00Z",
    base: { ref: "master" },
    head: { ref: zweig },
    merge_commit_sha: zweiter,
    commits: 2,
  };
  return { repo, basis, erster, zweiter, pull };
}

export function roteBelege(context, rot) {
  return probeDirectory(context, {
    "wackelig-teil-2/wackelig.json": JSON.stringify({ format: 1, wackelig: [], rot }),
  });
}
