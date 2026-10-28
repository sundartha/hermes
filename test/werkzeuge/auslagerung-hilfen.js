import assert from "node:assert/strict";
import { join } from "node:path";

import { BASIS, planAusgabe } from "./mutationspruefung-hilfen.js";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const ALTE_DATEI = "src/erfasser.js";
const NEUE_DATEI = "src/ausgelagert.js";
const VORBEREITUNG = join(REPO_ROOT, "tools/vorbereitung-pruefen.mjs");
const BEREICH_DATEI = "bereich.json";
const TESTDATEI = "test/erfasser.test.js";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const KEIN_TEIL = /^Plan: keine geänderte Zeile unter src\/ mit Mutanten oder Abschaltung\.$/m;
const ERKANNT = /^reine Auslagerung: keine Mutanten nötig \(aus src\/erfasser\.js nach src\/ausgelagert\.js: \d+ Anweisungen\)\. Grund: /m;
const GLEICHWERTIG = /^src\/ausgelagert\.js: gleichwertig \(reine-auslagerung\)$/m;
const TEIL_DER_AUSLAGERUNG = /^Teil 1 von \d+: .*src\/(erfasser|ausgelagert)\.js/m;
const TESTFALL = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { pruefen } from "../src/erfasser.js";',
  'test("pruefen", () => {',
  '  assert.equal(pruefen(-1), "aus");',
  "});",
  "",
].join("\n");

export function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

export function weitergereicht(namen) {
  return `export { ${namen} } from "./ausgelagert.js";`;
}

export function auslagerung(context, { vorher, nachher, neu, basisDazu = {}, dazu = {} }) {
  const bereich = `${JSON.stringify([ALTE_DATEI, NEUE_DATEI])}\n`;
  const repo = probeRepository(context, { ...BASIS, ...basisDazu, [ALTE_DATEI]: vorher, [TESTDATEI]: TESTFALL, [BEREICH_DATEI]: bereich });
  writeFiles(repo, { [ALTE_DATEI]: nachher, [NEUE_DATEI]: neu, ...dazu });
  commitAll(repo, "Auslagerung");
  return repo;
}

function vorbereitung(repo) {
  const lauf = runIn(repo, process.execPath, [VORBEREITUNG, "--basis", "HEAD~1", "--bereich", BEREICH_DATEI]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

export function istReineAuslagerung(context, repo) {
  const plan = planAusgabe(context, repo);
  assert.match(plan, ERKANNT);
  assert.match(plan, KEIN_TEIL);
  const lauf = vorbereitung(repo);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.ausgabe);
  assert.match(lauf.ausgabe, GLEICHWERTIG);
}

export function istKeineReineAuslagerung(context, repo) {
  const plan = planAusgabe(context, repo);
  assert.doesNotMatch(plan, /^reine Auslagerung/m);
  assert.match(plan, TEIL_DER_AUSLAGERUNG);
  const lauf = vorbereitung(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.doesNotMatch(lauf.ausgabe, /gleichwertig \(reine-auslagerung\)/);
}
