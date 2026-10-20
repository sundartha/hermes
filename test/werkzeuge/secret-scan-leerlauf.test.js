import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  commitAll,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";
import { workflowStepLines } from "./workflow-dateien.js";

const WORKFLOW = "ci.yml";
const SCHRITT = "Secret-Scan";
const SKRIPT_ANFANG = "        run: |";
const SKRIPT_EINZUG = 10;
const UNBEKANNTER_COMMIT = "f".repeat(40);

const GIT_FEHLER = [
  "6:37AM ERR [git] fatal: ambiguous argument 'x..y': unknown revision or path not in the working tree.",
  '6:37AM ERR error="stderr is not empty"',
  "6:37AM INF 0 commits scanned.",
  "6:37AM INF scanned ~0 bytes (0) in 79.3ms",
  "6:37AM INF no leaks found",
].join("\n");
const commitsGelesen = (anzahl) =>
  [
    `6:37AM INF ${anzahl} commits scanned.`,
    "6:37AM INF scanned ~6 bytes (6 bytes) in 82.9ms",
    "6:37AM INF no leaks found",
  ].join("\n");
const NICHTS_GELESEN = commitsGelesen(0);
const EIN_COMMIT_GELESEN = commitsGelesen(1);
const FUND = [
  "Finding:     AWS=REDACTED",
  "RuleID:      aws-access-token",
  "6:37AM INF 1 commits scanned.",
  "6:37AM WRN leaks found: 1",
].join("\n");
const OHNE_ZAEHLUNG = "6:37AM INF no leaks found";

const ATTRAPPEN = {
  curl: '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\n: > "$2"\n',
  sha256sum: "#!/bin/sh\ncat > /dev/null\n",
  tar: '#!/bin/sh\nwhile [ "$1" != "-C" ]; do shift; done\ncp "$GITLEAKS_ATTRAPPE" "$2/gitleaks"\n',
  gitleaks: '#!/bin/sh\nprintf \'%s\\n\' "$ATTRAPPE_AUSGABE" >&2\nexit "$ATTRAPPE_STATUS"\n',
};

function schrittSkript() {
  const rumpf = workflowStepLines(WORKFLOW, SCHRITT);
  const skript = rumpf.indexOf(SKRIPT_ANFANG);
  assert.notEqual(skript, -1, `${SKRIPT_ANFANG.trim()} fehlt im Secret-Scan`);
  return rumpf
    .slice(skript + 1)
    .map((zeile) => zeile.slice(SKRIPT_EINZUG))
    .join("\n");
}

function attrappen(context) {
  const ordner = probeDirectory(context, ATTRAPPEN);
  for (const name of Object.keys(ATTRAPPEN)) chmodSync(join(ordner, name), 0o755);
  return ordner;
}

function sha(repo, ref) {
  return runIn(repo, "git", ["rev-parse", ref]).stdout.trim();
}

function scanne(context, repo, { basis, kopf, ausgabe, status = 0 }) {
  const werkzeuge = attrappen(context);
  const runnerTemp = join(werkzeuge, "runner");
  mkdirSync(runnerTemp);
  const skript = join(werkzeuge, "schritt.sh");
  writeFileSync(skript, schrittSkript());
  return spawnSync("bash", ["-e", skript], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...isolatedEnvironment(),
      PATH: `${werkzeuge}:${process.env.PATH}`,
      RUNNER_TEMP: runnerTemp,
      GITLEAKS_VERSION: "8.30.1",
      GITLEAKS_SHA256: "0".repeat(64),
      EVENT_NAME: "pull_request",
      PR_BASE_SHA: basis,
      PR_HEAD_SHA: kopf,
      GITLEAKS_ATTRAPPE: join(werkzeuge, "gitleaks"),
      ATTRAPPE_AUSGABE: ausgabe,
      ATTRAPPE_STATUS: String(status),
    },
  });
}

function repoMitNeuenCommits(context, neu) {
  const repo = probeRepository(context, { "a.txt": "a\n", "b.txt": "b\n" });
  const basis = sha(repo, "HEAD");
  for (const schritt of [neu].flat()) {
    schritt(repo);
    commitAll(repo, "Neu");
  }
  return { repo, basis, kopf: sha(repo, "HEAD") };
}

const NEUE_ZEILE = (repo) => writeFiles(repo, { "c.txt": "c\n" });
const NUR_LOESCHEN = (repo) => runIn(repo, "git", ["rm", "-q", "b.txt"]);
const ZEILE_IN_A = (repo) => writeFiles(repo, { "a.txt": "a\nmehr\n" });
const ZWEI_NEUE_DATEIEN = (repo) => writeFiles(repo, { "d.txt": "d\n", "e.txt": "e\n" });
const ZWEI_WEITERE_DATEIEN = (repo) => writeFiles(repo, { "f.txt": "f\n", "g.txt": "g\n" });
const GEMISCHTER_BEREICH = [NEUE_ZEILE, NUR_LOESCHEN, ZEILE_IN_A];
const MEHRERE_DATEIEN_JE_COMMIT = [ZWEI_NEUE_DATEIEN, ZWEI_WEITERE_DATEIEN];

function pruefeFall(context, { neu, bereich, ausgabe, status, gruen, meldung }) {
  const probe = repoMitNeuenCommits(context, neu);
  const { basis, kopf } = bereich ? bereich(probe) : probe;
  const lauf = scanne(context, probe.repo, { basis, kopf, ausgabe, status });
  const protokoll = `${lauf.stdout}${lauf.stderr}`;
  assert.equal(lauf.status === 0, gruen, protokoll);
  assert.match(protokoll, meldung);
}

test("secret-scan: ein git-Fehler im Bereich ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    bereich: ({ kopf }) => ({ basis: UNBEKANNTER_COMMIT, kopf }),
    ausgabe: GIT_FEHLER,
    gruen: false,
    meldung: /Secret-Scan: git kann den Bereich .* nicht lesen/,
  });
});

test("secret-scan: ein gitleaks-Fehler beim Lesen ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    ausgabe: GIT_FEHLER,
    gruen: false,
    meldung: /Secret-Scan: gitleaks meldet einen Fehler/,
  });
});

test("secret-scan: ein Scan, der keinen Commit gelesen hat, ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    ausgabe: NICHTS_GELESEN,
    gruen: false,
    meldung: /Secret-Scan: gitleaks hat 0 von 1 Commits mit neuen Zeilen gelesen/,
  });
});

test("secret-scan: ein Scan ohne Zählung der gelesenen Commits ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    ausgabe: OHNE_ZAEHLUNG,
    gruen: false,
    meldung: /Secret-Scan: gitleaks hat keine von 1 Commits mit neuen Zeilen gelesen/,
  });
});

test("secret-scan: ein leerer Bereich ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    bereich: ({ kopf }) => ({ basis: kopf, kopf }),
    ausgabe: NICHTS_GELESEN,
    gruen: false,
    meldung: /Secret-Scan: der Bereich .* enthält keinen Commit/,
  });
});

test("secret-scan: ein Fund ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    ausgabe: FUND,
    status: 1,
    gruen: false,
    meldung: /leaks found: 1/,
  });
});

test("secret-scan: ein gelesener Bereich ohne Fund ist grün mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NEUE_ZEILE,
    ausgabe: EIN_COMMIT_GELESEN,
    gruen: true,
    meldung: /scannt .* \(1 Commits, 1 mit neuen Zeilen\)/,
  });
});

test("secret-scan: ein Bereich, der nur löscht, ist grün mit Meldung", (context) => {
  pruefeFall(context, {
    neu: NUR_LOESCHEN,
    ausgabe: NICHTS_GELESEN,
    gruen: true,
    meldung: /Secret-Scan: nichts zu prüfen, kein Commit in .* fügt Zeilen hinzu/,
  });
});

test("secret-scan: ein gemischter Bereich ist grün, wenn gitleaks so viele Commits gelesen hat, wie Commits Zeilen hinzufügen", (context) => {
  pruefeFall(context, {
    neu: GEMISCHTER_BEREICH,
    ausgabe: commitsGelesen(2),
    gruen: true,
    meldung: /scannt .* \(3 Commits, 2 mit neuen Zeilen\)/,
  });
});

test("secret-scan: ein gemischter Bereich ist grün, wenn gitleaks alle Commits des Bereichs gelesen hat", (context) => {
  pruefeFall(context, {
    neu: GEMISCHTER_BEREICH,
    ausgabe: commitsGelesen(3),
    gruen: true,
    meldung: /scannt .* \(3 Commits, 2 mit neuen Zeilen\)/,
  });
});

test("secret-scan: ein gemischter Bereich, von dem gitleaks weniger Commits gelesen hat als Commits Zeilen hinzufügen, ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: GEMISCHTER_BEREICH,
    ausgabe: commitsGelesen(1),
    gruen: false,
    meldung: /Secret-Scan: gitleaks hat 1 von 2 Commits mit neuen Zeilen gelesen/,
  });
});

test("secret-scan: mehrere Dateien je Commit zählen als ein Commit, und ein gelesener Commit weniger ist rot mit Meldung", (context) => {
  pruefeFall(context, {
    neu: MEHRERE_DATEIEN_JE_COMMIT,
    ausgabe: commitsGelesen(1),
    gruen: false,
    meldung: /Secret-Scan: gitleaks hat 1 von 2 Commits mit neuen Zeilen gelesen/,
  });
});
