import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { jobRestzeit } from "../../tools/auftrag/pruefer-befehle.mjs";
import {
  ANMELDUNG_GRUND,
  LIMIT_GRUND,
  ZEIT_GRUND,
  pruefeCommit,
  zeitgrenzeFuer,
} from "../../tools/auftrag/pruefer-lauf.mjs";
import { ohne } from "./neuschnitt-probe.js";
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
const ZUEGE_JE_COMMIT = "80";
const MACOS_ZUSATZ = "__CF_";
const LANGE_ZEILE = `export const TEXT = "${"x".repeat(6000)}";`;

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

async function pruefeMit(context, { aufnahme, liestDiffs, dateien, letzter = false, restzeit }) {
  const { repo, basis, commit: gewaehlt } = einCommit(context, dateien);
  const commit = { ...gewaehlt, letzter };
  const ersatz = ersatzPruefer(context, { aufnahme, liestDiffs });
  const kontext = {
    root: repo.ordner,
    basis,
    token: SCHEIN_TOKEN,
    programm: ersatz.programm,
    auftragstext: "",
    ciLauf: "",
    restzeit,
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
    `--max-turns ${ZUEGE_JE_COMMIT}`,
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

test("öffnet der Prüfer keine Diff-Datei mit Read, ist die Prüfung trotzdem geprueft, weil die Patches in seiner Eingabe stehen", async (context) => {
  const { ergebnis, protokoll } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    liestDiffs: false,
  });
  assert.equal(ergebnis.zustand, "geprueft");
  assert.match(protokoll.eingabe, /\+export const ZAHL = 2;/);
});

test("verdichtet die CLI den Kontext im Lauf, ist die Prüfung unvollstaendig, auch bei gültiger Antwort", async (context) => {
  const verdichtet = aufzeichnung("gueltig");
  verdichtet.zeilen.splice(-1, 0, {
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "auto" },
  });
  const { ergebnis } = await pruefeMit(context, { aufnahme: verdichtet });
  assert.deepEqual(
    [ergebnis.zustand, ergebnis.grund, ergebnis.befunde],
    ["unvollstaendig", "Kontext im Lauf verdichtet, Patch-Text nicht mehr sicher vollständig", []],
  );
});

test("eine Zeile mit 6000 Zeichen steht am letzten Commit ganz in der Eingabe, einmal aus diff/001.patch und einmal aus pr/gesamt.patch", async (context) => {
  const { ergebnis, protokoll } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    dateien: { "src/text.js": `${LANGE_ZEILE}\n` },
    letzter: true,
  });
  assert.equal(ergebnis.zustand, "geprueft");
  assert.equal(protokoll.eingabe.split(`+${LANGE_ZEILE}\n`).length - 1, 2);
  assert.match(protokoll.eingabe, / diff\/001\.patch\n/);
  assert.match(protokoll.eingabe, / pr\/gesamt\.patch\n/);
});

function blockAus(eingabe, name) {
  const [, kennung] = /\n<<<([0-9a-f]{16}) /.exec(eingabe);
  const kopf = `<<<${kennung} ${name}\n`;
  const anfang = eingabe.indexOf(kopf);
  if (anfang === -1) return null;
  const inhalt = eingabe.slice(anfang + kopf.length);
  return inhalt.slice(0, inhalt.indexOf(`\n${kennung}>>>\n`));
}

test("auftrag.md, ergebnisse.md und beide Referenzen stehen als ganze Blöcke in der Eingabe, der Prüfer muss sie nicht mit Read öffnen", async (context) => {
  const { ergebnis, protokoll } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    liestDiffs: false,
  });
  assert.equal(ergebnis.zustand, "geprueft");
  const auftrag = blockAus(protokoll.eingabe, "auftrag.md");
  assert.ok(auftrag.startsWith("# Auftragszettel\n"), auftrag);
  assert.ok(auftrag.includes(`## Commit ${ergebnis.sha}\n\nSetze die Zahl\n`));
  assert.ok(blockAus(protokoll.eingabe, "ergebnisse.md").startsWith("# Ergebnisse der Prüfbefehle\n"));
  for (const name of ["refs/sicherheitsgrenzen.md", "refs/clean-code.md"]) {
    assert.ok(blockAus(protokoll.eingabe, name)?.length > 0, name);
  }
});

test("steht ein Patch nicht byte-genau in der Eingabe, weil er kein gültiges UTF-8 ist, startet der Prüfer nicht und die Prüfung ist unvollstaendig", async (context) => {
  const { ergebnis, protokoll } = await pruefeMit(context, {
    aufnahme: aufzeichnung("gueltig"),
    dateien: { "src/latin1.txt": Buffer.from("Gr\xfc\xdfe\n", "latin1") },
  });
  assert.deepEqual(
    [ergebnis.zustand, ergebnis.grund, ergebnis.befunde],
    ["unvollstaendig", "nicht vollständig in der Eingabe: diff/001.patch", []],
  );
  assert.equal(protokoll, null);
});

test("ein Sicherheitsbefund wird vor dem Artefakt auf Schwere und Merker gekürzt", async (context) => {
  const { ergebnis } = await pruefeMit(context, { aufnahme: aufzeichnung("sicherheit") });
  assert.deepEqual(ergebnis.befunde[0], { sicherheit: true, schwere: "BLOCKER" });
  assert.equal(JSON.stringify({ ...ergebnis, ablage: undefined }).includes("GEHEIM"), false);
});

test("ein Sicherheits-BLOCKER ohne lokalen Schalter geht mit Beleg in die Ablage, das Artefakt behält nur Schwere und Merker", async (context) => {
  const { ergebnis } = await pruefeMit(context, { aufnahme: aufzeichnung("sicherheit") });
  assert.deepEqual(
    ergebnis.befunde.map(({ sicherheit, schwere, id }) => [sicherheit, schwere, id]),
    [[true, "BLOCKER", undefined], [false, "SOLLTE", "N7"]],
  );
  assert.equal(ergebnis.zaehler.BLOCKER, 1);
  assert.deepEqual(
    ergebnis.ablage.map(({ schwere, id, beleg }) => [schwere, id, beleg]),
    [["BLOCKER", "SG-3", "GEHEIMER-BELEG-91c2"]],
  );
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
    return ohne(ergebnis, "sha", "patchId");
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

async function pruefenMitAblage(context, ablageIn, aufnahme = aufzeichnung("sicherheitshinweis")) {
  const { repo, basis, commit } = einCommit(context);
  const ersatz = ersatzPruefer(context, { aufnahme });
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

const DATEIINHALT = "DATEIINHALT-5e1b";
const TEXTZUG_OHNE_WERKZEUG = 3;

function zug(nachricht, aufruf) {
  return { type: "assistant", message: { id: nachricht, role: "assistant", content: [aufruf] } };
}

function werkzeugAntwort(id) {
  return { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: DATEIINHALT }] } };
}

function mitWerkzeugaufrufen(aufnahme) {
  const { structured_output: antwort } = aufnahme.zeilen.at(-1);
  aufnahme.zeilen.splice(
    -1,
    0,
    zug("m1", { type: "tool_use", id: "g1", name: "Grep", input: { pattern: "ZAHL", path: "basis", glob: "*.js" } }),
    werkzeugAntwort("g1"),
    zug("m2", { type: "tool_use", id: "r1", name: "Read", input: { file_path: "auftrag.md", offset: 1, limit: 50 } }),
    zug("m2", { type: "tool_use", id: "g2", name: "Glob", input: { pattern: "dateien/**" } }),
    werkzeugAntwort("r1"),
    werkzeugAntwort("g2"),
    zug("m3", { type: "tool_use", id: "s1", name: "StructuredOutput", input: antwort }),
  );
  return aufnahme;
}

test("pruefen legt je Commit den Verlauf der Werkzeugaufrufe neben ergebnis.json, ohne Dateiinhalte und ohne Befundtext", async (context) => {
  const aufnahme = mitWerkzeugaufrufen(aufzeichnung("sicherheitshinweis"));
  const { lauf, commit, aus } = await pruefenMitAblage(context, false, aufnahme);
  assert.equal(lauf.status, 0, lauf.stderr);
  const text = readFileSync(join(aus, `verlauf-${commit.sha}.jsonl`), "utf8");
  assert.deepEqual(
    text.trimEnd().split("\n").map((zeile) => JSON.parse(zeile)),
    [
      { zug: 1, werkzeug: "Read", pfad: "diff/001.patch" },
      { zug: 2, werkzeug: "Read", pfad: "pr/gesamt.patch" },
      { zug: 4, werkzeug: "Grep", pfad: "basis", muster: "ZAHL", glob: "*.js" },
      { zug: 5, werkzeug: "Read", pfad: "auftrag.md", ab: 1, zeilen: 50 },
      { zug: 5, werkzeug: "Glob", muster: "dateien/**" },
      { zug: 6, werkzeug: "StructuredOutput" },
    ],
  );
  assert.equal(text.includes(`"zug":${TEXTZUG_OHNE_WERKZEUG},`), false);
  for (const geheim of [DATEIINHALT, "GEHEIMER-BELEG-91c2", "GEHEIME-REPARATUR-91c2", ROHAUSGABE]) {
    assert.equal(text.includes(geheim), false, geheim);
  }
});

test("sind die Züge aufgebraucht, liegt der Verlauf trotzdem im Artefakt, und ein Aufruf mit dem Token im Pfad fehlt darin", async (context) => {
  const aufnahme = aufzeichnung("max-zuege");
  aufnahme.zeilen.splice(
    -1,
    0,
    zug("m1", { type: "tool_use", id: "r1", name: "Read", input: { file_path: `basis/${SCHEIN_TOKEN}` } }),
    zug("m2", { type: "tool_use", id: "r2", name: "Read", input: { file_path: "auftrag.md" } }),
  );
  const { commit, aus } = await pruefenMitAblage(context, false, aufnahme);
  const ergebnis = JSON.parse(readFileSync(join(aus, "ergebnis.json"), "utf8"));
  assert.equal(ergebnis.commits[0].grund, "Züge aufgebraucht");
  const text = readFileSync(join(aus, `verlauf-${commit.sha}.jsonl`), "utf8");
  assert.equal(text.includes(SCHEIN_TOKEN), false);
  assert.ok(text.includes('"werkzeug":"Read","pfad":"auftrag.md"'), text);
});

test("pruefen bricht ab, wenn die Ablage im hochgeladenen Ordner --aus liegen soll", async (context) => {
  const { lauf, aus } = await pruefenMitAblage(context, true);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stderr, /Ablage darf nicht im Ordner --aus liegen/);
  assert.equal(existsSync(join(aus, "ergebnis.json")), false);
});

const MINUTE = 60_000;
const JOB_LIMIT = 360 * MINUTE;

function uhrBei(minuten) {
  return jobRestzeit({ start: 0, jetzt: () => minuten * MINUTE });
}

test("reicht die Restzeit des Prüfer-Jobs nicht für einen Commit, startet der Prüfer nicht und der Commit ist nicht_gelaufen mit eigenem Grund", async (context) => {
  const { ergebnis, protokoll } = await pruefeMit(context, { aufnahme: aufzeichnung("gueltig"), restzeit: uhrBei(350) });
  assert.deepEqual([ergebnis.zustand, ergebnis.grund], ["nicht_gelaufen", ZEIT_GRUND]);
  assert.equal(protokoll, null);
});

test("bei ausreichender Restzeit läuft der Commit, und seine Zeitgrenze ist nie größer als die Restzeit des Jobs", async (context) => {
  const { ergebnis } = await pruefeMit(context, { aufnahme: aufzeichnung("gueltig"), restzeit: uhrBei(0) });
  assert.equal(ergebnis.zustand, "geprueft");
  for (const minuten of [0, 200, 260, 280]) {
    const restzeit = uhrBei(minuten)();
    const grenze = zeitgrenzeFuer(restzeit);
    assert.ok(grenze !== null && grenze <= restzeit, `${minuten} min: ${grenze} > ${restzeit}`);
  }
  assert.ok(Number.isFinite(zeitgrenzeFuer(Infinity)));
});

test("die Restzeit rechnet ab dem Start des Laufs gegen das Job-Limit von 360 Minuten mit Reserve für Ablage und Auswertung", () => {
  const amStart = uhrBei(0)();
  assert.ok(amStart > 0 && amStart < JOB_LIMIT, String(amStart));
  assert.equal(amStart - uhrBei(100)(), 100 * MINUTE);
  assert.ok(uhrBei(360)() < 0);
});
