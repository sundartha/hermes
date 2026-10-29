import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { GRUPPE } from "../../tools/mutationspruefung/gruppen.mjs";
import { isolatedEnvironment, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const MODUL = pathToFileURL(join(REPO_ROOT, "tools/mutationspruefung/zeilen-loeschen.mjs")).href;
const DATEI = "src/zahl.js";
const ERSTE = "test/erste.test.js";
const ZWEITE = "test/zweite.test.js";
const DRITTE = "test/dritte.test.js";
const OFFEN = "test/offen.test.js";
const BUCHSTABEN = ["a", "b", "c", "d", "e", "f"];
const ZEILEN_VOR_DEM_ERSTEN = 2;
const LAUFPROTOKOLL = "laeufe";
const SKRIPT_FRIST_MS = 120_000;
const ROT_FRIST_MS = 40_000;
const HAENGER_TAKT_MS = 1000;
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
  `  if (fehlend[0] === "f" && process.env.HAENGEN !== undefined) return new Promise(() => setInterval(() => {}, ${HAENGER_TAKT_MS}));`,
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
const PROTOKOLL_ABFRAGE_MS = 50;
const { kopien, aufrufe } = JSON.parse(process.argv[1]);
function zeitraffer(marken) {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pfad = join(marken, ${JSON.stringify(LAUFPROTOKOLL)});
  let gerafft = 0;
  setInterval(() => {
    const haenger = existsSync(pfad) ? readFileSync(pfad, "utf8").split("\\n").filter((lauf) => lauf.endsWith(" f")).length : 0;
    for (; gerafft < haenger; gerafft += 1) mock.timers.tick(TAG_MS);
  }, PROTOKOLL_ABFRAGE_MS).unref();
}
const probe = loeschprobe(() => mkdtempSync(join(kopien, "loeschprobe-")));
const ergebnisse = [];
try {
  for (const { marken, eingabe, haengen, ohneZeitraffer, ohneNode } of aufrufe) {
    process.env.MARKEN = marken;
    if (haengen) {
      process.env.HAENGEN = "ja";
      if (!ohneZeitraffer) zeitraffer(marken);
    }
    if (ohneNode) process.execPath = join(marken, "kein-node");
    ergebnisse.push(await probe.pruefe(eingabe));
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
  return loescheIn(context, { [ZWEITE]: zweiterTest(zweite) }, aufrufe);
}

function loescheIn(context, dateien, aufrufe) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    ".gitignore": "node_modules/\n",
    [DATEI]: QUELLE,
    [ERSTE]: ERSTER_TEST,
    ...dateien,
  });
  const kopien = ordner(context, "loeschprobe-kopien-");
  const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", SKRIPT, JSON.stringify({ kopien, aufrufe })], {
    cwd: repo,
    encoding: "utf8",
    env: isolatedEnvironment(),
    timeout: Math.min(...aufrufe.map(({ frist = SKRIPT_FRIST_MS }) => frist)),
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const worktrees = runIn(repo, "git", ["worktree", "list"]).stdout.trim().split("\n");
  return { ...JSON.parse(lauf.stdout), repo, worktrees, uebrig: readdirSync(kopien), stderr: lauf.stderr };
}

function pruefung(marken, alle, zeilen = ALLE_ZEILEN) {
  return { marken, eingabe: { datei: DATEI, zeilen, ergebnisse: [], tests: { erste: [ERSTE], alle } } };
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
  assert.ok(mitLoeschung.size > 1, protokoll.join("\n"));
  const ersteLoeschung = protokoll.findIndex(([, fehlend]) => fehlend.length === 1);
  const grundlauf = protokoll.findIndex(([, fehlend]) => fehlend.length === 0);
  assert.ok(grundlauf >= 0 && grundlauf < ersteLoeschung, protokoll.join("\n"));
});

test("laufen die drei Arbeitskopien gleichzeitig an, läuft der Grundlauf der ersten Gruppe nur einmal, und die anderen warten auf ihn", (context) => {
  const { marken } = beideGruppen(context);
  const protokoll = laeufe(marken);
  assert.equal(protokoll.filter(([, fehlend]) => fehlend === "").length, 1, protokoll.join("\n"));
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

test("wird in der Gruppe ein Test rot, während eine andere Testdatei hängt, gilt die Zeile sofort als erkannt statt als Hänger", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const nurF = [[zeileVon("f"), zeileVon("f")]];
  const eingabe = { datei: DATEI, zeilen: nurF, ergebnisse: [], tests: { erste: [DRITTE, ERSTE], alle: [DRITTE, ERSTE] } };
  const dateien = { [DRITTE]: zweiterTest('assert.ok(zahl.protokoll.includes("f"));') };
  const lauf = loescheIn(context, dateien, [{ marken, eingabe, haengen: true, ohneZeitraffer: true, frist: ROT_FRIST_MS }]);
  assert.equal(lauf.fehler, undefined);
  assert.deepEqual(lauf.ergebnisse, [[zeile("f", "Killed", GETOETET)]]);
  assert.deepEqual(lauf.uebrig, []);
});

test("ein als offen markierter Test, der fehlschlägt, beendet den Testlauf nicht und macht keine Zeile zu einer erkannten", (context) => {
  const offen = 'import { test } from "node:test";\ntest("noch offen", { todo: true }, () => {\n  throw new Error("noch offen");\n});\n';
  const nurB = [[zeileVon("b"), zeileVon("b")]];
  const eingabe = { datei: DATEI, zeilen: nurB, ergebnisse: [], tests: { erste: [ERSTE, OFFEN], alle: [ERSTE, OFFEN] } };
  const lauf = loescheIn(context, { [OFFEN]: offen }, [{ marken: ordner(context, "loeschprobe-marken-"), eingabe }]);
  assert.equal(lauf.fehler, undefined);
  assert.deepEqual(lauf.ergebnisse, [[zeile("b", "Survived")]]);
});

test("startet der Testlauf nicht, bricht die Löschprobe am Grundlauf ab und baut die Arbeitskopie ab", (context) => {
  const lauf = loesche(context, ZWEITE_VERLANGT_C, [{ ...pruefung(ordner(context, "loeschprobe-marken-"), [ERSTE]), ohneNode: true }]);
  assert.equal(lauf.fehler, `Grundlauf rot, Löschprobe nicht aussagekräftig: ${ERSTE}`);
  assert.equal(lauf.worktrees.length, 1, lauf.worktrees.join("\n"));
  assert.deepEqual(lauf.uebrig, []);
});

test("startet der Testlauf nicht, nennt die Löschprobe den Startfehler als Ausgang des Grundlaufs", (context) => {
  const lauf = loesche(context, ZWEITE_VERLANGT_C, [{ ...pruefung(ordner(context, "loeschprobe-marken-"), [ERSTE]), ohneNode: true }]);
  assert.match(lauf.stderr, /^Grundlauf rot, Ausgang: Exit null, Signal null, spawn .*kein-node ENOENT$/m);
});

const UEBRIGE_GRUPPEN = 4;
const UEBRIGE = Array.from({ length: GRUPPE * (UEBRIGE_GRUPPEN - 1) + 1 }, (_leer, index) => `test/uebrige-${index}.test.js`);
const NUMMER_DER_ERSTEN_UEBRIGEN = 2;
const ZWEITE_UEBRIGE_MARKE = String(NUMMER_DER_ERSTEN_UEBRIGEN + 1);
const PRUEFUNGEN = {
  ueberlebt: "",
  erkennt: 'assert.equal(fehlend, "");',
  haengt: 'if (fehlend !== "") process.kill(process.ppid, "SIGKILL");',
  rot: 'assert.fail("immer rot");',
};
const NUR_UEBERLEBENDE = ["ueberlebt", "ueberlebt", "ueberlebt", "ueberlebt"];

function uebrigerTest(marke, pruefung) {
  return [
    'import assert from "node:assert/strict";',
    'import { appendFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    'import * as zahl from "../src/zahl.js";',
    `test("Gruppe ${marke}", () => {`,
    "  zahl.ablauf();",
    `  const fehlend = ${JSON.stringify(BUCHSTABEN)}.filter((buchstabe) => !zahl.protokoll.includes(buchstabe)).join("");`,
    `  appendFileSync(join(process.env.MARKEN, "${LAUFPROTOKOLL}"), \`\${process.cwd()} \${fehlend} ${marke}\\n\`);`,
    `  ${pruefung}`,
    "});",
    "",
  ].join("\n");
}

function mitUebrigen(context, rollen, { marken, von, bis }) {
  const uebrige = UEBRIGE.map((pfad, index) => {
    const gruppe = index % UEBRIGE_GRUPPEN;
    return [pfad, uebrigerTest(String(gruppe + NUMMER_DER_ERSTEN_UEBRIGEN), PRUEFUNGEN[rollen[gruppe]])];
  });
  const lauf = loescheIn(context, Object.fromEntries(uebrige), [pruefung(marken, [ERSTE, ...UEBRIGE], [[zeileVon(von), zeileVon(bis)]])]);
  return { fehler: lauf.fehler, ergebnisse: lauf.ergebnisse, protokoll: laeufe(marken) };
}

function ersteGruppe([, , marke]) {
  return marke === undefined;
}

test("prüft die Löschprobe nur eine Zeile, laufen ihre übrigen Gruppen erst nach den ersten und dann gleichzeitig in drei Arbeitskopien, und das Urteil folgt der Gruppenreihenfolge", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const { fehler, ergebnisse, protokoll } = mitUebrigen(context, ["ueberlebt", "haengt", "erkennt", "erkennt"], { marken, von: "b", bis: "b" });
  assert.equal(fehler, undefined);
  const hinweis = `Hinweis: nur durch Zeitablauf oder Absturz erkannt, in beiden Läufen; nicht bestätigt getötet: ${DATEI}:${zeileVon("b")} Zeile gelöscht`;
  assert.deepEqual(ergebnisse, [[zeile("b", "Timeout", { bestaetigung: "haenger", hinweis })]]);
  const uebrige = protokoll.filter((lauf) => lauf[1] === "b" && !ersteGruppe(lauf));
  assert.equal(new Set(uebrige.map(([kopie]) => kopie)).size, 3, protokoll.join("\n"));
  const ersteOhneB = protokoll.findIndex((lauf) => lauf[1] === "b" && ersteGruppe(lauf));
  assert.ok(ersteOhneB >= 0 && ersteOhneB < protokoll.findIndex((lauf) => !ersteGruppe(lauf)), protokoll.join("\n"));
});

test("erkennen die gleichzeitig laufenden Gruppen eine Zeile, beginnt keine Arbeitskopie danach die nächste Gruppe dieser Zeile", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const { fehler, ergebnisse, protokoll } = mitUebrigen(context, ["erkennt", "erkennt", "erkennt", "erkennt"], { marken, von: "b", bis: "b" });
  assert.equal(fehler, undefined);
  assert.deepEqual(ergebnisse, [[zeile("b", "Killed", GETOETET)]]);
  const gruppen = new Set(protokoll.filter((lauf) => !ersteGruppe(lauf)).map(([, , marke]) => marke));
  assert.deepEqual([...gruppen].sort(), ["2", "3", "4"], protokoll.join("\n"));
});

test("ist ein Grundlauf in einer Arbeitskopie grün, läuft er in keiner später angelegten der drei Arbeitskopien derselben Probe noch einmal", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const nurA = [[zeileVon("a"), zeileVon("a")]];
  const bisD = [[zeileVon("b"), zeileVon("d")]];
  const lauf = loesche(context, ZWEITE_VERLANGT_C, [pruefung(marken, [ERSTE], nurA), pruefung(marken, [ERSTE], bisD)]);
  assert.equal(lauf.fehler, undefined);
  assert.deepEqual(lauf.ergebnisse, [[zeile("a", "Killed", GETOETET)], [zeile("b", "Survived"), zeile("c", "Survived"), zeile("d", "Survived")]]);
  const protokoll = laeufe(marken);
  assert.equal(protokoll.filter(([, fehlend]) => fehlend === "").length, 1, protokoll.join("\n"));
  assert.equal(new Set(protokoll.map(([kopie]) => kopie)).size, 3, protokoll.join("\n"));
});

test("eine frei gewordene Arbeitskopie beginnt eine noch offene Zeile, bevor sie eine weitere Gruppe einer schon laufenden Zeile nimmt", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const { fehler, ergebnisse, protokoll } = mitUebrigen(context, NUR_UEBERLEBENDE, { marken, von: "a", bis: "d" });
  assert.equal(fehler, undefined);
  const ueberlebt = (buchstabe) => zeile(buchstabe, "Survived");
  assert.deepEqual(ergebnisse, [[zeile("a", "Killed", GETOETET), ueberlebt("b"), ueberlebt("c"), ueberlebt("d")]]);
  const zuD = protokoll.findIndex(([, fehlend]) => fehlend === "d");
  assert.ok(zuD >= 0 && zuD < protokoll.findIndex(([, fehlend, marke]) => fehlend === "b" && marke === ZWEITE_UEBRIGE_MARKE), protokoll.join("\n"));
});

const ZWEITE_UEBRIGE = UEBRIGE.filter((_pfad, index) => index % UEBRIGE_GRUPPEN === 1);

test("ist der Grundlauf einer späteren Gruppe rot, während eine frühere Gruppe die Zeile erkennt, zählt nur die Erkennung", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const { fehler, ergebnisse, protokoll } = mitUebrigen(context, ["erkennt", "rot", "ueberlebt", "ueberlebt"], { marken, von: "b", bis: "b" });
  assert.equal(fehler, undefined);
  assert.deepEqual(ergebnisse, [[zeile("b", "Killed", GETOETET)]]);
  assert.ok(protokoll.some(([, , marke]) => marke === ZWEITE_UEBRIGE_MARKE), protokoll.join("\n"));
});

test("ist der Grundlauf einer späteren Gruppe rot und hat jede frühere Gruppe die Zeile überlebt, bricht die Löschprobe ab, auch wenn eine noch spätere Gruppe die Zeile erkennt", (context) => {
  const marken = ordner(context, "loeschprobe-marken-");
  const { fehler } = mitUebrigen(context, ["ueberlebt", "rot", "erkennt", "erkennt"], { marken, von: "b", bis: "b" });
  assert.equal(fehler, `Grundlauf rot, Löschprobe nicht aussagekräftig: ${ZWEITE_UEBRIGE.join(", ")}`);
});
