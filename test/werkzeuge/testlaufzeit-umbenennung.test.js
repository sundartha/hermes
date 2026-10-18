import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { commitAll, probeRepository, REPO_ROOT, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/testlaufzeit-pruefen.mjs");
const ZEITGLIEDER = "tools/basis/zeitglieder-bestand.json";
const AUSKLINGEN = "tools/basis/testlaufzeit.json";
const REGELN = "tools/eslint-rules";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const NEU_ODER_STEIGT = "ist neu oder steigt";
const BELIEBIGE_AUSKLINGGRENZE_MS = 77;
const ALT = "test/alt.test.js";
const NEU = "test/alt.test.ts";
const TEST = [
  "setTimeout(() => {}, 1);",
  "export function warte(ms) {",
  "  return ms;",
  "}",
  "",
].join("\n");
const TEST_MIT_TYPEN = TEST.replace("warte(ms)", "warte(ms: number): number");
const NUR_ALS_SKRIPT_LESBAR = "setTimeout(() => {}, 1);\nwith (Math) {}\n";

function json(wert) {
  return `${JSON.stringify(wert)}\n`;
}

function regelDateien() {
  const dateien = readdirSync(join(REPO_ROOT, REGELN));
  return Object.fromEntries(dateien.map((datei) => [`${REGELN}/${datei}`, readFileSync(join(REPO_ROOT, REGELN, datei), "utf8")]));
}

function grundstand(dateien) {
  return {
    ".gitignore": "node_modules\n",
    "eslint.config.js": readFileSync(join(REPO_ROOT, "eslint.config.js"), "utf8"),
    ...regelDateien(),
    "tools/basis/echte-wartezeiten.json": "[]\n",
    [AUSKLINGEN]: json({
      ausklingen_grenze_ms: BELIEBIGE_AUSKLINGGRENZE_MS,
      ausklingen_bestand: [],
    }),
    [ZEITGLIEDER]: json({}),
    ...dateien,
  };
}

function repo(context, dateien) {
  const directory = probeRepository(context, grundstand(dateien));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(directory, "node_modules"));
  return directory;
}

function nachher(directory, { loeschen = [], dateien }) {
  for (const pfad of loeschen) rmSync(join(directory, pfad));
  writeFiles(directory, dateien);
  commitAll(directory, "Nachher");
  const run = runIn(directory, process.execPath, [TOOL, "--basis", "HEAD~1"]);
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function umbenannt(context, { inhalt, zeitglieder = { [NEU]: 1 } }) {
  const directory = repo(context, { [ALT]: TEST, [ZEITGLIEDER]: json({ [ALT]: 1 }) });
  return nachher(directory, {
    loeschen: [ALT],
    dateien: { [NEU]: inhalt, [ZEITGLIEDER]: json(zeitglieder) },
  });
}

test("testlaufzeit-umbenennung: eine Testdatei nur mit Typen umbenannt behält ihren Zeitglieder-Eintrag", (context) => {
  const lauf = umbenannt(context, { inhalt: TEST_MIT_TYPEN });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("testlaufzeit-umbenennung: eine umbenannte Testdatei mit geändertem Code bekommt einen neuen Eintrag", (context) => {
  const lauf = umbenannt(context, {
    inhalt: TEST_MIT_TYPEN.replace("return ms;", "return ms + 1;"),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, new RegExp(`${NEU} ${NEU_ODER_STEIGT}`));
});

test("testlaufzeit-umbenennung: nach einer Umbenennung nur mit Typen darf der Eintrag nicht steigen", (context) => {
  const lauf = umbenannt(context, { inhalt: TEST_MIT_TYPEN, zeitglieder: { [NEU]: 2 } });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, new RegExp(`${NEU} ${NEU_ODER_STEIGT}`));
});

test("testlaufzeit-umbenennung: nach einer Umbenennung nur mit Typen zählen alter und verschobener Eintrag zusammen", (context) => {
  const lauf = umbenannt(context, {
    inhalt: TEST_MIT_TYPEN,
    zeitglieder: { [ALT]: 1, [NEU]: 1 },
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, new RegExp(`${NEU} ${NEU_ODER_STEIGT}`));
});

test("testlaufzeit-umbenennung: ein neuer Eintrag für eine .ts-Testdatei ohne Paar ist rot", (context) => {
  const directory = repo(context, { [ALT]: TEST, [ZEITGLIEDER]: json({ [ALT]: 1 }) });
  const lauf = nachher(directory, {
    dateien: { [NEU]: TEST_MIT_TYPEN, [ZEITGLIEDER]: json({ [ALT]: 1, [NEU]: 1 }) },
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, new RegExp(`${NEU} ${NEU_ODER_STEIGT}`));
});

test("testlaufzeit-umbenennung: die Zeitglieder einer .ts-Testdatei werden gezählt", (context) => {
  const directory = repo(context, { [NEU]: TEST_MIT_TYPEN, [ZEITGLIEDER]: json({ [NEU]: 1 }) });
  const lauf = nachher(directory, {
    dateien: { [NEU]: `setInterval(() => {}, 1);\n${TEST_MIT_TYPEN}` },
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /test\/alt\.test\.ts: 2 direkte Zeitglieder, eingefroren sind 1/);
});

test("testlaufzeit-umbenennung: eine eingefrorene Testdatei, die ESLint nicht lesen kann, bleibt ein Befund statt eines Löschhinweises", (context) => {
  const directory = repo(context, {
    [ALT]: NUR_ALS_SKRIPT_LESBAR,
    [ZEITGLIEDER]: json({ [ALT]: 1 }),
  });
  const lauf = nachher(directory, { dateien: { "README.md": "Probe\n" } });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /test\/alt\.test\.js: ESLint kann die Datei nicht lesen/);
  assert.doesNotMatch(lauf.output, /Eintrag entfernen/);
});

function ausklingBestand(...eintraege) {
  return json({ ausklingen_grenze_ms: BELIEBIGE_AUSKLINGGRENZE_MS, ausklingen_bestand: eintraege });
}

function ausklingRepo(context) {
  return repo(context, {
    [ALT]: TEST,
    [ZEITGLIEDER]: json({ [ALT]: 1 }),
    [AUSKLINGEN]: ausklingBestand(ALT),
  });
}

test("testlaufzeit-umbenennung: ein Ausklingen-Eintrag wandert mit einer Umbenennung nur mit Typen", (context) => {
  const lauf = nachher(ausklingRepo(context), {
    loeschen: [ALT],
    dateien: {
      [NEU]: TEST_MIT_TYPEN,
      [ZEITGLIEDER]: json({ [NEU]: 1 }),
      [AUSKLINGEN]: ausklingBestand(NEU),
    },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("testlaufzeit-umbenennung: ein Ausklingen-Eintrag für eine neue .ts-Testdatei ohne Paar ist rot", (context) => {
  const lauf = nachher(ausklingRepo(context), {
    dateien: { [NEU]: "export const wert: number = 1;\n", [AUSKLINGEN]: ausklingBestand(ALT, NEU) },
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /test\/alt\.test\.ts ist neu im Bestand/);
});
