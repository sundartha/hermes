import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { sammelText } from "../../tools/ziele/sammel.mjs";

import {
  arbeitsordner,
  botIssue,
  ersatzGh,
  gelesen,
  githubAttrappe,
  LAUF,
  mitUrsprung,
  quelltext,
  starteZiele,
  testFuer,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const WEITER = { ausgang: "weiter", grund: "", befunde: [], start: new Date().toISOString() };
const AUFRAEUM_COMMITS = 20;
const ECHTE_AENDERUNGEN = 3;
const PRUEFER_ISSUES = 40;
const ERSTES_PRUEFER_ISSUE = 100;
const SAMMEL_TITEL = "Aufräumen: Rangliste und Befunde";

function exporte(namen) {
  return quelltext(namen.map((name) => `export function ${name}() {\n  return "${name}";\n}`));
}

function verschachtelt(name, tiefe) {
  const zeilen = [`export function ${name}(liste) {`];
  for (let stufe = 1; stufe <= tiefe; stufe += 1) zeilen.push(`${"  ".repeat(stufe)}for (const wert${stufe} of liste) {`);
  zeilen.push(`${"  ".repeat(tiefe + 1)}if (wert${tiefe}) return wert${tiefe};`);
  for (let stufe = tiefe; stufe >= 1; stufe -= 1) zeilen.push(`${"  ".repeat(stufe)}}`);
  zeilen.push("  return null;", "}");
  return zeilen.join("\n");
}

function grosseDatei(fassung) {
  return quelltext([`const FASSUNG = ${fassung};`, verschachtelt("gross", 6), 'export function heiss() {\n  return FASSUNG;\n}']);
}

function flach(name, zeilen, fassung) {
  return quelltext(Array.from({ length: zeilen }, (_wert, index) => `export const ${name}${index} = ${fassung} + ${index};`));
}

test("ziele-rangliste: der Brennpunkt ist Änderungen mal Umfang, und tiefe Einrückung zählt mehr", async (context) => {
  const repo = zieleRepo(context, {
    "src/main.js": quelltext(['console.log("main");']),
    "src/tief.js": quelltext([verschachtelt("tief", 8)]),
    "src/oft.js": flach("oft", 10, 0),
    "src/sehroft.js": flach("sehrOft", 3, 0),
  });
  for (let fassung = 1; fassung < 30; fassung += 1) {
    repo.committe({ "src/sehroft.js": flach("sehrOft", 3, fassung), ...(fassung < 20 ? { "src/oft.js": flach("oft", 10, fassung) } : {}) }, `Ändere (${fassung})`);
  }
  const durchgang = gelesen(await waehle(context, repo, await githubAttrappe(context)), "ziel/durchgang.json");
  const drei = durchgang.rangliste.filter(({ datei }) => ["src/tief.js", "src/oft.js", "src/sehroft.js"].includes(datei));
  assert.deepEqual(drei.map(({ datei, aenderungen }) => [datei, aenderungen]), [["src/oft.js", 20], ["src/tief.js", 1], ["src/sehroft.js", 30]]);
});

function repoMitBrennpunkt(context) {
  const repo = zieleRepo(context, {
    "test/haupt.test.js": testFuer("src/main.js"),
    "src/main.js": quelltext(['import { gross } from "./gross.js";', 'import { klein } from "./klein.js";', "console.log(gross([]), klein());"]),
    "src/gross.js": grosseDatei(0),
    "src/klein.js": exporte(["klein", "k2", "k3", "k4"]),
  });
  for (let fassung = 1; fassung <= ECHTE_AENDERUNGEN; fassung += 1) repo.committe({ "src/gross.js": grosseDatei(fassung) }, `Ändere gross.js (${fassung})`);
  for (let lauf = 1; lauf <= AUFRAEUM_COMMITS; lauf += 1) {
    repo.committe({ "src/klein.js": `${exporte(["klein", "k2", "k3", "k4"])}// Lauf ${lauf}\n` }, `Räume src/klein.js auf\n\nAuftrag: aufraeumen/2026-10-01-knip\nArt: aufraeumen\nSorte: knip`);
  }
  return repo;
}

async function waehle(context, repo, github) {
  const ordner = arbeitsordner(context, { "ziel/vorpruefung.json": WEITER });
  const lauf = await starteZiele(["waehlen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github) });
  assert.equal(lauf.status, 0, lauf.stderr);
  return ordner;
}

function platz(durchgang, datei) {
  return durchgang.rangliste.findIndex((eintrag) => eintrag.datei === datei);
}

test("ziele-rangliste: eine große, oft geänderte Datei steht vor einer kleinen, selten geänderten; Aufräum-Commits zählen nicht", async (context) => {
  const repo = repoMitBrennpunkt(context);
  const ordner = await waehle(context, repo, await githubAttrappe(context));
  const durchgang = gelesen(ordner, "ziel/durchgang.json");
  const [gross, klein] = ["src/gross.js", "src/klein.js"].map((datei) => durchgang.rangliste[platz(durchgang, datei)]);
  assert.ok(platz(durchgang, "src/gross.js") < platz(durchgang, "src/klein.js"));
  assert.deepEqual([gross.aenderungen, klein.aenderungen], [ECHTE_AENDERUNGEN + 1, 1]);
  assert.ok(gross.umfang > klein.umfang);
  assert.equal(durchgang.master, repo.sha());
});

test("ziele-rangliste: die Zielwahl folgt der Rangliste, nicht der Zahl der Befunde in einer Datei", async (context) => {
  const repo = repoMitBrennpunkt(context);
  const ziel = gelesen(await waehle(context, repo, await githubAttrappe(context)), "ziel/ziel.json");
  assert.deepEqual([ziel.ausgang, ziel.sorte, ziel.datei], ["weiter", "knip", "src/gross.js"]);
  assert.deepEqual(ziel.kandidaten.map(({ datei }) => datei), ["src/gross.js", "src/klein.js"]);
});

test("ziele-rangliste: ein Aufräum-PR einer Art, die nicht in tools/ziele/umbau-arten.json steht, bekommt kein Auto-Merge", async (context) => {
  const repo = zieleRepo(context, { "src/frei.js": exporte(["frei"]) });
  mitUrsprung(context, repo);
  const github = await githubAttrappe(context);
  const gh = ersatzGh(context);
  const ziel = { ausgang: "weiter", grund: "", master: repo.sha(), sorte: "umbau", datei: "src/frei.js", zielbefunde: ["Probe"] };
  const ordner = arbeitsordner(context, { "ziel/ziel.json": ziel, "ausgaben.txt": "" });
  const lauf = await starteZiele(["pr", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github, { PATH: `${gh.pfad}:${process.env.PATH}`, GITHUB_OUTPUT: join(ordner, "ausgaben.txt") }) });
  assert.equal(lauf.status, 0, lauf.stderr);
  const [pr] = github.zustand.angelegtePrs;
  assert.equal(pr.head, `aufraeumen/umbau-${LAUF}`);
  assert.deepEqual(gh.aufrufe(), []);
  assert.deepEqual(github.zustand.anfragen.filter((anfrage) => !anfrage.startsWith("GET ")), ["POST /pulls"]);
  const ergebnis = gelesen(ordner, "pr/pr.json");
  assert.deepEqual([ergebnis.ausgang, ergebnis.pr, ergebnis.autoMerge], ["geaendert", pr.number, false]);
  assert.match(ergebnis.grund, /umbau/);
});

function prueferIssues() {
  const dateien = ["src/gross.js", "src/klein.js", "src/main.js", "test/haupt.test.js"];
  return Array.from({ length: PRUEFER_ISSUES }, (_wert, index) => {
    const titel = `Prüfer: G${(index % 5) + 1} in \`${dateien[index % dateien.length]}\``;
    return botIssue(ERSTES_PRUEFER_ISSUE + index, titel, { labels: [{ name: "pruefer" }] });
  });
}

async function vollerLauf(context, repo, github) {
  const ordner = await waehle(context, repo, github);
  const lauf = await starteZiele(["ergebnis", "--ordner", ordner, "--workflow", "aufraeumen"], { cwd: repo.ordner, env: umgebung(github) });
  assert.equal(lauf.status, 0, lauf.stderr);
}

test("ziele-rangliste: Läufe mit vielen Befunden legen höchstens ein Sammel-Issue an und ersetzen danach nur dessen Text", async (context) => {
  const repo = repoMitBrennpunkt(context);
  repo.committe({ "eslint-suppressions.json": JSON.stringify({ "src/gross.js": { "no-var": { count: 7 } }, "src/klein.js": { "no-var": { count: 2 } } }) }, "Friere Verstöße ein");
  const github = await githubAttrappe(context, { issues: prueferIssues() });
  await vollerLauf(context, repo, github);
  await vollerLauf(context, repo, github);
  const sammel = github.zustand.issues.filter(({ title }) => title === SAMMEL_TITEL);
  assert.equal(sammel.length, 1);
  assert.equal(github.zustand.issues.length, PRUEFER_ISSUES + 1);
  const schreibend = github.zustand.anfragen.filter((anfrage) => /^(?:POST|PATCH) \/issues/.test(anfrage));
  assert.deepEqual(schreibend, ["POST /issues", `PATCH /issues/${sammel[0].number}`]);
  assert.deepEqual(github.zustand.kommentare, []);
  const [issue] = sammel;
  assert.deepEqual([issue.state, issue.labels.map(({ name }) => name), issue.user.login], ["open", ["aufraeumen"], "github-actions[bot]"]);
  assert.match(issue.body, /`pruefer` 40/);
  assert.match(issue.body, /`eslint` 9/);
  assert.match(issue.body, /^- `G1` in 4 Dateien$/m);
  assert.match(issue.body, /^\| 1 \| `src\/gross\.js` \|/m);
  assert.ok(issue.body.length <= 65_536);
});

test("ziele-rangliste: ein geschlossenes Sammel-Issue öffnet der nächste Lauf wieder, ein gleichnamiges Issue eines Menschen bleibt unberührt", async (context) => {
  const repo = repoMitBrennpunkt(context);
  const fremd = botIssue(ERSTES_PRUEFER_ISSUE, SAMMEL_TITEL, { labels: [{ name: "aufraeumen" }], user: { login: "jemand" } });
  const github = await githubAttrappe(context, { issues: [fremd] });
  await vollerLauf(context, repo, github);
  const [eigenes] = github.zustand.issues.filter(({ title, user }) => title === SAMMEL_TITEL && user.login !== "jemand");
  eigenes.state = "closed";
  await vollerLauf(context, repo, github);
  assert.deepEqual(github.zustand.issues.map(({ number, state }) => [number, state]), [[ERSTES_PRUEFER_ISSUE, "open"], [eigenes.number, "open"]]);
  assert.equal(fremd.body, "");
  assert.deepEqual(github.zustand.ereignisse.map(({ nummer, event }) => [nummer, event]), [[eigenes.number, "reopened"]]);
});

test("ziele-rangliste: der Text des Sammel-Issues bleibt bei einer langen Rangliste unter 60 000 Zeichen und nennt den Rest", () => {
  const rangliste = Array.from({ length: 3000 }, (_wert, index) => ({ datei: `src/datei-${index}.js`, befunde: 1, pruefungen: ["knip"], aenderungen: 1, umfang: 1, brennpunkt: 1 }));
  const text = sammelText({ durchgang: { master: "a".repeat(40), befunde: [], vorschlaege: [], rangliste }, ergebnis: { lauf: "4242" } });
  assert.ok(text.length <= 60_000);
  const gezeigt = (text.match(/^\| \d+ \| `src\/datei-/gm) ?? []).length;
  assert.ok(gezeigt > 500);
  assert.ok(text.endsWith(`Die übrigen ${3000 - gezeigt} Dateien stehen in \`durchgang.json\` im Artefakt \`ziel\` des Laufs.`));
});
