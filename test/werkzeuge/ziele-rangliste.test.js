import assert from "node:assert/strict";
import { test } from "node:test";

import {
  arbeitsordner,
  gelesen,
  githubAttrappe,
  quelltext,
  starteZiele,
  testFuer,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const WEITER = { ausgang: "weiter", grund: "", befunde: [], start: new Date().toISOString() };
const AUFRAEUM_COMMITS = 20;
const ECHTE_AENDERUNGEN = 3;

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
