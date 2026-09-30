import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_ROT = 1;
const ZEILEN_UEBER_GRENZE = 401;
const ANTWORTEN_JE_SITZUNG = 2;
const AUSFUEHRBAR = 0o755;
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const argumente = process.argv.slice(2);
const sitzung = argumente[argumente.indexOf("--session-id") + 1];
const rolle = process.env.HERMES_ROLLE;
const drehbuch = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"));
writeFileSync(join(dirname(process.env.ERSATZ_DREHBUCH), "prompt-" + rolle + ".txt"), readFileSync(0, "utf8"));
for (const [pfad, inhalt] of Object.entries(drehbuch[rolle] ?? {})) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
const projekt = join(homedir(), ".claude", "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(projekt, { recursive: true });
const zeile = (id) => JSON.stringify({ message: { id, usage: { input_tokens: 10, output_tokens: 5 } } });
writeFileSync(join(projekt, sitzung + ".jsonl"), [zeile("a"), zeile("a"), zeile("b")].join("\\n"));
`;

const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

const BASIS = {
  "package.json": JSON.stringify({
    type: "module",
    scripts: { test: "node --test --test-reporter=tap", lint: "node -e 0", "test:betroffen": "node -e 0 --" },
  }),
  ".gitignore": ".fortschritt/\n",
  ".github/CODEOWNERS": "/src/geschuetzt.js @probe\n",
  "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl;\n}\n",
  "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n",
  "src/geschuetzt.js": "export const WERT = 1;\n",
  "test/text.test.js": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { gross } from "../src/text.js";',
    'test("gross", () => assert.equal(gross("a"), "A"));',
    "",
  ].join("\n"),
};

function funktion(erwarteterFehler) {
  return {
    id: "A1",
    art: "funktion",
    ziel: "Verdopple Zahlen",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", "test/rechnen.test.js"],
    vorbild: "src/text.js",
    abnahme: "test/rechnen.test.js",
    erwarteterFehler,
    wasDarfNiePassieren: NIE,
  };
}

const UMBAU = {
  id: "A1",
  art: "umbau",
  ziel: "Räume src auf",
  bereich: "src/",
  erwarteteDateien: ["src/text.js"],
  vorbild: "src/text.js",
  abnahme: "test/text.test.js",
};

function starte(context, { auftrag, drehbuch }) {
  const repo = probeRepository(context, BASIS);
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const werkzeug = probeDirectory(context, {});
  const phase = { phase: "probe", entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag] };
  writeFileSync(join(werkzeug, "phase.json"), JSON.stringify(phase));
  writeFileSync(join(werkzeug, "drehbuch.json"), JSON.stringify(drehbuch));
  writeFileSync(join(werkzeug, "claude.mjs"), ERSATZ_CLAUDE);
  chmodSync(join(werkzeug, "claude.mjs"), AUSFUEHRBAR);
  const kopf = () => runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const basis = kopf();
  const lauf = spawnSync(process.execPath, [EINSTIEG, "lauf", join(werkzeug, "phase.json")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...isolatedEnvironment(),
      HOME: werkzeug,
      HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
      ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
    },
  });
  const belegDatei = join(repo, ".fortschritt/probe/A1.json");
  const beleg = existsSync(belegDatei) ? JSON.parse(readFileSync(belegDatei, "utf8")) : null;
  return { repo, werkzeug, lauf, beleg, basis, kopf: kopf() };
}

test("ein grüner Auftrag committet einmal und schreibt die Belegdatei mit Befehl und Exit-Code", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const { repo, werkzeug, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "grün");
  const namen = beleg.pruefungen.map(({ name }) => name);
  for (const name of ["rot", "grenzen test", "grenzen bau", "lint", "abnahme", "betroffene tests", "commit"]) {
    assert.ok(namen.includes(name), name);
  }
  for (const { name, befehl, exitCode } of beleg.pruefungen) {
    assert.ok(befehl.length > 0, name);
    assert.equal(exitCode, 0, name);
  }
  assert.equal(runIn(repo, "git", ["rev-list", "--count", `${basis}..HEAD`]).stdout.trim(), "1");
  const commit = runIn(repo, "git", ["show", "--name-only", "--format=", "HEAD"]).stdout;
  assert.deepEqual(commit.trim().split("\n").sort(), ["src/rechnen.js", "test/rechnen.test.js"]);
  assert.equal(beleg.kosten.gemessen, true);
  assert.equal(beleg.kosten.summe.turns, ANTWORTEN_JE_SITZUNG * beleg.agenten.length);
  assert.match(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8"), /2 !== 4/);
});

test("ein roter Test mit falschem Fehlertext stoppt den Auftrag vor dem Bau-Agenten", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: {} };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("3 !== 4"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(beleg.ergebnis, "rot");
  const rot = beleg.pruefungen.find(({ name }) => name === "rot");
  assert.equal(rot.exitCode, EXIT_ROT);
  assert.ok(rot.zeilen.some((zeile) => zeile.includes("nicht mit dem erwarteten Fehler")));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("der Bau-Agent wird an Bereich, Zeilengrenze, geschützten Dateien, Tests und Belegen gestoppt", (context) => {
  const faelle = [
    { bau: { "lib/fremd.js": "x\n" }, erwartet: "außerhalb des Bereichs src/: lib/fremd.js" },
    { bau: { "src/gross.js": "x\n".repeat(ZEILEN_UEBER_GRENZE) }, erwartet: "erlaubt sind 400" },
    { bau: { "src/geschuetzt.js": "export const WERT = 2;\n" }, erwartet: "geschützte Datei geändert" },
    { bau: { "test/text.test.js": "neu\n" }, erwartet: "Bau-Agent hat einen Test geändert" },
    { bau: { ".fortschritt/probe/A1.json": "{}\n" }, erwartet: "hat .fortschritt/ verändert" },
  ];
  for (const { bau, erwartet } of faelle) {
    const { lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau } });
    assert.equal(lauf.status, EXIT_ROT, erwartet);
    assert.equal(beleg.ergebnis, "rot", erwartet);
    assert.ok(JSON.stringify(beleg).includes(erwartet), `${erwartet}: ${JSON.stringify(beleg)}`);
    assert.equal(kopf, basis, erwartet);
  }
});

test("der Test-Agent darf nur den Abnahmetest und erwartete Testdateien ändern", (context) => {
  const testDateien = { "test/rechnen.test.js": ROTER_TEST, "test/text.test.js": "angehängt\n" };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { test: testDateien } });
  assert.equal(lauf.status, EXIT_ROT);
  assert.ok(JSON.stringify(beleg).includes("fremden Test geändert: test/text.test.js"));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("lauf mit unvollständiger Phase startet keinen Agenten", (context) => {
  const ohneNie = { ...funktion("2 !== 4"), wasDarfNiePassieren: undefined };
  const { werkzeug, lauf } = starte(context, { auftrag: ohneNie, drehbuch: {} });
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /wasDarfNiePassieren fehlt/);
  assert.equal(existsSync(join(werkzeug, "prompt-test.txt")), false);
});
