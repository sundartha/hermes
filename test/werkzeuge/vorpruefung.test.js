import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { vorpruefenUndPushen } from "../../tools/vorpruefung/ablauf.mjs";
import { commitAll, gitAusgabe as git, isolatedEnvironment, probeDirectory, probeRepository, REPO_ROOT, setzeUmgebung } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/vorpruefung.mjs");
const REPO = "probe/repo";
const LAUF = "4711";
const FREMDER_LAUF = "4712";
const FRUEHERER_LAUF = "4710";
const LAUF_URL = `https://github.com/${REPO}/actions/runs/${LAUF}`;
const BRANCH = "paket/probe";
const VOR_REF = "vorpruefung/probe";
const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const NACH_DEM_ABRUF_MS = 2000;
const VOR_DEM_ABRUF_MS = -600_000;
const KURZE_ZEITEN = { suchabstandMs: 1, suchversuche: 2, beobachtungen: 3, takt: "1" };
const ROTER_JOB = "Vorprüfung Mutation / Mutationsurteil";
const GH_ATTRAPPE = [
  "#!/usr/bin/env node",
  'const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");',
  'const { execFileSync } = require("node:child_process");',
  'const { dirname, join } = require("node:path");',
  "const hier = dirname(process.argv[1]);",
  "const argumente = process.argv.slice(2);",
  'const lies = (name) => readFileSync(join(hier, name), "utf8");',
  'appendFileSync(join(hier, "aufrufe.jsonl"), JSON.stringify({ argumente }) + "\\n");',
  'const befehl = argumente.slice(0, 2).join(" ");',
  'if (befehl === "pr list") process.stdout.write(lies("pr.txt"));',
  'else if (befehl === "workflow run") {',
  '  const refs = execFileSync("git", ["--git-dir", process.env.PROBE_UPSTREAM, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf8" });',
  '  appendFileSync(join(hier, "beim-abruf.txt"), refs);',
  '  process.stdout.write(lies("ausloesen.txt"));',
  '} else if (befehl === "run list") process.stdout.write(lies("liste.json"));',
  'else if (befehl === "run watch") process.exit(1);',
  'else if (befehl === "run view") {',
  '  const staende = JSON.parse(lies("staende.json"));',
  '  const zaehler = existsSync(join(hier, "zaehler.txt")) ? Number(lies("zaehler.txt")) : 0;',
  '  writeFileSync(join(hier, "zaehler.txt"), String(zaehler + 1));',
  "  process.stdout.write(JSON.stringify(staende[Math.min(zaehler, staende.length - 1)]));",
  '} else if (argumente[0] === "api") process.exit(0);',
  "else process.exit(9);",
  "",
].join("\n");

function paketMitNeuemStand(context) {
  const repo = probeRepository(context, { "a.txt": "a\n" });
  git(repo, "config", "user.name", "Probe");
  git(repo, "config", "user.email", "probe@example.invalid");
  git(repo, "checkout", "-q", "-b", BRANCH);
  const upstream = probeDirectory(context, {});
  git(upstream, "init", "-q", "--bare");
  git(repo, "remote", "add", "upstream", upstream);
  const alt = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "-q", "upstream", `${alt}:refs/heads/${BRANCH}`);
  writeFileSync(join(repo, "a.txt"), "b\n");
  commitAll(repo, "Neu");
  return { repo, upstream, alt, neu: git(repo, "rev-parse", "HEAD") };
}

function ghAttrappe(context, { lauf, staende = [lauf], pr = "", ausloesen = `${LAUF_URL}\n`, liste = [] }) {
  const dateien = { gh: GH_ATTRAPPE, "aufrufe.jsonl": "", "beim-abruf.txt": "", "pr.txt": pr, "staende.json": JSON.stringify(staende), "ausloesen.txt": ausloesen, "liste.json": JSON.stringify(liste) };
  const ordner = probeDirectory(context, dateien);
  chmodSync(join(ordner, "gh"), AUSFUEHRBAR);
  return ordner;
}

function fertigerLauf(headSha, conclusion) {
  const jobs = [
    { name: "Vorprüfung ci-lokal mit teuren Schritten", conclusion: "success" },
    { name: ROTER_JOB, conclusion },
  ];
  return { status: "completed", conclusion, headSha, url: LAUF_URL, jobs };
}

function vorpruefenMitArgumenten(probe, gh, argumente) {
  return spawnSync(process.execPath, [WERKZEUG, ...argumente], {
    cwd: probe.repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), PATH: `${gh}${delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: REPO, PROBE_UPSTREAM: probe.upstream },
  });
}

function vorpruefen(probe, gh, { erwartet = probe.alt, branch = BRANCH } = {}) {
  return vorpruefenMitArgumenten(probe, gh, ["--branch", branch, "--erwartet", erwartet]);
}

function vorpruefenMitKurzenZeiten(context, probe, gh) {
  setzeUmgebung(context, { PATH: `${gh}${delimiter}${env.PATH}`, GITHUB_REPOSITORY: REPO, PROBE_UPSTREAM: probe.upstream });
  return vorpruefenUndPushen({ root: probe.repo, branch: BRANCH, erwartet: probe.alt }, KURZE_ZEITEN);
}

function standAufUpstream({ upstream }, ref) {
  return git(upstream, "rev-parse", `refs/heads/${ref}`);
}

function ghAufrufe(gh) {
  return readFileSync(join(gh, "aufrufe.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((zeile) => JSON.parse(zeile).argumente);
}

function aufrufeVon(gh, befehl) {
  return ghAufrufe(gh).filter((argumente) => argumente.slice(0, 2).join(" ") === befehl);
}

function gelisteterLauf(databaseId, headSha, abstandMs = NACH_DEM_ABRUF_MS) {
  return { databaseId: Number(databaseId), headSha, createdAt: new Date(Date.now() + abstandMs).toISOString() };
}

test("Vorprüfung rot, abgebrochen oder über der Zeit: der Paket-Branch auf upstream und damit der PR bleiben auf dem alten Stand", (context) => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const probe = paketMitNeuemStand(context);
    const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, conclusion) });

    const lauf = vorpruefen(probe, gh);

    assert.equal(lauf.status, EXIT_ROT, conclusion + lauf.stdout + lauf.stderr);
    assert.equal(standAufUpstream(probe, BRANCH), probe.alt, conclusion);
    assert.match(lauf.stderr, new RegExp(`Vorprüfung ${conclusion}: ${LAUF_URL}\\. Der PR bleibt auf dem alten Stand\\.`));
    assert.match(lauf.stderr, new RegExp(`${ROTER_JOB}: ${conclusion}`));
  }
});

test("Vorprüfung grün: der geprüfte Stand landet auf dem Paket-Branch und damit im PR", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success") });

  const lauf = vorpruefen(probe, gh);

  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(standAufUpstream(probe, BRANCH), probe.neu);
  assert.match(lauf.stdout, new RegExp(`^upstream/${BRANCH} = ${probe.neu}\\.`, "m"));
});

test("Die Vorprüfung läuft auf dem eigenen Vorprüf-Ref am neuen Stand mit Branch, Stand und PR-Nummer, während der Paket-Branch noch auf dem alten Stand steht", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success"), pr: "2701\n" });

  const lauf = vorpruefen(probe, gh);

  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const abruf = ghAufrufe(gh).find((argumente) => argumente[0] === "workflow");
  assert.deepEqual(abruf, ["workflow", "run", "vorpruefung.yml", "-R", REPO, "--ref", VOR_REF, "-f", `branch=${BRANCH}`, "-f", `stand=${probe.neu}`, "-f", "pr=2701"]);
  const refsBeimAbruf = readFileSync(join(gh, "beim-abruf.txt"), "utf8").trim().split("\n").toSorted();
  assert.deepEqual(refsBeimAbruf, [`refs/heads/${BRANCH} ${probe.alt}`, `refs/heads/${VOR_REF} ${probe.neu}`]);
  assert.ok(ghAufrufe(gh).some((argumente) => argumente.join(" ") === `api -X DELETE repos/${REPO}/git/refs/heads/${VOR_REF}`));
});

test("Ein grüner Lauf an einem anderen Stand als dem des Paket-Branches aktualisiert den PR nicht", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.alt, "success") });

  const lauf = vorpruefen(probe, gh);

  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
});

test("Nach grüner Vorprüfung gilt die Lease: steht upstream nicht auf dem erwarteten Stand, bleibt der PR, wie er ist", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success") });

  const lauf = vorpruefen(probe, gh, { erwartet: "neu" });

  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
  assert.match(lauf.stderr, new RegExp(`Push nach upstream/${BRANCH} abgelehnt`));
});

test("Ohne Lauf-Adresse vom Abruf gilt der Lauf am geprüften Stand nach dem Abruf, weder ein Lauf an einem fremden Stand noch ein früherer Lauf", async (context) => {
  const probe = paketMitNeuemStand(context);
  const liste = [gelisteterLauf(FREMDER_LAUF, probe.alt), gelisteterLauf(FRUEHERER_LAUF, probe.neu, VOR_DEM_ABRUF_MS), gelisteterLauf(LAUF, probe.neu)];
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success"), ausloesen: "", liste });

  const ergebnis = await vorpruefenMitKurzenZeiten(context, probe, gh);

  assert.equal(ergebnis.exitCode, 0, ergebnis.zeilen.join("\n"));
  assert.deepEqual(aufrufeVon(gh, "run view").map((argumente) => argumente[2]), [LAUF]);
  assert.equal(standAufUpstream(probe, BRANCH), probe.neu);
});

test("Findet die Laufsuche ohne Lauf-Adresse nur Läufe an fremden Ständen, bleibt der PR auf dem alten Stand", async (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success"), ausloesen: "", liste: [gelisteterLauf(FREMDER_LAUF, probe.alt)] });

  const ergebnis = await vorpruefenMitKurzenZeiten(context, probe, gh);

  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.zeilen.join("\n"), new RegExp(`kein Lauf von vorpruefung\\.yml auf ${VOR_REF} am Stand ${probe.neu} nach ${KURZE_ZEITEN.suchversuche} Suchen gefunden`));
  assert.equal(aufrufeVon(gh, "run list").length, KURZE_ZEITEN.suchversuche);
  assert.deepEqual(aufrufeVon(gh, "run view"), []);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
});

test("Solange die Vorprüfung noch läuft, beobachtet das Werkzeug sie weiter und urteilt erst über den fertigen Lauf", async (context) => {
  const probe = paketMitNeuemStand(context);
  const laeuft = { status: "in_progress", conclusion: "", headSha: probe.neu, url: LAUF_URL, jobs: [] };
  const gh = ghAttrappe(context, { staende: [laeuft, fertigerLauf(probe.neu, "success")] });

  const ergebnis = await vorpruefenMitKurzenZeiten(context, probe, gh);

  assert.equal(ergebnis.exitCode, 0, ergebnis.zeilen.join("\n"));
  assert.equal(aufrufeVon(gh, "run watch").length, 2);
  assert.equal(standAufUpstream(probe, BRANCH), probe.neu);
});

test("Wird die Vorprüfung in der erlaubten Zahl von Beobachtungen nicht fertig, bleibt der PR auf dem alten Stand", async (context) => {
  const probe = paketMitNeuemStand(context);
  const laeuft = { status: "in_progress", conclusion: "", headSha: probe.neu, url: LAUF_URL, jobs: [] };
  const gh = ghAttrappe(context, { staende: [laeuft] });

  const ergebnis = await vorpruefenMitKurzenZeiten(context, probe, gh);

  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.zeilen.join("\n"), new RegExp(`Lauf ${LAUF} ist nach ${KURZE_ZEITEN.beobachtungen} Beobachtungen nicht fertig`));
  assert.equal(aufrufeVon(gh, "run watch").length, KURZE_ZEITEN.beobachtungen);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
});

test("Mehr als ein offener PR für den Paket-Branch bricht vor jedem Push und jedem Abruf ab", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success"), pr: "2701\n2702\n" });

  const lauf = vorpruefen(probe, gh);

  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`mehr als ein offener PR für ${BRANCH}: 2701, 2702`));
  assert.deepEqual(aufrufeVon(gh, "workflow run"), []);
  assert.equal(git(probe.upstream, "for-each-ref", "--format=%(refname)"), `refs/heads/${BRANCH}`);
});

test("Ein Branch außerhalb von paket/ oder mit einem in Git verbotenen Namen bricht ohne Push und ohne Aufruf von gh ab", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success") });

  for (const branch of ["main", "paket/", "paket/a..b", "paket/probe.lock", "paket/probe."]) {
    const lauf = vorpruefen(probe, gh, { branch });

    assert.equal(lauf.status, EXIT_ABBRUCH, branch + lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, /nur Branches der Form paket\/<name>/, branch);
  }
  assert.deepEqual(ghAufrufe(gh), []);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
});

test("Ein --erwartet, das weder ein voller sha noch neu ist, bricht ohne Push und ohne Aufruf von gh ab", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success") });

  for (const erwartet of [probe.alt.slice(0, 12), `${probe.alt}0`, "NEU", ""]) {
    const lauf = vorpruefen(probe, gh, { erwartet });

    assert.equal(lauf.status, EXIT_ABBRUCH, erwartet + lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, /--erwartet ist der volle sha/, erwartet);
  }
  assert.deepEqual(ghAufrufe(gh), []);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
});

test("Lehnt upstream den Push auf den Vorprüf-Ref ab, startet keine Vorprüfung und der PR bleibt auf dem alten Stand", (context) => {
  const probe = paketMitNeuemStand(context);
  git(probe.upstream, "update-ref", "refs/heads/vorpruefung", probe.alt);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success") });

  const lauf = vorpruefen(probe, gh);

  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, new RegExp(`Push nach upstream/${VOR_REF} abgelehnt; der PR bleibt auf dem alten Stand\\.`));
  assert.deepEqual(aufrufeVon(gh, "workflow run"), []);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
});

test("Ohne --branch oder --erwartet oder mit einer unbekannten Option nennt das Werkzeug den Aufruf, ruft gh nicht auf und lässt den Paket-Branch, wie er ist", (context) => {
  const probe = paketMitNeuemStand(context);
  const gh = ghAttrappe(context, { lauf: fertigerLauf(probe.neu, "success") });

  for (const argumente of [["--branch", BRANCH], ["--erwartet", probe.alt], [], ["--branch", BRANCH, "--erwartet", probe.alt, "--unbekannt"]]) {
    const lauf = vorpruefenMitArgumenten(probe, gh, argumente);

    assert.equal(lauf.status, EXIT_ABBRUCH, argumente.join(" ") + lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, /^Aufruf: node tools\/vorpruefung\.mjs --branch paket\/<name> --erwartet /m, argumente.join(" "));
  }
  assert.deepEqual(ghAufrufe(gh), []);
  assert.equal(standAufUpstream(probe, BRANCH), probe.alt);
  assert.equal(git(probe.upstream, "for-each-ref", "--format=%(refname)"), `refs/heads/${BRANCH}`);
});
