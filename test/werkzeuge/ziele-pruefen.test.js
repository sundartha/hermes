import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { commitNachricht } from "../../tools/ziele/nachricht.mjs";
import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";
import {
  BOT,
  LAUF,
  arbeitsordner,
  ausgabenAus,
  ciLauf,
  ersatzClaude,
  ersatzGh,
  gelesen,
  git,
  githubAttrappe,
  mitUrsprung,
  quelltext,
  starteZiele,
  testFuer,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const COMMITLINT = join(REPO_ROOT, "node_modules/@commitlint/cli/cli.js");
const COMMITLINT_KONFIG = join(REPO_ROOT, "commitlint.config.mjs");
const MAX_BETREFF = 72;
const FREI = quelltext(["function rest() {\n  return 2;\n}", "export function frei() {\n  return 1;\n}", "export function weg() {\n  return rest();\n}"]);
const FREI_SAUBER = quelltext(["export function frei() {\n  return 1;\n}"]);

const ANDERE = quelltext(["export function andere() {\n  return 4;\n}", "export function auchWeg() {\n  return 5;\n}"]);

function probe(context, andere = ANDERE) {
  return zieleRepo(context, {
    "src/main.js": quelltext(['import { frei } from "./frei.js";', 'import { gate } from "./gate.js";', 'import { andere } from "./andere.js";', "console.log(frei(), gate(), andere());"]),
    "src/frei.js": FREI,
    "src/gate.js": quelltext(['import { hilfe } from "./hilfe.js";', "export function gate() {\n  return hilfe();\n}"]),
    "src/hilfe.js": quelltext(["export function hilfe() {\n  return 3;\n}"]),
    "src/andere.js": andere,
    "test/frei.test.js": testFuer("src/main.js"),
  });
}

function ziel(repo, felder = {}) {
  return { format: 1, ausgang: "weiter", grund: "", befunde: [], master: repo.sha(), sorte: "knip", datei: "src/frei.js", zielbefunde: ["exports weg"], arten: ["exports"], agentErlaubt: true, agent: false, tests: ["test/frei.test.js"], ...felder };
}

function frisch(repo, sha) {
  git(repo.ordner, ["reset", "-q", "--hard", sha]);
  git(repo.ordner, ["clean", "-fdq"]);
}

function patchVon(repo, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) writeFileSync(join(repo.ordner, pfad), inhalt);
  git(repo.ordner, ["add", "-A"]);
  const patch = git(repo.ordner, ["diff", "--cached", "--binary", "HEAD"]);
  frisch(repo, "HEAD");
  return `${patch}\n`;
}

async function pruefe(context, repo, { patch, felder, github }) {
  const attrappe = github ?? (await githubAttrappe(context));
  const ordner = arbeitsordner(context, { "ziel/ziel.json": ziel(repo, felder), "ziel/fixer.patch": patch });
  const lauf = await starteZiele(["pruefen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(attrappe) });
  return { ...lauf, ordner, pruefung: gelesen(ordner, "pruefung/pruefung.json") };
}

function verstoss(ergebnis) {
  const befunde = ergebnis.pruefung.befunde.map(({ id, datei, betroffen }) => `${id} ${datei}${betroffen ? ` (${betroffen})` : ""}`);
  return [ergebnis.status, ergebnis.pruefung.ausgang, ...befunde];
}

test("ziele-pruefen: ändert der Lauf einen Test, wird die Prüfung rot mit AR-test", async (context) => {
  const repo = probe(context);
  const patch = patchVon(repo, { "src/frei.js": FREI_SAUBER, "test/frei.test.js": quelltext(['import { test } from "node:test";', 'test("frei anders", () => {});']) });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [1, "blockiert", "AR-test src/frei.js (test/frei.test.js)"]);
});

async function kandidatenDateien(context, repo, github) {
  const ordner = arbeitsordner(context, { "ziel/vorpruefung.json": { ausgang: "weiter" } });
  const wahl = await starteZiele(["waehlen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github) });
  assert.equal(wahl.status, 0, wahl.stderr);
  return gelesen(ordner, "ziel/ziel.json").kandidaten.map(({ datei }) => datei);
}

test("ziele-pruefen: ändert der Agent einen Test, wählt der nächste Lauf dieselbe Zieldatei nicht wieder", async (context) => {
  const repo = probe(context);
  const github = await githubAttrappe(context);
  const master = repo.sha();
  assert.deepEqual(await kandidatenDateien(context, repo, github), ["src/andere.js", "src/frei.js"]);
  const patch = patchVon(repo, { "src/frei.js": FREI_SAUBER, "test/frei.test.js": `${testFuer("src/main.js")}\n` });
  const geprueft = await pruefe(context, repo, { patch, github });
  frisch(repo, master);
  const ergebnis = await starteZiele(["ergebnis", "--ordner", geprueft.ordner, "--workflow", "aufraeumen"], { cwd: repo.ordner, env: umgebung(github) });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  const [issue] = github.zustand.issues;
  assert.equal(issue.title, "Aufräumen: AR-test in `src/frei.js`");
  assert.match(issue.body, /^- Geänderte andere Datei: `test\/frei\.test\.js`$/m);
  assert.deepEqual(await kandidatenDateien(context, repo, github), ["src/andere.js"]);
});

test("ziele-pruefen: bricht die Änderung einer Datei unter scripts/ das Verhalten, das ein Test verlangt, endet die Prüfung mit AR-tests-rot", async (context) => {
  const werkzeug = quelltext(["export function doppelt(wert) {\n  return wert * 2;\n}", "export function unbenutzt() {\n  return 0;\n}"]);
  const testDatei = quelltext(['import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import { doppelt } from "../scripts/werkzeug.mjs";', 'test("doppelt", () => assert.equal(doppelt(2), 4));']);
  const repo = zieleRepo(context, { "src/main.js": quelltext(["console.log(1);"]), "scripts/werkzeug.mjs": werkzeug, "test/werkzeug.test.js": testDatei });
  const patch = patchVon(repo, { "scripts/werkzeug.mjs": quelltext(["export function doppelt(wert) {\n  return wert * 3;\n}"]) });
  const felder = { datei: "scripts/werkzeug.mjs", zielbefunde: ["exports unbenutzt"], tests: ["test/werkzeug.test.js"] };
  const ergebnis = await pruefe(context, repo, { patch, felder });
  assert.deepEqual(verstoss(ergebnis), [0, "blockiert", "AR-tests-rot scripts/werkzeug.mjs"]);
  const ohneTests = await pruefe(context, repo, { patch: patchVon(repo, { "scripts/werkzeug.mjs": quelltext(["export function doppelt(wert) {\n  return wert * 2;\n}"]) }), felder: { ...felder, tests: [] } });
  assert.deepEqual(verstoss(ohneTests), [0, "blockiert", "AR-tests-rot scripts/werkzeug.mjs"]);
});

test("ziele-pruefen: fasst der Patch eine von einem Gate erreichte Datei an, wird die Prüfung rot mit AR-geschuetzt", async (context) => {
  const repo = probe(context);
  const patch = patchVon(repo, { "src/frei.js": FREI_SAUBER, "src/hilfe.js": quelltext(["export function hilfe() {\n  return 30;\n}"]) });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [1, "blockiert", "AR-geschuetzt src/frei.js (src/hilfe.js)"]);
});

test("ziele-pruefen: ändert der Patch eine zweite Datei, wird die Prüfung rot mit AR-fremde-datei", async (context) => {
  const repo = probe(context);
  const patch = patchVon(repo, { "src/frei.js": FREI_SAUBER, "src/andere.js": quelltext(["export function andere() {\n  return 4;\n}"]) });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [1, "blockiert", "AR-fremde-datei src/frei.js (src/andere.js)"]);
});

test("ziele-pruefen: ändert der Patch package.json, wird die Prüfung rot mit AR-fremde-datei", async (context) => {
  const repo = probe(context);
  const patch = patchVon(repo, { "src/frei.js": FREI_SAUBER, "package.json": JSON.stringify({ type: "module", scripts: { test: "true" } }) });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [1, "blockiert", "AR-fremde-datei src/frei.js (package.json)"]);
});

test("ziele-pruefen: ist die Mutationsprüfung rot, endet die Prüfung grün und blockiert mit AR-mutation", async (context) => {
  const repo = probe(context);
  repo.committe({ "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test", "test:mutation": 'node -e "process.exit(1)" --' } }) });
  const patch = patchVon(repo, { "src/frei.js": FREI_SAUBER });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [0, "blockiert", "AR-mutation src/frei.js"]);
});

test("ziele-pruefen: löscht der Patch die Zieldatei, wird die Prüfung rot mit AR-geloescht", async (context) => {
  const repo = probe(context);
  rmSync(join(repo.ordner, "src/frei.js"));
  const patch = patchVon(repo, {});
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [1, "blockiert", "AR-geloescht src/frei.js (src/frei.js)"]);
});

test("ziele-pruefen: bleibt in der Zieldatei ein Lint-Fehler, endet die Prüfung grün und blockiert mit AR-lint", async (context) => {
  const repo = probe(context);
  const patch = patchVon(repo, { "src/frei.js": quelltext(["var wert = 1;", "export function frei() {\n  return wert;\n}"]) });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [0, "blockiert", "AR-lint src/frei.js"]);
});

test("ziele-pruefen: bleibt der Zielbefund stehen, endet die Prüfung grün und blockiert mit AR-nicht-behoben", async (context) => {
  const repo = probe(context);
  const patch = patchVon(repo, { "src/frei.js": FREI.replace("return 1;", "return 10;") });
  assert.deepEqual(verstoss(await pruefe(context, repo, { patch })), [0, "blockiert", "AR-nicht-behoben src/frei.js"]);
});

test("ziele-pruefen: ohne abgeschlossenen Fixer prüft der Schritt nichts und endet rot", async (context) => {
  const repo = probe(context);
  const github = await githubAttrappe(context);
  const ordner = arbeitsordner(context, { "ziel/ziel.json": ziel(repo, { agent: undefined }), "ziel/fixer.patch": "" });
  const lauf = await starteZiele(["pruefen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github) });
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /der Fixer hat nicht abgeschlossen/);
  assert.equal(existsSync(join(ordner, "pruefung/pruefung.json")), false);
});

test("ziele-pruefen: knip --fix ändert weitere Dateien, übrig bleibt nur die Zieldatei", async (context) => {
  const repo = probe(context);
  const github = await githubAttrappe(context);
  const ordner = arbeitsordner(context, { "ziel/ziel.json": ziel(repo) });
  const lauf = await starteZiele(["fixen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github) });
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.match(lauf.stdout, /Zurückgesetzte Änderungen von knip --fix: src\/andere\.js/);
  assert.deepEqual(git(repo.ordner, ["diff", "--cached", "--name-only", "HEAD"]).split("\n"), ["src/frei.js"]);
  const fix = gelesen(ordner, "ziel/ziel.json");
  assert.deepEqual([fix.agent, fix.unbenutzt], [true, { vorher: 0, nachher: 1 }]);
});

function commitlint(nachricht) {
  return spawnSync(process.execPath, [COMMITLINT, "--config", COMMITLINT_KONFIG, "--cwd", REPO_ROOT], { input: nachricht, encoding: "utf8", env: isolatedEnvironment() });
}

test("ziele-pruefen: die Commit-Nachricht des Laufs besteht commitlint, nennt den Dateinamen und trägt die Sorte, auch bei langem Pfad", (context) => {
  const lang = "src/ein/sehr/langer/ordnername/fuer/die/probe/mit/vielen/teilen/datei-mit-einem-ausgesprochen-langen-namen-fuer-den-betreff.js";
  const nachricht = commitNachricht({ sorte: "jscpd", datei: lang, zielbefunde: ["Zeilen 1-4 gleichen 5-8"] }, new Date("2026-10-06T02:37:00Z"));
  const [betreff] = nachricht.split("\n");
  assert.ok(betreff.length <= MAX_BETREFF, betreff);
  assert.match(betreff, /^Fasse Kopien in datei-mit-einem-ausgesprochen-langen/);
  assert.equal(commitlint(nachricht).status, 0, commitlint(nachricht).stdout);
  assert.equal(commitlint(nachricht.replace("Auftrag: aufraeumen/", "Auftrag: aufraeumen-")).status, 1);
  const ordner = arbeitsordner(context, { "nachricht.txt": nachricht });
  const zeilen = spawnSync("git", ["interpret-trailers", "--parse", join(ordner, "nachricht.txt")], { encoding: "utf8" }).stdout;
  assert.match(zeilen, /^Sorte: jscpd$/m);
  assert.match(zeilen, /^Auftrag: aufraeumen\/2026-10-06-jscpd$/m);
});

async function schritt(name, { repo, ordner, env, master }) {
  const lauf = await starteZiele([name, "--ordner", ordner, ...(name === "ergebnis" ? ["--workflow", "aufraeumen"] : [])], { cwd: repo.ordner, env });
  assert.equal(lauf.status, 0, `${name}: ${lauf.stderr}${lauf.stdout}`);
  if (master) frisch(repo, master);
  return lauf;
}

test("ziele-pruefen: Gegenprobe, eine gültige Ein-Datei-Änderung endet mit genau einem PR und dem Ausgang geaendert", async (context) => {
  const repo = probe(context, quelltext(["export function andere() {\n  return 4;\n}"]));
  const ursprung = mitUrsprung(context, repo);
  const master = repo.sha();
  const github = await githubAttrappe(context, { laeufe: { "ci.yml": [ciLauf()] } });
  const claude = ersatzClaude(context, { schreibe: { "frei.js": FREI_SAUBER }, antwort: { datei: "src/frei.js", geaendert: true, sorte: "knip", behobeneBefunde: ["exports weg"] } });
  const gh = ersatzGh(context);
  const ordner = arbeitsordner(context, { "ausgaben.txt": "" });
  const env = umgebung(github, { HERMES_CLAUDE: claude.programm, CLAUDE_CODE_OAUTH_TOKEN: "schein-token", PATH: `${gh.pfad}:${process.env.PATH}`, GITHUB_OUTPUT: join(ordner, "ausgaben.txt") });
  const kontext = { repo, ordner, env, master };
  for (const name of ["vorpruefen", "waehlen", "fixen", "agent", "pruefen"]) await schritt(name, kontext);
  const { patch_sha: agentSumme } = ausgabenAus(join(ordner, "ausgaben.txt"));
  const gefaelscht = await starteZiele(["commit", "--ordner", ordner], { cwd: repo.ordner, env: { ...env, AGENT_PRUEFSUMME: "0".repeat(agentSumme.length) } });
  assert.equal(gefaelscht.status, 1);
  frisch(repo, master);
  await schritt("commit", { ...kontext, env: { ...env, AGENT_PRUEFSUMME: agentSumme }, master: null });
  assert.equal(readFileSync(join(repo.ordner, "src/frei.js"), "utf8"), FREI);
  assert.equal(git(repo.ordner, ["show", "HEAD:src/frei.js"]), FREI_SAUBER.trim());
  for (const name of ["pr", "ergebnis"]) await schritt(name, kontext);
  const ergebnis = gelesen(ordner, "ergebnis/ergebnis.json");
  const [pr] = github.zustand.angelegtePrs;
  assert.deepEqual([ergebnis.ausgang, ergebnis.sorte, ergebnis.datei, ergebnis.pr], ["geaendert", "knip", "src/frei.js", pr.number]);
  assert.deepEqual([pr.title, pr.head, pr.base], ["Aufräumen: knip in src/frei.js", `aufraeumen/knip-${LAUF}`, "master"]);
  assert.deepEqual(gh.aufrufe(), [{ argumente: ["pr", "merge", String(pr.number), "--repo", "sundartha/hermes", "--auto"], token: "probe-token" }]);
  assert.equal(github.zustand.angelegtePrs.length, 1);
  const branch = `refs/heads/aufraeumen/knip-${LAUF}`;
  assert.equal(git(ursprung, ["rev-list", "--count", `${master}..${branch}`]), "1");
  assert.deepEqual(git(ursprung, ["diff", "--name-only", master, branch]).split("\n"), ["src/frei.js"]);
  assert.equal(git(ursprung, ["log", "-1", "--format=%an %(trailers:key=Sorte,valueonly)", branch]), `${BOT} knip`);
  assert.equal(commitlint(git(ursprung, ["log", "-1", "--format=%B", branch])).status, 0);
  assert.equal(claude.protokoll().umgebung.CLAUDE_CODE_OAUTH_TOKEN, "schein-token");
});
