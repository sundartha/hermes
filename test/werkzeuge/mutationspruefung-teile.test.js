import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bestaetige } from "../../tools/mutationspruefung/bestaetigung.mjs";
import { TESTDATEIEN_JE_ANTEIL } from "../../tools/mutationspruefung/teile.mjs";
import { EXIT_ROT, werkzeug } from "./mutationspruefung-probe.js";
import { REPO_ROOT, commitAll, probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const WORKFLOW = join(REPO_ROOT, ".github/workflows/ci.yml");
const EXIT_ABBRUCH = 2;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const URTEIL = /^(?:grün|rot): .+$/gm;
const BESTAETIGUNG = /^Bestätigung: .+$/gm;
const JOB = /^ {2}([a-z][\w-]*):$/;
const SAMMELJOB = "ci";
const SAMMELSCHRITT = "      - name: Alle Jobs erfolgreich";
const SKRIPTZEILE = /^ {10}/;
const NICHT_ERFOLGREICH = ["failure", "cancelled", "skipped"];

function quelle(...zeilen) {
  return ["export function einordnen(zahl) {", ...zeilen, '  return "positiv";', "}", ""].join("\n");
}

function testdatei(modul, ...pruefungen) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import * as modul from "../src/${modul}";`,
    'test("probe", () => {',
    ...pruefungen.map((pruefung) => `  ${pruefung}`),
    "});",
    "",
  ].join("\n");
}

const NEGATIV = '  if (zahl < 0) return "negativ";';
const NULL = '  if (zahl === 0) return "null";';
const ZEHN = '  if (zahl === 10) return "zehn";';
const GROSS = "export const gross = (wort) => wort.toUpperCase();\n";
const KLEIN = "export const klein = (wort) => wort.toLowerCase();\n";
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/zahl.test.js": testdatei("zahl.js", 'assert.equal(modul.einordnen(-1), "negativ");', 'assert.equal(modul.einordnen(1), "positiv");'),
  "src/wort.js": GROSS,
  "test/wort.test.js": testdatei("wort.js", 'assert.equal(modul.gross("ab"), "AB");'),
};
const ZWEI_DATEIEN = {
  "src/zahl.js": quelle(NEGATIV, NULL),
  "src/wort.js": GROSS + KLEIN,
  "test/wort.test.js": testdatei("wort.js", 'assert.equal(modul.gross("ab"), "AB");', 'assert.equal(modul.klein("AB"), "ab");'),
};

function pruefe(repo, ...argumente) {
  return werkzeug(repo, "HEAD", ...argumente);
}

function treffer(ausgabe, muster) {
  return [...ausgabe.matchAll(muster)].map(([gefunden, gruppe]) => gruppe ?? gefunden).sort();
}

function plane(context, repo) {
  const ziel = join(probeDirectory(context, {}), "plan.json");
  const lauf = pruefe(repo, "--plan", ziel);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return JSON.parse(readFileSync(ziel, "utf8"));
}

function messeTeile(context, repo, ordner) {
  const plan = plane(context, repo);
  mkdirSync(ordner, { recursive: true });
  const laeufe = plan.teile.map((teil) =>
    pruefe(repo, "--teil", String(teil), "--teile", String(plan.anzahl), "--ergebnis", join(ordner, `mutation-teil-${teil}.json`)),
  );
  return { plan, laeufe };
}

function teilergebnisse(ordner) {
  return readdirSync(ordner).map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
}

function dateienJeTeil(ordner) {
  return teilergebnisse(ordner).map(({ messungen }) => [
    ...new Set(messungen.flatMap(({ ergebnisse }) => ergebnisse.map(({ schluessel }) => schluessel.split(":")[0]))),
  ]);
}

function ergebnisordner(context) {
  return probeDirectory(context, {});
}

function messeZweiTeile(context, repo, ordner) {
  const { plan, laeufe } = messeTeile(context, repo, ordner);
  assert.equal(plan.anzahl, 2);
  for (const lauf of laeufe) assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return laeufe;
}

function zweiDateienGemessen(context) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, ZWEI_DATEIEN);
  const ordner = ergebnisordner(context);
  messeTeile(context, repo, ordner);
  return { repo, ordner };
}

test("die Teile messen zusammen genau dieselben Dateien und Mutanten wie der ganze Lauf, jede Datei in genau einem Teil", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, ZWEI_DATEIEN);
  const ganz = pruefe(repo);
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  const ordner = ergebnisordner(context);
  messeZweiTeile(context, repo, ordner);
  const dateien = dateienJeTeil(ordner);
  assert.deepEqual(dateien.flat().sort(), ["src/wort.js", "src/zahl.js"]);
  assert.ok(dateien.every((teil) => teil.length === 1), JSON.stringify(dateien));
  const urteil = pruefe(repo, "--urteil", ordner);
  assert.equal(urteil.status, EXIT_ROT, urteil.stdout + urteil.stderr);
  assert.deepEqual(treffer(urteil.stdout, UEBERLEBT), treffer(ganz.stdout, UEBERLEBT));
  assert.ok(treffer(urteil.stdout, UEBERLEBT).every((mutant) => mutant.startsWith("src/zahl.js:3:")), urteil.stdout);
  assert.deepEqual(treffer(urteil.stdout, URTEIL), treffer(ganz.stdout, URTEIL));
  assert.deepEqual(treffer(urteil.stdout, BESTAETIGUNG), treffer(ganz.stdout, BESTAETIGUNG));
});

const ABSTURZ = /^Verstoß: Bestätigung abgebrochen \(Absturz\) in test\/zahl\.test\.js, Ursache im Testaufbau prüfen \(.+\): src\/zahl\.js:3:7 /m;

async function bestaetigterUndAbgestuerzter() {
  const mutant = { schluessel: "src/zahl.js:3:7 EqualityOperator → zahl <= 0", status: "Killed", toeter: ["test/zahl.test.js"], zeilen: [3, 3], art: "EqualityOperator" };
  const [bestaetigter] = await bestaetige([mutant], async () => [mutant]);
  const [abgestuerzter] = await bestaetige([mutant], async () => [{ ...mutant, status: "RuntimeError", toeter: [] }]);
  return [bestaetigter, abgestuerzter];
}

test("meldet ein Teil für einen Mutanten einen bestätigten Kill und einer einen Absturz in der Bestätigung, bleibt das Urteil rot mit dem Absturz-Befund, in jeder Reihenfolge", async (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const { teile, pruefsumme } = plane(context, repo);
  const ergebnisse = await bestaetigterUndAbgestuerzter();
  for (const reihenfolge of [ergebnisse, [...ergebnisse].reverse()]) {
    const ordner = ergebnisordner(context);
    for (const teil of teile) {
      const messungen = teil === teile[0] ? [{ pruefung: 0, ergebnisse: reihenfolge }] : [];
      writeFileSync(join(ordner, `mutation-teil-${teil}.json`), JSON.stringify({ pruefsumme, teil, messungen }));
    }
    const urteil = pruefe(repo, "--urteil", ordner);
    assert.equal(urteil.status, EXIT_ROT, urteil.stdout + urteil.stderr);
    assert.match(urteil.stdout, ABSTURZ);
    assert.deepEqual(treffer(urteil.stdout, UEBERLEBT), []);
  }
});

function fuellung(anzahl) {
  return Object.fromEntries(
    Array.from({ length: anzahl }, (_leer, index) => [
      `test/fuellung-${String(index).padStart(3, "0")}.test.js`,
      testdatei("zahl.js", 'assert.equal(typeof modul.einordnen, "function");'),
    ]),
  );
}

test("eine Datei mit vielen erreichenden Testdateien wird nach Testdateien geteilt; tötet nur ein Anteil den Mutanten, ist er im Urteil getötet", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...fuellung(TESTDATEIEN_JE_ANTEIL) });
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL, ZEHN),
    "test/fuellung-000.test.js": testdatei("zahl.js", 'assert.equal(modul.einordnen(0), "null");'),
    "test/zahl.test.js": testdatei("zahl.js", 'assert.equal(modul.einordnen(10), "zehn");', 'assert.equal(modul.einordnen(1), "positiv");'),
  });
  const ordner = ergebnisordner(context);
  const laeufe = messeZweiTeile(context, repo, ordner);
  assert.ok(laeufe.some((lauf) => / [1-9]\d* in diesen Testdateien nicht getötet/.test(lauf.stdout)), laeufe.map((lauf) => lauf.stdout).join("\n"));
  const urteil = pruefe(repo, "--urteil", ordner);
  assert.equal(urteil.status, 0, urteil.stdout + urteil.stderr);
  assert.deepEqual(treffer(urteil.stdout, UEBERLEBT), []);
});

test("fehlt ein Teilergebnis oder gehört es zu einem anderen Stand, bricht das Urteil ab", (context) => {
  const { repo, ordner } = zweiDateienGemessen(context);
  rmSync(join(ordner, "mutation-teil-2.json"));
  const fehlt = pruefe(repo, "--urteil", ordner);
  assert.equal(fehlt.status, EXIT_ABBRUCH, fehlt.stdout + fehlt.stderr);
  assert.match(fehlt.stderr, /erwartet die Teile 1, 2, gefunden 1/);
  messeTeile(context, repo, ordner);
  writeFiles(repo, { "src/zahl.js": quelle(NULL, NEGATIV) });
  const anderer = pruefe(repo, "--urteil", ordner);
  assert.equal(anderer.status, EXIT_ABBRUCH, anderer.stdout + anderer.stderr);
  assert.match(anderer.stderr, /gehören zu einem anderen Plan/);
  writeFiles(repo, ZWEI_DATEIEN);
  messeTeile(context, repo, ordner);
  writeFiles(repo, { "notiz.txt": "anderer Commit\n" });
  commitAll(repo, "Notiere etwas");
  const andererCommit = werkzeug(repo, "HEAD~1", "--urteil", ordner);
  assert.equal(andererCommit.status, EXIT_ABBRUCH, andererCommit.stdout + andererCommit.stderr);
  assert.match(andererCommit.stderr, /gehören zu einem anderen Plan/);
});

test("ohne geänderte Zeile hat der Plan nur den leeren Teil 0; mit geänderten Zeilen bricht Teil 0 ab, ebenso eine falsche Teilezahl", (context) => {
  const repo = probeRepository(context, BASIS);
  const ordner = ergebnisordner(context);
  const leer = messeTeile(context, repo, ordner);
  assert.deepEqual([leer.plan.anzahl, leer.plan.teile], [0, [0]]);
  assert.equal(leer.laeufe[0].status, 0, leer.laeufe[0].stdout + leer.laeufe[0].stderr);
  const urteil = pruefe(repo, "--urteil", ordner);
  assert.equal(urteil.status, 0, urteil.stdout + urteil.stderr);
  assert.match(urteil.stdout, /^grün: keine geänderte Zeile unter src\//m);
  writeFiles(repo, ZWEI_DATEIEN);
  const ziel = join(ordner, "x.json");
  for (const [teil, teile] of [["0", "0"], ["1", "1"], ["3", "2"]]) {
    const lauf = pruefe(repo, "--teil", teil, "--teile", teile, "--ergebnis", ziel);
    assert.equal(lauf.status, EXIT_ABBRUCH, `${teil}/${teile}: ${lauf.stdout}${lauf.stderr}`);
  }
  const ohneErgebnis = pruefe(repo, "--teil", "1", "--teile", "2");
  assert.equal(ohneErgebnis.status, EXIT_ABBRUCH, ohneErgebnis.stdout + ohneErgebnis.stderr);
  const zweiArten = pruefe(repo, "--plan", ziel, "--urteil", ordner);
  assert.equal(zweiArten.status, EXIT_ABBRUCH, zweiArten.stdout + zweiArten.stderr);
});

function workflowJobs(zeilen) {
  return zeilen.slice(zeilen.indexOf("jobs:")).flatMap((zeile) => {
    const treffend = JOB.exec(zeile);
    return treffend ? [treffend[1]] : [];
  });
}

function sammeljob(zeilen) {
  const beginn = zeilen.indexOf(`  ${SAMMELJOB}:`);
  const needs = zeilen.slice(beginn).find((zeile) => zeile.startsWith("    needs: "));
  const schritt = zeilen.indexOf(SAMMELSCHRITT, beginn);
  const lauf = zeilen.findIndex((zeile, index) => index > schritt && zeile.trim() === "run: |");
  const ende = zeilen.findIndex((zeile, index) => index > lauf && !SKRIPTZEILE.test(zeile));
  return {
    needs: needs.replace("    needs: ", "").replace(/[[\]\s]/g, "").split(","),
    skript: zeilen.slice(lauf + 1, ende === -1 ? undefined : ende).map((zeile) => zeile.slice(10)).join("\n"),
  };
}

function sammelschritt(skript, ergebnisse) {
  return spawnSync("bash", ["-c", skript], { encoding: "utf8", env: { ...process.env, NEEDS: JSON.stringify(ergebnisse) } });
}

test("ein Mutationsteil oder das Urteil, das fehlt, abbricht, übersprungen wird oder rot ist, macht den Sammeljob CI rot", (context) => {
  const { repo, ordner } = zweiDateienGemessen(context);
  rmSync(join(ordner, "mutation-teil-1.json"));
  assert.equal(pruefe(repo, "--urteil", ordner).status, EXIT_ABBRUCH);
  const zeilen = readFileSync(WORKFLOW, "utf8").split("\n");
  const { needs, skript } = sammeljob(zeilen);
  const jobs = workflowJobs(zeilen).filter((job) => job !== SAMMELJOB);
  const gemeldet = (job, ergebnis) => Object.fromEntries(needs.map((name) => [name, { result: name === job ? ergebnis : "success" }]));
  assert.equal(sammelschritt(skript, gemeldet(null, "success")).status, 0);
  for (const job of jobs) {
    for (const ergebnis of NICHT_ERFOLGREICH) {
      const lauf = sammelschritt(skript, gemeldet(job, ergebnis));
      assert.equal(lauf.status, EXIT_ROT, `${job} ${ergebnis}: ${lauf.stdout}${lauf.stderr}`);
    }
  }
});
