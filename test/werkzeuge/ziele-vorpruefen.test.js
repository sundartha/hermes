import assert from "node:assert/strict";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { scheinSha } from "./pruefer/hilfen.mjs";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";
import {
  arbeitsordner,
  ciLauf,
  eigenerLauf,
  eigenerPr,
  gelesen,
  githubAttrappe,
  quelltext,
  starteZiele,
  testFuer,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const EIGENER_PR = 61;
const DEPENDABOT_PR = 190;
const ROTER_KOPF = scheinSha("c");
const BEARBEITET = 9;
const WARTEND = 10;

function repoMitBefund(context) {
  return zieleRepo(context, {
    "src/main.js": quelltext(['import { frei } from "./frei.js";', "console.log(frei());"]),
    "src/frei.js": quelltext(["export function frei() {\n  return 1;\n}", "export function weg() {\n  return 2;\n}"]),
    "test/haupt.test.js": testFuer("src/main.js"),
  });
}

function ausgabeZeile(zeile) {
  const [name, ...wert] = zeile.split("=");
  return [name, wert.join("=")];
}

function ausgaben(datei) {
  return Object.fromEntries(
    readFileSync(datei, "utf8").trim().split("\n").map(ausgabeZeile),
  );
}

async function vorpruefe(context, repo, { anfang = {}, programm } = {}) {
  const github = await githubAttrappe(context, anfang);
  const ordner = arbeitsordner(context, { "ausgaben.txt": "" });
  const env = umgebung(github, { GITHUB_OUTPUT: join(ordner, "ausgaben.txt") });
  const lauf = await starteZiele(["vorpruefen", "--ordner", ordner], { cwd: repo.ordner, env, programm });
  return { ...lauf, ordner, env, github, ausgabe: ausgaben(join(ordner, "ausgaben.txt")), vorpruefung: gelesen(ordner, "ziel/vorpruefung.json") };
}

function schreibende(github) {
  return github.zustand.anfragen.filter((anfrage) => !anfrage.startsWith("GET "));
}

test("ziele-vorpruefen: ohne Änderung an master endet der Lauf sauber, ohne installierte Pakete und ohne Agent", async (context) => {
  const repo = repoMitBefund(context);
  const kopie = probeDirectory(context, {});
  cpSync(join(REPO_ROOT, "tools"), join(kopie, "tools"), { recursive: true, filter: (pfad) => !pfad.includes("node_modules") });
  const anfang = { laeufe: { "aufraeumen.yml": [eigenerLauf(BEARBEITET, repo.sha())] } };
  const { status, ausgabe, github, stderr } = await vorpruefe(context, repo, { anfang, programm: join(kopie, "tools/ziele.mjs") });
  assert.equal(status, 0, stderr);
  assert.equal(ausgabe.ausgang, "sauber");
  assert.match(ausgabe.grund, /master unverändert seit https:\/\/github.com\/sundartha\/hermes\/actions\/runs\/9/);
  assert.deepEqual(schreibende(github), []);
});

test("ziele-vorpruefen: ein früherer Lauf auf demselben Stand, der nur gewartet hat, zählt nicht als bearbeitet", async (context) => {
  const repo = repoMitBefund(context);
  const gewartet = eigenerLauf(WARTEND, repo.sha(), { ergebnis: "skipped" });
  const nurGewartet = await vorpruefe(context, repo, { anfang: { laeufe: { "aufraeumen.yml": [gewartet], "ci.yml": [ciLauf()] } } });
  assert.equal(nurGewartet.ausgabe.ausgang, "weiter");
  const davorBearbeitet = await vorpruefe(context, repo, { anfang: { laeufe: { "aufraeumen.yml": [gewartet, eigenerLauf(BEARBEITET, repo.sha())], "ci.yml": [ciLauf()] } } });
  assert.equal(davorBearbeitet.ausgabe.ausgang, "sauber");
  assert.match(davorBearbeitet.ausgabe.grund, /actions\/runs\/9$/);
});

test("ziele-vorpruefen: ein Fork-Lauf mit demselben Kopf-Commit und ein wartender eigener Lauf schließen den eigenen PR nicht", async (context) => {
  const repo = repoMitBefund(context);
  const kopf = scheinSha("a");
  const fork = ciLauf({ event: "pull_request", conclusion: "failure", head_sha: kopf, head_branch: "aufraeumen/knip-61", head_repository: { full_name: "fremder/hermes" }, run_number: 3 });
  const wartend = ciLauf({ event: "pull_request", conclusion: "action_required", head_sha: kopf, head_branch: "aufraeumen/knip-61", run_number: 2 });
  const { ausgabe, github } = await vorpruefe(context, repo, { anfang: { pulls: [eigenerPr(EIGENER_PR, { kopf })], laeufe: { "ci.yml": [fork, wartend] } } });
  assert.deepEqual([ausgabe.ausgang, ausgabe.grund], ["blockiert", `eigener PR #${EIGENER_PR} ist noch offen`]);
  assert.deepEqual(schreibende(github), []);
});

async function mitPrueferStatus(context, zustand) {
  const repo = repoMitBefund(context);
  const kopf = scheinSha("a");
  const gruen = ciLauf({ event: "pull_request", head_sha: kopf, head_branch: "aufraeumen/knip-61" });
  const status = { [kopf]: [{ context: "Prüfer", state: zustand, target_url: "https://github.com/sundartha/hermes/actions/runs/77" }] };
  const { ausgabe, github, vorpruefung } = await vorpruefe(context, repo, { anfang: { pulls: [eigenerPr(EIGENER_PR, { kopf })], laeufe: { "ci.yml": [gruen] }, status } });
  const { pulls } = github.zustand;
  return [ausgabe.ausgang, pulls[0].state, ...vorpruefung.befunde.map(({ id }) => id)];
}

test("ziele-vorpruefen: lehnt der Prüfer den Kopf des eigenen PRs ab, wird der PR geschlossen und gemeldet", async (context) => {
  assert.deepEqual(await mitPrueferStatus(context, "failure"), ["blockiert", "closed", "AR-pr-rot"]);
});

test("ziele-vorpruefen: ein Prüfer-Status error zählt wie failure und schließt den eigenen PR", async (context) => {
  assert.deepEqual(await mitPrueferStatus(context, "error"), ["blockiert", "closed", "AR-pr-rot"]);
});

test("ziele-vorpruefen: ein offener eigener PR blockiert den Lauf, bevor ein Agent startet", async (context) => {
  const repo = repoMitBefund(context);
  const anfang = { pulls: [eigenerPr(EIGENER_PR)], laeufe: { "ci.yml": [ciLauf({ event: "pull_request", head_sha: scheinSha("a"), head_branch: "aufraeumen/knip-61" })] } };
  const { ausgabe, github } = await vorpruefe(context, repo, { anfang });
  assert.deepEqual([ausgabe.ausgang, ausgabe.grund], ["blockiert", `eigener PR #${EIGENER_PR} ist noch offen`]);
  assert.deepEqual(schreibende(github), []);
});

test("ziele-vorpruefen: ein offener Aufräum-PR von sundartha-agent[bot] zählt als eigener und blockiert", async (context) => {
  const pr = eigenerPr(EIGENER_PR, { user: "sundartha-agent[bot]" });
  const { ausgabe } = await vorpruefe(context, repoMitBefund(context), { anfang: { pulls: [pr], laeufe: { "ci.yml": [ciLauf()] } } });
  assert.equal(ausgabe.grund, `eigener PR #${EIGENER_PR} ist noch offen`);
});

test("ziele-vorpruefen: offene Dependabot-PRs blockieren nicht", async (context) => {
  const repo = repoMitBefund(context);
  const dependabot = { ...eigenerPr(DEPENDABOT_PR, { user: "dependabot[bot]" }), head: { ref: "dependabot/npm_and_yarn/alle-1", sha: scheinSha("d") } };
  const anfang = { pulls: [dependabot], laeufe: { "ci.yml": [ciLauf()], "aufraeumen.yml": [eigenerLauf(BEARBEITET, scheinSha("e"))] } };
  const { ausgabe } = await vorpruefe(context, repo, { anfang });
  assert.equal(ausgabe.ausgang, "weiter");
});

test("ziele-vorpruefen: ein roter oder laufender CI-Lauf auf master blockiert", async (context) => {
  const repo = repoMitBefund(context);
  const rot = await vorpruefe(context, repo, { anfang: { laeufe: { "ci.yml": [ciLauf({ conclusion: "failure" })] } } });
  assert.deepEqual([rot.ausgabe.ausgang, rot.ausgabe.grund], ["blockiert", "der letzte CI-Lauf auf master endete mit failure"]);
  const laufend = await vorpruefe(context, repo, { anfang: { laeufe: { "ci.yml": [ciLauf({ status: "in_progress", conclusion: null })] } } });
  assert.equal(laufend.ausgabe.ausgang, "blockiert");
  assert.match(laufend.ausgabe.grund, /^CI auf master läuft noch/);
});

test("ziele-vorpruefen: ein eigener PR mit rotem Lauf in der Warteschlange wird geschlossen", async (context) => {
  const repo = repoMitBefund(context);
  const schlange = ciLauf({ event: "merge_group", conclusion: "failure", head_branch: `gh-readonly-queue/master/pr-${EIGENER_PR}-abc`, head_sha: scheinSha("f") });
  const { ausgabe, github } = await vorpruefe(context, repo, { anfang: { pulls: [eigenerPr(EIGENER_PR)], laeufe: { "ci.yml": [schlange] } } });
  assert.equal(ausgabe.ausgang, "blockiert");
  const { pulls } = github.zustand;
  assert.equal(pulls[0].state, "closed");
});

test("ziele-vorpruefen: ein roter eigener PR wird geschlossen, gemeldet, und seine Datei bleibt bis zur nächsten Änderung verworfen", async (context) => {
  const repo = repoMitBefund(context);
  const gefallen = { number: 70, title: `Aus der Warteschlange gefallen: #${EIGENER_PR}`, labels: [], state: "open", comments: 0, created_at: "2026-10-01T00:00:00Z" };
  const anfang = {
    pulls: [eigenerPr(EIGENER_PR, { kopf: ROTER_KOPF })],
    issues: [gefallen],
    laeufe: { "ci.yml": [ciLauf({ event: "pull_request", conclusion: "failure", head_sha: ROTER_KOPF, head_branch: "aufraeumen/knip-61" })] },
  };
  const vorherWahl = await starteZiele(["waehlen", "--ordner", arbeitsordner(context, { "ziel/vorpruefung.json": { ausgang: "weiter" } })], { cwd: repo.ordner, env: umgebung(await githubAttrappe(context)) });
  assert.match(vorherWahl.stdout, /^Ziel: weiter knip in src\/frei\.js$/m);
  const { ausgabe, github, ordner, env, vorpruefung } = await vorpruefe(context, repo, { anfang });
  assert.deepEqual([ausgabe.ausgang, ausgabe.grund], ["blockiert", `eigener PR #${EIGENER_PR} war rot und ist geschlossen`]);
  const { pulls, issues } = github.zustand;
  assert.deepEqual([pulls[0].state, gefallen.state], ["closed", "closed"]);
  assert.deepEqual(vorpruefung.befunde.map(({ id, datei }) => [id, datei]), [["AR-pr-rot", "src/frei.js"]]);
  const ergebnis = await starteZiele(["ergebnis", "--ordner", ordner, "--workflow", "aufraeumen"], { cwd: repo.ordner, env });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  const befund = issues.find(({ title }) => title === "Aufräumen: AR-pr-rot in `src/frei.js`");
  assert.deepEqual([befund.labels, befund.state, befund.state_reason], [[{ name: "aufraeumen" }], "closed", "not_planned"]);
  const wahl = await starteZiele(["waehlen", "--ordner", arbeitsordner(context, { "ziel/vorpruefung.json": { ausgang: "weiter" } })], { cwd: repo.ordner, env });
  assert.match(wahl.stdout, /^Ziel: sauber/m);
});
