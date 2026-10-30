import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_ALTER_STAND, ABSATZ_MUTATION } from "./auftrag-lauf-hilfen.js";
import { BASIS, starte } from "./auftrag-lauf-probe.js";
import { datei } from "./auslagerung-hilfen.js";
import { BLEIBT, FREMD, WAEHLE, WEITERGEREICHT, ZWEI } from "./kopien-umzug-fall.js";
import { REPO_ROOT, probeRepository, runIn } from "./probe-repo.js";

const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const LISTE = "tools/basis/jscpd.json";
const HILFE = "src/werte.js";
const NEU = "src/waehlen.js";
const PARTNER = "test/waehlen.test.js";
const MUTANT = "src/waehlen.js:2:10 MethodExpression → treffer";
const NEUER_TEXT = "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n";
const TEST_MIT_FALL = `${BASIS["test/text.test.js"]}test("klein", () => assert.equal(gross("a"), "A"));\n`;

const ersatzMutation = (nachrunde) => `import { readFileSync } from "node:fs";
const mutant = ${JSON.stringify(MUTANT)};
const argumente = process.argv.slice(2);
const gemeldet = argumente.filter((_, stelle) => argumente[stelle - 1] === "--gleichwertig");
const getestet = readFileSync("test/text.test.js", "utf8").includes('"klein"');
const alterStand = argumente.includes("--alter-stand");
const offen = (alterStand ? !getestet : ${nachrunde}) && !gemeldet.includes(mutant);
console.log(offen ? "Verstoß: Mutant überlebt: " + mutant : "grün: keiner überlebt");
process.exitCode = offen ? 1 : 0;
`;

function umbau(erwarteteDateien) {
  return { id: "A1", art: "umbau", ziel: "Räume src auf", bereich: "src/", erwarteteDateien, vorbild: "src/text.js", abnahme: "test/text.test.js" };
}

function dateienMit(extra, nachrunde = false) {
  const paket = JSON.parse(BASIS["package.json"]);
  return {
    "package.json": JSON.stringify({ ...paket, scripts: { ...paket.scripts, "test:mutation": "node mutation.mjs" } }),
    ".jscpd.json": readFileSync(join(REPO_ROOT, ".jscpd.json"), "utf8"),
    "mutation.mjs": ersatzMutation(nachrunde),
    ...extra,
  };
}

function basisListe(context, dateien) {
  const repo = probeRepository(context, { ...BASIS, ...dateien });
  const angelegt = runIn(repo, process.execPath, [BASIS_VERGLEICH, "jscpd", "--basis-anlegen"]);
  assert.equal(angelegt.status, 0, `${angelegt.stdout}${angelegt.stderr}`);
  return readFileSync(join(repo, LISTE), "utf8");
}

function mitJscpdListe(context) {
  const quellen = dateienMit({ [HILFE]: datei(WAEHLE, ZWEI, BLEIBT), [PARTNER]: datei(WAEHLE, FREMD) });
  const liste = basisListe(context, quellen);
  assert.equal(JSON.parse(liste).befunde.length, 1, liste);
  return { dateien: { ...quellen, [LISTE]: liste }, liste };
}

function auslagern({ bauNachrunde = {}, antwort }) {
  return {
    "bau": { [HILFE]: datei(WEITERGEREICHT, BLEIBT), [NEU]: datei(WAEHLE, ZWEI) },
    "bau-nachrunde": bauNachrunde,
    "bau-nachrunde-antwort": antwort ?? "",
    "test-nachrunde": { "test/text.test.js": TEST_MIT_FALL },
    "test-nachrunde-antwort": ABSATZ_ALTER_STAND,
  };
}

function grenzenBau(beleg) {
  return beleg.pruefungen.filter(({ name }) => name === "grenzen bau").map(({ exitCode }) => exitCode);
}

function eintraege(repo) {
  return JSON.parse(runIn(repo, "git", ["show", `HEAD:${LISTE}`]).stdout).befunde;
}

test("auftrag-lauf-umzug-nach-testrunde: nach der Test-Runde nimmt grenzen bau den Umzug der Kopien-Liste im eingespielten Umbau zurück und der Lauf endet grün", (context) => {
  const { dateien } = mitJscpdListe(context);
  const drehbuch = auslagern({});
  const { repo, lauf, beleg } = starte(context, { auftrag: umbau([HILFE, NEU]), drehbuch, dateien });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(beleg.pruefungen.some(({ name, exitCode }) => name === "umbau einspielen" && exitCode === 0), JSON.stringify(beleg.pruefungen.map(({ name }) => name)));
  assert.deepEqual(grenzenBau(beleg), [0, 0]);
  const befunde = eintraege(repo);
  assert.ok(befunde.some((befund) => befund.startsWith(`${NEU}|${PARTNER}|`)), befunde.join(", "));
  assert.ok(!befunde.some((befund) => befund.startsWith(`${HILFE}|${PARTNER}|`)), befunde.join(", "));
});

test("auftrag-lauf-umzug-nach-testrunde: ein Umbau ohne Listenumzug bleibt nach der Test-Runde unverändert und endet grün", (context) => {
  const drehbuch = { ...auslagern({}), bau: { "src/text.js": NEUER_TEXT } };
  const { repo, lauf, beleg } = starte(context, { auftrag: umbau(["src/text.js"]), drehbuch, dateien: dateienMit({}) });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(grenzenBau(beleg), [0, 0]);
  assert.equal(runIn(repo, "git", ["show", "HEAD:src/text.js"]).stdout, NEUER_TEXT);
  assert.equal(runIn(repo, "git", ["show", `HEAD:${LISTE}`]).status === 0, false);
});

test("auftrag-lauf-umzug-nach-testrunde: ändert der Bau-Agent die Kopien-Liste nach dem Umzug zusätzlich, bleibt grenzen bau rot", (context) => {
  const quellen = dateienMit({ [HILFE]: datei(WAEHLE, ZWEI, BLEIBT), [PARTNER]: datei(WAEHLE, FREMD) }, true);
  const liste = basisListe(context, quellen);
  const { version } = JSON.parse(liste);
  const gekappt = `${JSON.stringify({ version, befunde: [] }, null, 2)}\n`;
  const drehbuch = auslagern({ bauNachrunde: { [LISTE]: gekappt }, antwort: `${ABSATZ_MUTATION}\n\nGleichwertig: ${MUTANT}, weil nur der Ort wechselt` });
  const { lauf } = starte(context, { auftrag: umbau([HILFE, NEU]), drehbuch, dateien: { ...quellen, [LISTE]: liste } });
  const ausgabe = lauf.stdout + lauf.stderr;
  assert.notEqual(lauf.status, 0, ausgabe);
  assert.ok(ausgabe.includes("Auftrag A1: rot (grenzen bau endete mit Exit 1.)"), ausgabe);
});
