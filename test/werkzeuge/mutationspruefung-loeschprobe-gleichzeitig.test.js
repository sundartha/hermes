import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { isolatedEnvironment, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const MODUL = pathToFileURL(join(REPO_ROOT, "tools/mutationspruefung/zeilen-loeschen.mjs")).href;
const DATEI = "src/zahl.js";
const ERSTE = "test/erste.test.js";
const ZWEITE = "test/zweite.test.js";
const BUCHSTABEN = ["a", "b", "c", "d", "e", "f"];
const ZEILEN_VOR_DEM_ERSTEN = 2;
const LAUFPROTOKOLL = "laeufe";
const SKRIPT_FRIST_MS = 120_000;
const ZWEITE_VERLANGT_C = 'assert.ok(zahl.protokoll.includes("c"));';

function zeileVon(buchstabe) {
  return ZEILEN_VOR_DEM_ERSTEN + BUCHSTABEN.indexOf(buchstabe) + 1;
}

const ALLE_ZEILEN = [[zeileVon("a"), zeileVon("f")]];

const QUELLE = [
  "export const protokoll = [];",
  "export function ablauf() {",
  ...BUCHSTABEN.map((buchstabe) => `  protokoll.push("${buchstabe}");`),
  "}",
  "",
].join("\n");

const ERSTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'import { test } from "node:test";',
  'import * as zahl from "../src/zahl.js";',
  'test("erste Gruppe", () => {',
  "  zahl.ablauf();",
  `  const fehlend = ${JSON.stringify(BUCHSTABEN)}.filter((buchstabe) => !zahl.protokoll.includes(buchstabe));`,
  `  appendFileSync(join(process.env.MARKEN, "${LAUFPROTOKOLL}"), \`\${process.cwd()} \${fehlend.join("")}\\n\`);`,
  "  assert.ok(fehlend.length <= 1);",
  '  assert.ok(zahl.protokoll.includes("a"));',
  '  const marke = join(process.env.MARKEN, "e");',
  '  if (fehlend[0] === "e" && !existsSync(marke)) {',
  '    writeFileSync(marke, "");',
  '    assert.fail("wackelt");',
  "  }",
  '  if (fehlend[0] === "f" && process.env.HAENGEN !== undefined) return new Promise(() => setInterval(() => {}, 1000));',
  '  if (fehlend[0] === "f") process.kill(process.ppid, "SIGKILL");',
  "});",
  "",
].join("\n");

function zweiterTest(pruefung) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import * as zahl from "../src/zahl.js";',
    'test("zweite Gruppe", () => {',
    "  zahl.ablauf();",
    `  ${pruefung}`,
    "});",
    "",
  ].join("\n");
}

const SKRIPT = `
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "node:test";
import { loeschprobe } from ${JSON.stringify(MODUL)};
const TAG_MS = 86_400_000;
const { kopien, aufrufe } = JSON.parse(process.argv[1]);
function zeitraffer(marken) {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pfad = join(marken, ${JSON.stringify(LAUFPROTOKOLL)});
  let gerafft = 0;
  setInterval(() => {
    const haenger = existsSync(pfad) ? readFileSync(pfad, "utf8").split("\\n").filter((lauf) => lauf.endsWith(" f")).length : 0;
    for (; gerafft < haenger; gerafft += 1) mock.timers.tick(TAG_MS);
  }, 50).unref();
}
const probe = loeschprobe(() => mkdtempSync(join(kopien, "loeschprobe-")));
const ergebnisse = [];
try {
  for (const { art, marken, eingabe, haengen, ohneNode } of aufrufe) {
    process.env.MARKEN = marken;
    if (haengen) {
      process.env.HAENGEN = "ja";
      zeitraffer(marken);
    }
    if (ohneNode) process.execPath = join(marken, "kein-node");
    const bisher = (ergebnisse.at(-1) ?? []).filter(({ status }) => status === "Survived");
    ergebnisse.push(await (art === "pruefe" ? probe.pruefe(eingabe) : probe.nachfassen({ ...eingabe, eintraege: bisher })));
  }
  console.log(JSON.stringify({ ergebnisse }));
} catch (fehler) {
  console.log(JSON.stringify({ ergebnisse, fehler: fehler.message }));
} finally {
  probe.abbauen();
}
`;

function ordner(context, praefix) {
  const pfad = mkdtempSync(join(tmpdir(), praefix));
  context.after(() => rmSync(pfad, { recursive: true, force: true }));
  return pfad;
}

function loesche(context, zweite, aufrufe) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    ".gitignore": "node_modules/\n",
    [DATEI]: QUELLE,
    [ERSTE]: ERSTER_TEST,
    [ZWEITE]: zweiterTest(zweite),
  });
  const kopien = ordner(context, "loeschprobe-kopien-");
  const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", SKRIPT, JSON.stringify({ kopien, aufrufe })], {
    cwd: repo,
    encoding: "utf8",
    env: isolatedEnvironment(),
    timeout: SKRIPT_FRIST_MS,
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const worktrees = runIn(repo, "git", ["worktree", "list"]).stdout.trim().split("\n");
  return { ...JSON.parse(lauf.stdout), repo, worktrees, uebrig: readdirSync(kopien) };
}

function pruefung(marken, alle, zeilen = ALLE_ZEILEN) {
  return { art: "pruefe", marken, eingabe: { datei: DATEI, zeilen, ergebnisse: [], tests: { erste: [ERSTE], alle } } };
}

function laeufe(marken) {
  return readFileSync(join(marken, LAUFPROTOKOLL), "utf8").trim().split("\n").map((eintrag) => eintrag.split(" "));
}

function zeile(buchstabe, status, weiteres = {}) {
  const nummer = zeileVon(buchstabe);
  return { schluessel: `${DATEI}:${nummer} Zeile gelöscht`, status, zeilen: [nummer, nummer], art: "Zeile gelöscht", ...weiteres };
}

const GETOETET = { bestaetigung: "getoetet" };
const WACKLER = `Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt (erster Lauf Killed ${ERSTE}, Bestätigungslauf Survived): ${DATEI}:${zeileVon("e")} Zeile gelöscht`;
const HAENGER = {
  bestaetigung: "haenger",
  hinweis: `Hinweis: nur durch Zeitablauf oder Absturz erkannt, in beiden Läufen; nicht bestätigt getötet: ${DATEI}:${zeileVon("f")} Zeile gelöscht`,
};
const NACH_BEIDEN_GRUPPEN = [
  zeile("a", "Killed", GETOETET),
  zeile("b", "Survived"),
  zeile("c", "Killed", GETOETET),
  zeile("d", "Survived"),
  zeile("e", "Survived", { hinweis: WACKLER }),
  zeile("f", "Timeout", HAENGER),
];
const NACH_ERSTER_GRUPPE = [
  zeile("a", "Killed", GETOETET),
  zeile("b", "Survived"),
  zeile("c", "Survived"),
  zeile("d", "Survived"),
  zeile("e", "Survived", { hinweis: WACKLER }),
  zeile("f", "Timeout", HAENGER),
];
const NACHGEFASST = [zeile("b", "Survived"), zeile("c", "Killed", GETOETET), zeile("d", "Survived"), zeile("e", "Survived", { hinweis: WACKLER })];

function beideGruppen(context) {
  const marken = ordner(context, "loeschprobe-marken-");
  return { marken, lauf: loesche(context, ZWEITE_VERLANGT_C, [pruefung(marken, [ERSTE, ZWEITE])]) };
}

test("die Löschprobe urteilt über sechs Zeilen einer Datei mit Status, Bestätigung, Hinweis und Reihenfolge wie nacheinander geprüft", (context) => {
  const { lauf } = beideGruppen(context);
  assert.equal(lauf.fehler, undefined);
  assert.deepEqual(lauf.ergebnisse, [NACH_BEIDEN_GRUPPEN]);
  assert.equal(lauf.worktrees.length, 1, lauf.worktrees.join("\n"));
  assert.deepEqual(lauf.uebrig, []);
});

test("zwei gelöschte Zeilen derselben Datei laufen nie in derselben Arbeitskopie, und mehrere Arbeitskopien prüfen gleichzeitig", (context) => {
  const { marken } = beideGruppen(context);
  const protokoll = laeufe(marken);
  assert.ok(protokoll.every(([, fehlend]) => fehlend.length <= 1), protokoll.join("\n"));
  const mitLoeschung = new Set(protokoll.filter(([, fehlend]) => fehlend.length === 1).map(([kopie]) => kopie));
  const mitGrundlauf = new Set(protokoll.filter(([, fehlend]) => fehlend.length === 0).map(([kopie]) => kopie));
  assert.ok(mitLoeschung.size > 1, protokoll.join("\n"));
  assert.deepEqual([...mitLoeschung].filter((kopie) => !mitGrundlauf.has(kopie)), []);
});

test("das Nachfassen mit den übrigen Testdateien urteilt wie nacheinander geprüft und behält den Hinweis der ersten Stufe", (context) => {
  const lauf = loesche(context, ZWEITE_VERLANGT_C, [
    pruefung(ordner(context, "loeschprobe-marken-"), [ERSTE]),
    { art: "nachfassen", marken: ordner(context, "loeschprobe-marken-"), eingabe: { datei: DATEI, uebrige: [ZWEITE] } },
  ]);
  assert.equal(lauf.fehler, undefined);
  assert.deepEqual(lauf.ergebnisse, [NACH_ERSTER_GRUPPE, NACHGEFASST]);
});

test("ist der Grundlauf einer späteren Gruppe rot, bricht die Löschprobe mit dieser Gruppe ab und baut alle Arbeitskopien ab", (context) => {
  const lauf = loesche(context, 'assert.fail("immer rot");', [pruefung(ordner(context, "loeschprobe-marken-"), [ERSTE, ZWEITE])]);
  assert.equal(lauf.fehler, `Grundlauf rot, Löschprobe nicht aussagekräftig: ${ZWEITE}`);
  assert.equal(lauf.worktrees.length, 1, lauf.worktrees.join("\n"));
  assert.deepEqual(lauf.uebrig, []);
  assert.equal(readFileSync(join(lauf.repo, DATEI), "utf8"), QUELLE);
});

test("hängt der Testlauf ohne eine Zeile bis zur Zeitgrenze, wird er beendet, wiederholt und die Zeile zählt als Hänger", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const nurF = [[zeileVon("f"), zeileVon("f")]];
  const lauf = loesche(context, ZWEITE_VERLANGT_C, [{ ...pruefung(marken, [ERSTE], nurF), haengen: true }]);
  assert.equal(lauf.fehler, undefined);
  assert.deepEqual(lauf.ergebnisse, [[zeile("f", "Timeout", HAENGER)]]);
  assert.equal(laeufe(marken).filter(([, fehlend]) => fehlend === "f").length, 2);
});

test("startet der Testlauf nicht, bricht die Löschprobe am Grundlauf ab und baut die Arbeitskopie ab", (context) => {
  const lauf = loesche(context, ZWEITE_VERLANGT_C, [{ ...pruefung(ordner(context, "loeschprobe-marken-"), [ERSTE]), ohneNode: true }]);
  assert.equal(lauf.fehler, `Grundlauf rot, Löschprobe nicht aussagekräftig: ${ERSTE}`);
  assert.equal(lauf.worktrees.length, 1, lauf.worktrees.join("\n"));
  assert.deepEqual(lauf.uebrig, []);
});
