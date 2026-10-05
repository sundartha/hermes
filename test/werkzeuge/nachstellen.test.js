import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPRODUKTION,
  fuehreReproduktionAus,
  stelleNach,
} from "../../tools/auftrag/nachstellen.mjs";
import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import { SCHEIN_TOKEN, scheinSha, starteEinstieg } from "./pruefer/hilfen.mjs";

const KURZE_FRIST_MS = 3000;
const HEAD = scheinSha("a");
const KOPF = ['import assert from "node:assert/strict";', 'import { test } from "node:test";'];
const PROJEKT = {
  "package.json": JSON.stringify({ type: "module" }),
  "src/zahl.js": "export const ZAHL = 1;\n",
};

function testDatei(...zeilen) {
  return [...KOPF, ...zeilen, ""].join("\n");
}

async function kategorieVon(context, inhalt) {
  const ordner = probeDirectory(context, PROJEKT);
  const { kategorie } = await fuehreReproduktionAus(ordner, inhalt);
  assert.equal(existsSync(join(ordner, REPRODUKTION)), false);
  return kategorie;
}

const IMPORT_ZAHL = 'import { ZAHL } from "../src/zahl.js";';
const NACHSTELLUNG = "nachstellung.json";
const WORKFLOWS = join(REPO_ROOT, ".github/workflows");

function blocker(reproduktion) {
  return {
    schwere: "BLOCKER",
    id: "SG-1",
    datei: "src/zahl.js",
    zeile: 1,
    beleg: "",
    reproduktion,
    reparatur: "",
    sicherheit: false,
  };
}

function ergebnisOrdner(context, branch, befunde) {
  const commit = { sha: HEAD, patchId: "", zustand: "geprueft", befunde };
  return probeDirectory(context, {
    "ergebnis.json": JSON.stringify({ format: 1, head: HEAD, branch, commits: [commit] }),
  });
}

function jobZeilen(datei, job, naechster) {
  const zeilen = readFileSync(join(WORKFLOWS, datei), "utf8").split("\n");
  return zeilen.slice(zeilen.indexOf(`  ${job}:`), zeilen.indexOf(`  ${naechster}:`));
}

test("eine scheiternde Erwartung ergibt erwartung", async (context) => {
  const inhalt = testDatei(IMPORT_ZAHL, 'test("zwei", () => assert.equal(ZAHL, 2));');
  assert.equal(await kategorieVon(context, inhalt), "erwartung");
});

test("ein fehlender Import ergibt laden", async (context) => {
  const inhalt = testDatei(
    'import { ZAHL } from "../src/fehlt.js";',
    'test("zwei", () => assert.equal(ZAHL, 2));',
  );
  assert.equal(await kategorieVon(context, inhalt), "laden");
});

test("eine Erwartung, die schon beim Laden scheitert, ergibt laden", async (context) => {
  const inhalt = testDatei("assert.equal(1, 2);", 'test("leer", () => {});');
  assert.equal(await kategorieVon(context, inhalt), "laden");
});

test("ein anderer Fehler im Test ergibt umgebung", async (context) => {
  const inhalt = testDatei('test("wirft", () => { throw new TypeError("kaputt"); });');
  assert.equal(await kategorieVon(context, inhalt), "umgebung");
});

test("ein bestehender Test ergibt gruen", async (context) => {
  const inhalt = testDatei(IMPORT_ZAHL, 'test("eins", () => assert.equal(ZAHL, 1));');
  assert.equal(await kategorieVon(context, inhalt), "gruen");
});

test("eine Endlosschleife ergibt zeit", async (context) => {
  const ordner = probeDirectory(context, PROJEKT);
  const { kategorie } = await fuehreReproduktionAus(
    ordner,
    testDatei('test("hängt", () => { for (;;) {} });'),
    KURZE_FRIST_MS,
  );
  assert.equal(kategorie, "zeit");
});

test("ein Reproduktionstest, der alle Umgebungsvariablen ausgibt, findet das Token aus der Umgebung von nachstellen nicht", async (context) => {
  const suche = testDatei(
    'test("sucht das Token", () => {',
    "  const alles = JSON.stringify(process.env);",
    "  console.log(alles);",
    '  assert.equal(process.env.CI, "true");',
    `  assert.equal(alles.includes(${JSON.stringify(SCHEIN_TOKEN)}), false);`,
    "});",
  );
  const ergebnis = ergebnisOrdner(context, "rotprobe/token", [blocker(suche)]);
  const [pr, basis, aus] = [
    probeDirectory(context, PROJEKT),
    probeDirectory(context, PROJEKT),
    probeDirectory(context, {}),
  ];
  const umgebung = { ...isolatedEnvironment(), CLAUDE_CODE_OAUTH_TOKEN: SCHEIN_TOKEN };
  const args = [
    "pruefer",
    "nachstellen",
    "--ergebnis",
    ergebnis,
    "--pr",
    pr,
    "--basis",
    basis,
    "--aus",
    aus,
  ];
  const lauf = await starteEinstieg(args, { cwd: pr, umgebung });
  assert.equal(lauf.status, 0, lauf.stderr);
  const { ergebnisse } = JSON.parse(readFileSync(join(aus, NACHSTELLUNG), "utf8"));
  assert.deepEqual(ergebnisse, [{ schluessel: `${HEAD}-0`, pr: "gruen", basis: "gruen" }]);
  assert.equal(`${lauf.stdout}${lauf.stderr}`.includes(SCHEIN_TOKEN), false);
});

test("nachstellen schreibt nachstellung.json vor der ersten und nach jeder Reproduktion fort", async (context) => {
  const aus = probeDirectory(context, {});
  const datei = JSON.stringify(join(aus, NACHSTELLUNG));
  const standIst = (erwartet) =>
    testDatei(
      'import { readFileSync } from "node:fs";',
      'test("Stand", () => {',
      `  const { ergebnisse } = JSON.parse(readFileSync(${datei}, "utf8"));`,
      `  assert.deepEqual(ergebnisse, ${JSON.stringify(erwartet)});`,
      "});",
    );
  const erster = { schluessel: `${HEAD}-0`, pr: "gruen", basis: "gruen" };
  const zweiter = { schluessel: `${HEAD}-1`, pr: "gruen", basis: "gruen" };
  const befunde = [blocker(standIst([])), blocker(standIst([erster]))];
  const ergebnis = ergebnisOrdner(context, "paket/28-probe", befunde);
  const [pr, basis] = [probeDirectory(context, PROJEKT), probeDirectory(context, PROJEKT)];
  await stelleNach({ ergebnis, pr, basis, aus });
  const { ergebnisse } = JSON.parse(readFileSync(join(aus, NACHSTELLUNG), "utf8"));
  assert.deepEqual(ergebnisse, [erster, zweiter]);
  assert.equal(existsSync(join(aus, ".nachstellung.json.neu")), false);
});

test("der Job nachstellen hat die Job-Grenze von pruefen und laedt die Nachstellung mit always() hoch", () => {
  const grenze = "    timeout-minutes: 360";
  const nachstellen = jobZeilen("pruefer-nachstellen.yml", "nachstellen", "entscheiden");
  assert.ok(jobZeilen("pruefer-pruefen.yml", "pruefen", "melden").includes(grenze));
  assert.ok(nachstellen.includes(grenze));
  const upload = nachstellen.indexOf("      - name: Nachstellung hochladen");
  assert.match(nachstellen[upload + 1], /^ {8}if: always\(\)/);
});
