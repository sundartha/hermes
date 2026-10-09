import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { ANMELDUNG_GRUND, LIMIT_GRUND, pruefeCommit } from "../../tools/auftrag/pruefer-lauf.mjs";
import { isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import {
  SCHEIN_TOKEN,
  WORKFLOW_NUMMERN,
  aufzeichnung,
  ciLauf,
  ereignisDatei,
  ersatzPruefer,
  ohneGitVariablen,
  probeRepo,
  scheinGithub,
  starteEinstieg,
} from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const NACHRICHT = "Setze die Zahl\n\nWarum: Auftrag a1.\n\nAuftrag: probe/a1\n";
const ROHAUSGABE = "ROHAUSGABE-7f3a";
const AUSFUEHRBAR = 0o755;
const PR_NUMMER = 7;
const ISSUE_NUMMER = 41;
const ZUEGE_EINE_DATEI = "14";
const MACOS_ZUSATZ = "__CF_";

function einCommit(context, dateien = { "src/zahl.js": "export const ZAHL = 2;\n" }) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe(dateien, NACHRICHT);
  const [commit] = zuPruefendeCommits({
    basis,
    head: repo.git(["rev-parse", "HEAD"]),
    branch: "fix/zahl",
    root: repo.ordner,
  }).commits;
  return { repo, basis, commit };
}

async function pruefeMit(context, { aufnahme, liestDiffs, dateien }) {
  const { repo, commit } = einCommit(context, dateien);
  const ersatz = ersatzPruefer(context, { aufnahme, liestDiffs });
  const kontext = {
    root: repo.ordner,
    token: SCHEIN_TOKEN,
    programm: ersatz.programm,
    auftragstext: "",
    ciLauf: "",
  };
  return { ergebnis: await pruefeCommit(commit, kontext), protokoll: ersatz.protokoll() };
}

test("eine gültige Antwort ergibt geprueft mit allen Befunden; der Prüfer bekommt nur PATH, HOME und das Token", async (context) => {
  process.env.CLAUDE_CODE_EFFORT_LEVEL = "low";
  const { ergebnis, protokoll } = await pruefeMit(context, { aufnahme: aufzeichnung("gueltig") });
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
  assert.equal(ergebnis.zustand, "geprueft");
  assert.deepEqual(
    ergebnis.befunde.map(({ schwere, id }) => [schwere, id]),
    [
      ["BLOCKER", "G5"],
      ["SOLLTE", "N7"],
    ],
  );
  assert.match(ergebnis.befunde[0].reproduktion, /assert\.equal\(ZAHL, 2\)/);
  const namen = Object.keys(protokoll.umgebung).filter((name) => !name.startsWith(MACOS_ZUSATZ));
  assert.deepEqual(namen.sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "PATH"]);
  assert.equal(protokoll.umgebung.CLAUDE_CODE_OAUTH_TOKEN, SCHEIN_TOKEN);
  const argumente = protokoll.argumente.join(" ");
  for (const teil of [
    "-p --restricted --tools Read,Grep,Glob",
    "--model opus --effort medium",
    `--max-turns ${ZUEGE_EINE_DATEI}`,
  ]) {
    assert.ok(argumente.includes(teil), teil);
  }
  assert.ok(
    protokoll.dateien.includes("diff/001.patch") &&
      protokoll.dateien.includes("dateien/src/zahl.js"),
  );
  assert.ok(
    ["auftrag.md", "ergebnisse.md", "refs/clean-code.md", "refs/sicherheitsgrenzen.md"].every(
      (name) => protokoll.dateien.includes(name),
    ),
  );
  assert.equal(existsSync(protokoll.ordner), false);
});

test("Nutzungslimit, abgelaufenes Token und aufgebrauchte Züge ergeben nicht_gelaufen mit Grund", async (context) => {
  const faelle = [
    ["limit", LIMIT_GRUND],
    ["anmeldung", ANMELDUNG_GRUND],
    ["max-zuege", "Züge aufgebraucht"],
  ];
  for (const [name, grund] of faelle) {
    const { ergebnis } = await pruefeMit(context, { aufnahme: aufzeichnung(name) });
    assert.deepEqual(
      [ergebnis.zustand, ergebnis.grund, ergebnis.befunde],
      ["nicht_gelaufen", grund, []],
      name,
    );
  }
});

test("wurde eine Diff-Datei nie mit Read geöffnet, ist die Prüfung unvollstaendig", async (context) => {
  const { ergebnis } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    liestDiffs: false,
  });
  assert.deepEqual(
    [ergebnis.zustand, ergebnis.grund, ergebnis.befunde],
    ["unvollstaendig", "nicht gelesen: diff/001.patch", []],
  );
});

test("ein Sicherheitsbefund wird vor dem Artefakt auf Schwere und Merker gekürzt", async (context) => {
  const { ergebnis } = await pruefeMit(context, { aufnahme: aufzeichnung("sicherheit") });
  assert.deepEqual(ergebnis.befunde[0], { sicherheit: true, schwere: "BLOCKER" });
  assert.equal(JSON.stringify(ergebnis).includes("GEHEIM"), false);
});

test("das Feld urteil ändert das Ergebnis eines Commits nicht", async (context) => {
  const gueltig = aufzeichnung("gueltig");
  const bestanden = structuredClone(gueltig);
  const { structured_output: antwort } = bestanden.zeilen.at(-1);
  antwort.urteil = "BESTANDEN";
  const [rot, gruen] = [
    await pruefeMit(context, { aufnahme: gueltig }),
    await pruefeMit(context, { aufnahme: bestanden }),
  ];
  const ohneSha = ({ ergebnis }) => {
    const { sha: _sha, patchId: _patchId, ...rest } = ergebnis;
    return rest;
  };
  assert.deepEqual(ohneSha(gruen), ohneSha(rot));
});

test("der Arbeitsordner enthält kein .claude/, kein CLAUDE.md und keine .mcp.json, auch wenn der Commit sie ändert", async (context) => {
  const dateien = {
    ".claude/settings.json": '{"hooks":{}}\n',
    "CLAUDE.md": "Regeln\n",
    ".mcp.json": "{}\n",
    "src/zahl.js": "export const ZAHL = 2;\n",
  };
  const { ergebnis, protokoll } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    dateien,
  });
  const heikel = protokoll.dateien.filter((name) =>
    name.split("/").some((teil) => [".claude", "CLAUDE.md", ".mcp.json"].includes(teil)),
  );
  assert.deepEqual(heikel, []);
  assert.ok(protokoll.dateien.includes("dateien/_.claude/settings.json"));
  assert.equal(ergebnis.zustand, "geprueft");
});

test("ein kritischer Commit läuft mit dem höchsten Denkaufwand", async (context) => {
  const { protokoll } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    dateien: { "src/telephony/anruf.js": "x\n" },
  });
  assert.ok(protokoll.argumente.join(" ").includes("--effort max"));
});

function gitMitProtokoll(context) {
  const echt = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const ordner = probeDirectory(context, {});
  const protokoll = join(ordner, "git-umgebungen.txt");
  writeFileSync(
    join(ordner, "git"),
    `#!/bin/sh\nenv >> ${JSON.stringify(protokoll)}\nexec ${JSON.stringify(echt)} "$@"\n`,
  );
  chmodSync(join(ordner, "git"), AUSFUEHRBAR);
  return { ordner, protokoll };
}

test("pruefen schreibt nur Zählwerte ins Log, und das Token erreicht nur den Prüfer, keinen anderen Kindprozess", async (context) => {
  const { repo, basis, commit } = einCommit(context);
  const ersatz = ersatzPruefer(context, { aufnahme: aufzeichnung("gueltig") });
  const pr = {
    number: PR_NUMMER,
    state: "open",
    head: { sha: commit.sha },
    base: { sha: basis, ref: "master" },
    body: `Closes #${ISSUE_NUMMER}`,
  };
  const github = await scheinGithub(
    context,
    new Map([
      [`GET /repos/sundartha/hermes/commits/${commit.sha}/pulls`, [pr]],
      [
        `GET /repos/sundartha/hermes/issues/${ISSUE_NUMMER}`,
        { title: "Zahl auf 2", body: "Fertig heißt: ZAHL ist 2." },
      ],
      ["GET /repos/sundartha/hermes/actions/artifacts", { artifacts: [] }],
      [
        "GET /repos/sundartha/hermes/actions/workflows/ci.yml",
        { id: WORKFLOW_NUMMERN.get("ci.yml") },
      ],
    ]),
  );
  const git = gitMitProtokoll(context);
  const aus = probeDirectory(context, {});
  const umgebung = {
    ...isolatedEnvironment(),
    PATH: `${git.ordner}:${process.env.PATH}`,
    HERMES_CLAUDE: ersatz.programm,
    CLAUDE_CODE_OAUTH_TOKEN: SCHEIN_TOKEN,
    GH_TOKEN: "gh-schein",
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_EVENT_PATH: ereignisDatei(context, ciLauf()),
  };
  const args = [
    "pruefer",
    "pruefen",
    "--head",
    commit.sha,
    "--pr-branch",
    "fix/zahl",
    "--aus",
    aus,
  ];
  const lauf = await starteEinstieg(args, { cwd: repo.ordner, umgebung });
  assert.equal(lauf.status, 0, lauf.stderr);
  const ergebnis = JSON.parse(readFileSync(join(aus, "ergebnis.json"), "utf8"));
  assert.deepEqual(
    [ergebnis.pr, ergebnis.head, ergebnis.commits[0].zustand],
    [PR_NUMMER, commit.sha, "geprueft"],
  );
  assert.match(lauf.stdout, /Befunde BLOCKER 1, SOLLTE 1, HINWEIS 0/);
  assert.equal(`${lauf.stdout}${lauf.stderr}`.includes(ROHAUSGABE), false);
  assert.equal(`${lauf.stdout}${lauf.stderr}`.includes("ZAHL ist 1"), false);
  assert.equal(ersatz.protokoll().umgebung.CLAUDE_CODE_OAUTH_TOKEN, SCHEIN_TOKEN);
  assert.match(ersatz.protokoll().eingabe, /diff\/001\.patch/);
  const gitUmgebungen = readFileSync(git.protokoll, "utf8");
  assert.ok(gitUmgebungen.includes("GH_TOKEN=gh-schein"));
  assert.equal(gitUmgebungen.includes(SCHEIN_TOKEN), false);
});

async function pruefenMitAblage(context, ablageIn) {
  const { repo, basis, commit } = einCommit(context);
  const ersatz = ersatzPruefer(context, { aufnahme: aufzeichnung("sicherheitshinweis") });
  const pr = { number: PR_NUMMER, state: "open", head: { sha: commit.sha }, base: { sha: basis, ref: "master" }, body: "" };
  const github = await scheinGithub(
    context,
    new Map([
      [`GET /repos/sundartha/hermes/commits/${commit.sha}/pulls`, [pr]],
      ["GET /repos/sundartha/hermes/actions/artifacts", { artifacts: [] }],
      ["GET /repos/sundartha/hermes/actions/workflows/ci.yml", { id: WORKFLOW_NUMMERN.get("ci.yml") }],
    ]),
  );
  const werkzeug = probeDirectory(context, { "ausgabe.txt": "" });
  const aus = join(werkzeug, "ergebnis");
  const umgebung = {
    ...isolatedEnvironment(),
    HERMES_CLAUDE: ersatz.programm,
    CLAUDE_CODE_OAUTH_TOKEN: SCHEIN_TOKEN,
    GH_TOKEN: "gh-schein",
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_EVENT_PATH: ereignisDatei(context, ciLauf()),
    GITHUB_OUTPUT: join(werkzeug, "ausgabe.txt"),
  };
  const ablage = join(ablageIn ? aus : werkzeug, "ablage");
  const args = ["pruefer", "pruefen", "--head", commit.sha, "--pr-branch", "fix/zahl", "--aus", aus, "--ablage", ablage];
  const lauf = await starteEinstieg(args, { cwd: repo.ordner, umgebung });
  return { lauf, commit, aus, ablage, ausgabe: join(werkzeug, "ausgabe.txt") };
}

test("pruefen legt Sicherheitshinweise mit Details nur in die Ablage, das Artefakt bekommt Schwere und Merker", async (context) => {
  const { lauf, commit, aus, ablage, ausgabe } = await pruefenMitAblage(context, false);
  assert.equal(lauf.status, 0, lauf.stderr);
  const artefakt = readFileSync(join(aus, "ergebnis.json"), "utf8");
  assert.equal(artefakt.includes("GEHEIM"), false);
  const [{ befunde }] = JSON.parse(artefakt).commits;
  assert.deepEqual(befunde[0], { sicherheit: true, schwere: "SOLLTE" });
  assert.equal(befunde[1].id, "N7");
  const { hinweise } = JSON.parse(readFileSync(join(ablage, "sicherheitshinweise.json"), "utf8"));
  assert.deepEqual(
    hinweise.map(({ sha, befund }) => [sha, befund.schwere, befund.beleg]),
    [[commit.sha, "SOLLTE", "GEHEIMER-BELEG-91c2"]],
  );
  assert.equal(readFileSync(ausgabe, "utf8"), "hinweise=1\n");
});

test("pruefen bricht ab, wenn die Ablage im hochgeladenen Ordner --aus liegen soll", async (context) => {
  const { lauf, aus } = await pruefenMitAblage(context, true);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stderr, /Ablage darf nicht im Ordner --aus liegen/);
  assert.equal(existsSync(join(aus, "ergebnis.json")), false);
});
