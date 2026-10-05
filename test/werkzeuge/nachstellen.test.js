import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPRODUKTION, fuehreReproduktionAus } from "../../tools/auftrag/nachstellen.mjs";
import { isolatedEnvironment, probeDirectory } from "./probe-repo.js";
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
  const befund = {
    schwere: "BLOCKER",
    id: "SG-1",
    datei: "src/zahl.js",
    zeile: 1,
    beleg: "",
    reproduktion: suche,
    reparatur: "",
    sicherheit: false,
  };
  const commit = { sha: HEAD, patchId: "", zustand: "geprueft", befunde: [befund] };
  const ergebnis = probeDirectory(context, {
    "ergebnis.json": JSON.stringify({
      format: 1,
      head: HEAD,
      branch: "rotprobe/token",
      commits: [commit],
    }),
  });
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
  const { ergebnisse } = JSON.parse(readFileSync(join(aus, "nachstellung.json"), "utf8"));
  assert.deepEqual(ergebnisse, [{ schluessel: `${HEAD}-0`, pr: "gruen", basis: "gruen" }]);
  assert.equal(`${lauf.stdout}${lauf.stderr}`.includes(SCHEIN_TOKEN), false);
});
