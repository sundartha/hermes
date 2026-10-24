import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { REPO_ROOT, isolatedEnvironment, repoMitCiLokalListe, runIn } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/ci-lokal.mjs");
const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const ZEILEN_IM_ROTEN_SCHRITT = 30;
const ZEILEN_IN_DER_MELDUNG = 15;
const SCHREIBT_BASIS = { name: "schreibt", befehl: 'printf %s "$BASIS" > basis.txt' };
const ROT = {
  name: "zaehlt",
  befehl: `i=1; while [ $i -le ${ZEILEN_IM_ROTEN_SCHRITT} ]; do echo "zeile-$i"; i=$((i+1)); done; exit 3`,
};
const TEUER = { name: "teuer", teuer: true, befehl: "touch teuer.txt" };
const BRAUCHT_POSTGRES = { name: "wirkung", werkzeug: "postgres", befehl: "touch wirkung.txt" };

function ciLokal(repo, argumente, umgebung = {}) {
  const lauf = spawnSync(process.execPath, [WERKZEUG, ...argumente], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ...umgebung },
  });
  return { ...lauf, ausgabe: lauf.stdout + lauf.stderr };
}

function vorletzterCommit(repo) {
  return runIn(repo, "git", ["rev-parse", "HEAD~1"]).stdout.trim();
}

test("ci-lokal gibt jedem Schritt die Basis als SHA in BASIS und meldet je Schritt grün mit Dauer", (context) => {
  const repo = repoMitCiLokalListe(context, [SCHREIBT_BASIS]);
  const lauf = ciLokal(repo, ["--basis", "HEAD~1"]);
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.equal(readFileSync(join(repo, "basis.txt"), "utf8"), vorletzterCommit(repo));
  assert.match(lauf.stdout, /^schreibt grün \d+(\.\d+)?s$/m);
  assert.match(lauf.stdout, /^ci-lokal: grün$/m);
});

test("ci-lokal läuft nach einem roten Schritt weiter, zeigt dessen letzte Zeilen und endet rot mit der Liste", (context) => {
  const repo = repoMitCiLokalListe(context, [ROT, SCHREIBT_BASIS]);
  const lauf = ciLokal(repo, ["--basis", "HEAD~1"]);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.stdout, /^zaehlt rot \d+(\.\d+)?s$/m);
  const erste = ZEILEN_IM_ROTEN_SCHRITT - ZEILEN_IN_DER_MELDUNG + 1;
  for (let zeile = erste; zeile <= ZEILEN_IM_ROTEN_SCHRITT; zeile += 1) {
    assert.match(lauf.stdout, new RegExp(`^\\s+zeile-${zeile}$`, "m"));
  }
  assert.doesNotMatch(lauf.stdout, new RegExp(`zeile-${erste - 1}$`, "m"));
  assert.ok(existsSync(join(repo, "basis.txt")), lauf.ausgabe);
  assert.match(lauf.stdout, /^ci-lokal: rot: zaehlt$/m);
});

test("ci-lokal fährt einen teuren Schritt nur mit --mit-teuren und nennt ihn sonst als nicht gelaufen", (context) => {
  const repo = repoMitCiLokalListe(context, [TEUER]);
  const ohne = ciLokal(repo, ["--basis", "HEAD~1"]);
  assert.equal(ohne.status, 0, ohne.ausgabe);
  assert.ok(!existsSync(join(repo, "teuer.txt")));
  assert.match(ohne.stdout, /^teuer nicht gelaufen \(teuer, nur mit --mit-teuren\)$/m);
  const mit = ciLokal(repo, ["--basis", "HEAD~1", "--mit-teuren"]);
  assert.equal(mit.status, 0, mit.ausgabe);
  assert.ok(existsSync(join(repo, "teuer.txt")));
  assert.match(mit.stdout, /^teuer grün \d+(\.\d+)?s$/m);
});

test("ci-lokal meldet einen Schritt rot mit Grund und Zweck, wenn sein Werkzeug fehlt, und startet ihn nicht", (context) => {
  const repo = repoMitCiLokalListe(context, [BRAUCHT_POSTGRES]);
  const umgebung = mitErsatzWerkzeugen(repo);
  writeFileSync(join(repo, "ersatz-bin", "pg_isready"), "#!/bin/sh\necho kaputt >&2\nexit 1\n", { mode: AUSFUEHRBAR });
  const lauf = ciLokal(repo, ["--basis", "HEAD~1"], umgebung);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.ok(!existsSync(join(repo, "wirkung.txt")));
  assert.match(lauf.stdout, /^wirkung rot \d+(\.\d+)?s$/m);
  assert.ok(lauf.stdout.includes("Postgres für test:wirkung fehlt; ohne es überspringen die Postgres-Tests still (pg_isready endete mit Exit 1: kaputt)."), lauf.stdout);
  assert.ok(lauf.stdout.includes(zweckBlock(MELDUNG.POSTGRES_FEHLT)[0]), lauf.stdout);
  assert.match(lauf.stdout, /^ci-lokal: rot: wirkung$/m);
});

test("ci-lokal bricht ohne Schritt ab, wenn die Basis kein Commit ist oder fehlt", (context) => {
  const repo = repoMitCiLokalListe(context, [SCHREIBT_BASIS]);
  const falsch = ciLokal(repo, ["--basis", "gibt-es-nicht"]);
  assert.equal(falsch.status, EXIT_ABBRUCH, falsch.ausgabe);
  assert.match(falsch.stderr, /Die Basis gibt-es-nicht ist kein Commit/);
  const ohne = ciLokal(repo, []);
  assert.equal(ohne.status, EXIT_ABBRUCH, ohne.ausgabe);
  assert.match(ohne.stderr, /--basis fehlt/);
  assert.ok(!existsSync(join(repo, "basis.txt")));
});
