import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const MODUL = pathToFileURL(join(REPO_ROOT, "tools/mutationspruefung/zeilen-loeschen.mjs")).href;
const DATEI = "src/zahl.js";
const ERSTE = "test/erste.test.js";
const ZWEITE = "test/zweite.test.js";
const BUCHSTABEN = ["a", "b", "c", "d", "e", "f"];
const ERSTE_ZEILE = 3;
const LETZTE_ZEILE = ERSTE_ZEILE + BUCHSTABEN.length - 1;
const ALLE_ZEILEN = [[ERSTE_ZEILE, LETZTE_ZEILE]];
const LAUFPROTOKOLL = "laeufe";

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
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { loeschprobe } from ${JSON.stringify(MODUL)};
const { kopien, aufrufe } = JSON.parse(process.argv[1]);
const probe = loeschprobe(() => mkdtempSync(join(kopien, "loeschprobe-")));
const ergebnisse = [];
try {
  for (const { art, marken, eingabe } of aufrufe) {
    process.env.MARKEN = marken;
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
  const lauf = runIn(repo, process.execPath, ["--input-type=module", "-e", SKRIPT, JSON.stringify({ kopien, aufrufe })]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const worktrees = runIn(repo, "git", ["worktree", "list"]).stdout.trim().split("\n");
  return { ...JSON.parse(lauf.stdout), repo, worktrees, uebrig: readdirSync(kopien) };
}

function pruefung(marken, alle) {
  return { art: "pruefe", marken, eingabe: { datei: DATEI, zeilen: ALLE_ZEILEN, ergebnisse: [], tests: { erste: [ERSTE], alle } } };
}

function zeile(nummer, status, weiteres = {}) {
  return { schluessel: `${DATEI}:${nummer} Zeile gelöscht`, status, zeilen: [nummer, nummer], art: "Zeile gelöscht", ...weiteres };
}

const GETOETET = { bestaetigung: "getoetet" };
const WACKLER = `Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt (erster Lauf Killed ${ERSTE}, Bestätigungslauf Survived): ${DATEI}:7 Zeile gelöscht`;
const HAENGER = `Hinweis: nur durch Zeitablauf oder Absturz erkannt, in beiden Läufen; nicht bestätigt getötet: ${DATEI}:8 Zeile gelöscht`;
const NACH_BEIDEN_GRUPPEN = [
  zeile(3, "Killed", GETOETET),
  zeile(4, "Survived"),
  zeile(5, "Killed", GETOETET),
  zeile(6, "Survived"),
  zeile(7, "Survived", { hinweis: WACKLER }),
  zeile(8, "Timeout", { bestaetigung: "haenger", hinweis: HAENGER }),
];
const NACH_ERSTER_GRUPPE = [
  zeile(3, "Killed", GETOETET),
  zeile(4, "Survived"),
  zeile(5, "Survived"),
  zeile(6, "Survived"),
  zeile(7, "Survived", { hinweis: WACKLER }),
  zeile(8, "Timeout", { bestaetigung: "haenger", hinweis: HAENGER }),
];
const NACHGEFASST = [zeile(4, "Survived"), zeile(5, "Killed", GETOETET), zeile(6, "Survived"), zeile(7, "Survived", { hinweis: WACKLER })];

function beideGruppen(context) {
  const marken = ordner(context, "loeschprobe-marken-");
  return { marken, lauf: loesche(context, 'assert.ok(zahl.protokoll.includes("c"));', [pruefung(marken, [ERSTE, ZWEITE])]) };
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
  const laeufe = readFileSync(join(marken, LAUFPROTOKOLL), "utf8").trim().split("\n").map((eintrag) => eintrag.split(" "));
  assert.ok(laeufe.every(([, fehlend]) => fehlend.length <= 1), laeufe.join("\n"));
  const mitLoeschung = new Set(laeufe.filter(([, fehlend]) => fehlend.length === 1).map(([kopie]) => kopie));
  const mitGrundlauf = new Set(laeufe.filter(([, fehlend]) => fehlend.length === 0).map(([kopie]) => kopie));
  assert.ok(mitLoeschung.size > 1, laeufe.join("\n"));
  assert.deepEqual([...mitLoeschung].filter((kopie) => !mitGrundlauf.has(kopie)), []);
});

test("das Nachfassen mit den übrigen Testdateien urteilt wie nacheinander geprüft und behält den Hinweis der ersten Stufe", (context) => {
  const lauf = loesche(context, 'assert.ok(zahl.protokoll.includes("c"));', [
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
