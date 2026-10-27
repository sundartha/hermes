import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GRUPPE } from "../../tools/mutationspruefung/gruppen.mjs";
import { BASIS, BESCHREIBUNG, beschreibungstest, EXIT_ROT, NEGATIV, NULL, quelle, schluessel, testdatei, testdateien, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { umgebung } from "./schwerlauf-lauf.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-ueberlebende-ersatz.mjs", import.meta.url));
const WELLENBREITE = JSON.parse(readFileSync(join(REPO_ROOT, "stryker.config.json"), "utf8")).concurrency;
const GRUPPEN = WELLENBREITE + 2;
const MUTANTEN_JE_ZEILE = 4;
const PLAETZE = 2;
const LAUF = /^src\/zahl\.js: (\d+) Mutanten gegen (\d+) Testdateien in \d+ s$/gm;
const URTEIL = `grün: ${MUTANTEN_JE_ZEILE} Mutanten in den neuen Zeilen unter src/, keiner überlebt.`;
const UEBERLEBENDER = "src/zahl.js:3:32 EqualityOperator → ueberlebender";
const TESTDATEIEN_IN_BASIS = 1;
const ERSTE_FOLGEGRUPPE = WELLENBREITE;
const DIREKTE = testdateien(GRUPPEN * GRUPPE - TESTDATEIEN_IN_BASIS, "test/zz-direkt");
const INDIREKTE = testdateien(GRUPPEN * GRUPPE, "test/zz-indirekt");
const TOETER_DIREKT = ["test/zahl.test.js", ...DIREKTE][ERSTE_FOLGEGRUPPE];
const TOETER_INDIREKT = INDIREKTE[ERSTE_FOLGEGRUPPE];

function dateien(namen, inhalt) {
  return Object.fromEntries(namen.map((datei) => [datei, inhalt]));
}

function alleDirekt(context) {
  return probeRepository(context, { ...BASIS, ...dateien(DIREKTE, testdatei([-1, "negativ"], [1, "positiv"])) });
}

function nurDerEineDirekt(context) {
  return probeRepository(context, { ...BASIS, "src/beschreibung.js": BESCHREIBUNG, ...dateien(INDIREKTE, beschreibungstest(1, "POSITIV")) });
}

function geaendert(repo, toeter, context) {
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const env = { ...umgebung(context, PLAETZE), CI: "true", ...(toeter && { TOETER: toeter }) };
  return spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], { cwd: repo, encoding: "utf8", env });
}

function laeufe(ausgabe) {
  return [...ausgabe.matchAll(LAUF)].map(([, mutanten, tests]) => [Number(mutanten), Number(tests)]);
}

function gleichartig(anzahl, lauf) {
  return Array.from({ length: anzahl }, () => lauf);
}

test("Folgegruppen nach der ersten Welle prüfen nur den Überlebenden, und ein Mutant, den keine Gruppe tötet, bleibt überlebt", (context) => {
  const lauf = geaendert(alleDirekt(context), undefined, context);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), [UEBERLEBENDER]);
  assert.deepEqual(laeufe(lauf.stdout), [...gleichartig(WELLENBREITE, [MUTANTEN_JE_ZEILE, GRUPPE]), ...gleichartig(2, [1, GRUPPE])]);
});

test("Tötet erst eine Folgegruppe den Überlebenden, gilt er als getötet und kein Mutant der Zeile überlebt", (context) => {
  const lauf = geaendert(alleDirekt(context), TOETER_DIREKT, context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, new RegExp(`^${URTEIL}$`, "m"));
  assert.deepEqual(laeufe(lauf.stdout), [...gleichartig(WELLENBREITE, [MUTANTEN_JE_ZEILE, GRUPPE]), ...gleichartig(2, [1, GRUPPE])]);
});

test("Die übrigen Testgruppen bekommen nur den Mutanten, den der direkte Test übersieht, und er bleibt überlebt, wenn keine sie tötet", (context) => {
  const lauf = geaendert(nurDerEineDirekt(context), undefined, context);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), [UEBERLEBENDER]);
  assert.deepEqual(laeufe(lauf.stdout), [[MUTANTEN_JE_ZEILE, 1], ...gleichartig(GRUPPEN, [1, GRUPPE])]);
});

test("Tötet erst eine der übrigen Testgruppen den Mutanten, den der direkte Test übersieht, gilt er als getötet", (context) => {
  const lauf = geaendert(nurDerEineDirekt(context), TOETER_INDIREKT, context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, new RegExp(`^${URTEIL}$`, "m"));
  assert.deepEqual(laeufe(lauf.stdout), [[MUTANTEN_JE_ZEILE, 1], ...gleichartig(GRUPPEN, [1, GRUPPE])]);
});
