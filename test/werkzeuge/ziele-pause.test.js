import assert from "node:assert/strict";
import { test } from "node:test";

import { githubZugang } from "../../tools/auftrag/pruefer-github.mjs";
import { pausierteSorten } from "../../tools/ziele/pause.mjs";
import { ruecknahmen } from "../../tools/ziele/ruecknahmen.mjs";
import {
  REPO,
  arbeitsordner,
  botIssue,
  ciLauf,
  gelesen,
  git,
  githubAttrappe,
  quelltext,
  starteZiele,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const ZURUECKGENOMMEN = 41;
const REPARATUR = 80;
const MASTER_ROT = 81;
const AUTOR = ["-c", "user.name=sundartha-agent[bot]", "-c", "user.email=bot@example.invalid"];

function nachricht(betreff, sorte = "knip", auftrag = "aufraeumen/2026-10-01-knip") {
  return [betreff, "", "Warum: knip meldet toten Code.", "", `Auftrag: ${auftrag}`, "Art: aufraeumen", `Sorte: ${sorte}`].join("\n");
}

function committe(repo, dateien, text) {
  repo.committe(dateien, text);
  return repo.sha();
}

function nimmZurueck(repo, sha) {
  git(repo.ordner, [...AUTOR, "revert", "--no-edit", sha]);
}

function aufgeraeumtesRepo(context) {
  const repo = zieleRepo(context, {
    "src/main.js": quelltext(['import { frei } from "./frei.js";', "console.log(frei());"]),
    "src/frei.js": quelltext(["export function frei() {\n  return 1;\n}", "export function weg() {\n  return 2;\n}"]),
  });
  const original = committe(repo, { "src/frei.js": quelltext(["export function frei() {\n  return 1;\n}", "export function weg() {\n  return 3;\n}"]) }, nachricht("Entferne toten Code aus src/frei.js"));
  nimmZurueck(repo, original);
  return { repo, original };
}

function issue(nummer, titel, felder = {}) {
  return botIssue(nummer, titel, { labels: [{ name: "reparatur" }], created_at: "2026-10-02T00:00:00Z", ...felder });
}

async function pause(context, root, anfang) {
  const github = await githubAttrappe(context, anfang);
  return pausierteSorten({ github: githubZugang({ api: github.url, repo: REPO, token: "probe" }), root });
}

function lage(original, issues, ci = "success") {
  return { commitPrs: { [original]: [{ number: ZURUECKGENOMMEN, merged_at: "2026-10-01T12:00:00Z" }] }, issues, laeufe: { "ci.yml": [ciLauf({ conclusion: ci })] } };
}

test("ziele-pause: eine Rücknahme mit offenem Reparatur-Issue pausiert knip, die Wahl überspringt die Sorte", async (context) => {
  const { repo, original } = aufgeraeumtesRepo(context);
  const anfang = lage(original, [issue(REPARATUR, `Reparatur: src/frei.js nach Rücknahme von #${ZURUECKGENOMMEN}`)]);
  const { pausiert, befunde } = await pause(context, repo.ordner, anfang);
  assert.deepEqual([...pausiert.keys()], ["knip"]);
  assert.deepEqual(befunde, []);
  const github = await githubAttrappe(context, anfang);
  const ordner = arbeitsordner(context, { "ziel/vorpruefung.json": { ausgang: "weiter" } });
  await starteZiele(["waehlen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github) });
  const ziel = gelesen(ordner, "ziel/ziel.json");
  assert.equal(ziel.ausgang, "blockiert");
  assert.match(ziel.grund, /knip pausiert: Issue #80 zur Rücknahme von #41 ist nicht erledigt/);
});

test("ziele-pause: nach erledigtem Reparatur-Issue und grünem master ist knip wieder dran", async (context) => {
  const { repo, original } = aufgeraeumtesRepo(context);
  const erledigt = issue(REPARATUR, `Reparatur nach Rücknahme von #${ZURUECKGENOMMEN}`, { state: "closed", state_reason: "completed" });
  const gruen = await pause(context, repo.ordner, lage(original, [erledigt]));
  assert.equal(gruen.pausiert.size, 0);
  const rot = await pause(context, repo.ordner, lage(original, [erledigt], "failure"));
  assert.deepEqual([...rot.pausiert], [["knip", "der letzte CI-Lauf auf master ist nicht grün"]]);
  const verworfen = issue(REPARATUR, `Reparatur nach Rücknahme von #${ZURUECKGENOMMEN}`, { state: "closed", state_reason: "not_planned" });
  const nichtErledigt = await pause(context, repo.ordner, lage(original, [verworfen]));
  assert.deepEqual([...nichtErledigt.pausiert.keys()], ["knip"]);
});

test("ziele-pause: ein Reparatur-Issue, das kein Bot angelegt hat, beendet die Pause nicht", async (context) => {
  const { repo, original } = aufgeraeumtesRepo(context);
  const vonHand = issue(REPARATUR, `Reparatur nach Rücknahme von #${ZURUECKGENOMMEN}`, { state: "closed", state_reason: "completed", user: { login: "jemand" } });
  const { pausiert, befunde } = await pause(context, repo.ordner, lage(original, [vonHand]));
  assert.deepEqual([[...pausiert.keys()], befunde.map(({ id }) => id)], [["knip"], ["AR-pause-ohne-issue"]]);
});

test("ziele-pause: ohne Reparatur-Issue zählt ein master-rot-Issue, das den PR nennt", async (context) => {
  const { repo, original } = aufgeraeumtesRepo(context);
  const masterRot = issue(MASTER_ROT, "master rot: abc1234", { labels: [{ name: "master-rot" }], body: `Rücknahme von #${ZURUECKGENOMMEN} gescheitert`, state: "closed", state_reason: "completed" });
  const { pausiert } = await pause(context, repo.ordner, lage(original, [masterRot]));
  assert.equal(pausiert.size, 0);
});

test("ziele-pause: eine Rücknahme ohne Reparatur- und master-rot-Issue pausiert und meldet AR-pause-ohne-issue", async (context) => {
  const { repo, original } = aufgeraeumtesRepo(context);
  const { pausiert, befunde } = await pause(context, repo.ordner, lage(original, []));
  assert.deepEqual([...pausiert.keys()], ["knip"]);
  assert.deepEqual(befunde.map(({ id, datei }) => [id, datei]), [["AR-pause-ohne-issue", "src/frei.js"]]);
});

test("ziele-pause: ein zurückgenommener PR mit drei Commits zählt als eine Rücknahme", async (context) => {
  const repo = zieleRepo(context, { "src/main.js": quelltext(["console.log(1);"]) });
  const auftrag = "aufraeumen/2026-10-03-jscpd";
  const commits = ["eins", "zwei", "drei"].map((name) => committe(repo, { [`src/${name}.js`]: quelltext([`export const ${name} = 1;`]) }, nachricht(`Lege ${name} an`, "jscpd", auftrag)));
  for (const sha of commits.toReversed()) nimmZurueck(repo, sha);
  committe(repo, { "src/vier.js": quelltext(["export const vier = 1;"]) }, nachricht("Lege vier an"));
  const liste = ruecknahmen(repo.ordner);
  assert.deepEqual(liste.map(({ sorte, auftrag: kennung }) => [sorte, kennung]), [["jscpd", auftrag]]);
});

test("ziele-pause: eine Rücknahme mit zusätzlichem Absatz zählt wie bei der Commit-Prüfung", async (context) => {
  const repo = zieleRepo(context, { "src/main.js": quelltext(["console.log(1);"]) });
  const original = committe(repo, { "src/a.js": quelltext(["export const a = 1;"]) }, nachricht("Lege a an"));
  repo.committe({ "src/a.js": quelltext(["export const a = 0;"]) }, `Revert "Lege a an"\n\nThis reverts commit ${original}.\n\nWarum: Tests auf master rot.`);
  assert.deepEqual(ruecknahmen(repo.ordner).map(({ sorte, original: sha }) => [sorte, sha]), [["knip", original]]);
});

test("ziele-pause: ein Revert ohne Standardform oder ohne Sorte zählt nicht", async (context) => {
  const repo = zieleRepo(context, { "src/main.js": quelltext(["console.log(1);"]) });
  const ohneSorte = committe(repo, { "src/a.js": quelltext(["export const a = 1;"]) }, "Lege a an\n\nWarum: Probe.\n\nPaket: 30");
  nimmZurueck(repo, ohneSorte);
  const mitSorte = committe(repo, { "src/b.js": quelltext(["export const b = 1;"]) }, nachricht("Lege b an"));
  repo.committe({ "src/b.js": quelltext(["export const b = 2;"]) }, `Revert "Lege b an"\n\nReverts sundartha/hermes#9 (${mitSorte})`);
  assert.deepEqual(ruecknahmen(repo.ordner), []);
});
