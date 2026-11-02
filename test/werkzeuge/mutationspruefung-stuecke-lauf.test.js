import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { werkzeug } from "./mutationspruefung-probe.js";
import { HILFE, NEGATIV, NULL, NULLTEST, VERDOPPELN, VERDOPPELNTEST, ZAHLTEST, quelle } from "./mutationspruefung-nachrunde-hilfen.js";
import { probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const FRIST = { timeout: 600_000 };
const SCHWER_MS = 100_000_000;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const URTEIL = /^(?:grün|rot): .+$/gm;
const BESTAETIGUNG = /^Bestätigung: .+$/gm;
const GELOESCHT = / Zeile gelöscht$/;
const OHNE_MUTANT = "  zahl;";
const MIT_MUTANTEN_SPAETER = 5;
const ZEILE_OHNE_MUTANT = 3;
const NICHT_INSTRUMENTIERBAR = "\nexport const KAPUTT = <<<;\n";
const STUECKNAME = /^Teil \d+ von \d+: src\/zahl\.js \(Testdateien 1 von 1, Mutanten \d+ von (\d+)\)$/gm;
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/hilfe.js": HILFE,
  "test/zahl.test.js": ZAHLTEST,
};
const AENDERUNG = {
  "src/zahl.js": quelle(NEGATIV, NULL) + VERDOPPELN,
  "test/null.test.js": NULLTEST,
  "test/verdoppeln.test.js": VERDOPPELNTEST,
};

const LOESCHAENDERUNG = {
  "src/zahl.js": `export const ART = "zahl";\n${quelle(OHNE_MUTANT, NEGATIV, NULL)}`,
  "test/null.test.js": NULLTEST,
};

function treffer(ausgabe, muster) {
  return [...ausgabe.matchAll(muster)].map(([gefunden, gruppe]) => gruppe ?? gefunden).sort();
}

function laufzeiten(context, ms) {
  const ordner = probeDirectory(context, {});
  const datei = join(ordner, "laufzeiten.json");
  const dauern = Object.fromEntries(["test/zahl.test.js", "test/null.test.js", "test/verdoppeln.test.js"].map((test) => [test, ms]));
  writeFileSync(datei, JSON.stringify({ lauf: 1, dauern }));
  return ["--laufzeiten", datei];
}

function messeAlleTeile(context, repo, zusatz) {
  const ordner = probeDirectory(context, {});
  const planDatei = join(ordner, "plan.json");
  const plan = werkzeug(repo, "HEAD", "--plan", planDatei, ...zusatz);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const { teile, anzahl } = JSON.parse(readFileSync(planDatei, "utf8"));
  const ergebnisse = join(ordner, "teile");
  mkdirSync(ergebnisse);
  for (const teil of teile) {
    const lauf = werkzeug(repo, "HEAD", "--teil", String(teil), "--teile", String(anzahl), "--ergebnis", join(ergebnisse, `mutation-teil-${teil}.json`), ...zusatz);
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  }
  const berichte = readdirSync(ergebnisse).map((name) => JSON.parse(readFileSync(join(ergebnisse, name), "utf8")));
  const urteil = werkzeug(repo, "HEAD", "--urteil", ergebnisse, ...zusatz);
  return { anzahl, plan: plan.stdout, berichte, urteil };
}

function plane(context, repo, zusatz) {
  const planDatei = join(probeDirectory(context, {}), "plan.json");
  const plan = werkzeug(repo, "HEAD", "--plan", planDatei, ...zusatz);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  return { anzahl: JSON.parse(readFileSync(planDatei, "utf8")).anzahl, ausgabe: plan.stdout };
}

function schluesselJeTeil(berichte) {
  return berichte.map(({ messungen }) => messungen.flatMap(({ ergebnisse }) => ergebnisse.map(({ schluessel }) => schluessel)));
}

function loeschungen(berichte) {
  return schluesselJeTeil(berichte)
    .map((schluessel) => schluessel.filter((eintrag) => GELOESCHT.test(eintrag)))
    .filter((eintraege) => eintraege.length > 0);
}

test("eine schwere Datei wird nach Mutanten in Stücke geteilt; die Stücke messen zusammen jeden Mutanten genau einmal und urteilen wie der ungeteilte Lauf", FRIST, (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, AENDERUNG);
  const ganz = messeAlleTeile(context, repo, []);
  const geteilt = messeAlleTeile(context, repo, laufzeiten(context, SCHWER_MS));
  assert.equal(ganz.anzahl, 1, ganz.plan);
  const stuecke = treffer(geteilt.plan, STUECKNAME);
  assert.ok(geteilt.anzahl > 1 && stuecke.length === geteilt.anzahl && stuecke.every((zahl) => Number(zahl) === geteilt.anzahl), geteilt.plan);
  const jeTeil = schluesselJeTeil(geteilt.berichte);
  assert.ok(jeTeil.every((schluessel) => schluessel.length > 0), JSON.stringify(jeTeil));
  assert.deepEqual(jeTeil.flat().sort(), schluesselJeTeil(ganz.berichte).flat().sort());
  assert.equal(geteilt.urteil.status, ganz.urteil.status, geteilt.urteil.stdout + geteilt.urteil.stderr);
  assert.deepEqual(treffer(geteilt.urteil.stdout, UEBERLEBT), treffer(ganz.urteil.stdout, UEBERLEBT));
  assert.deepEqual(treffer(geteilt.urteil.stdout, URTEIL), treffer(ganz.urteil.stdout, URTEIL));
  assert.deepEqual(treffer(geteilt.urteil.stdout, BESTAETIGUNG), treffer(ganz.urteil.stdout, BESTAETIGUNG));
});

test("eine Datei unter der Mindestdauer bleibt trotz gemessener Laufzeiten ein Teil", FRIST, (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, AENDERUNG);
  const leicht = messeAlleTeile(context, repo, laufzeiten(context, 1));
  assert.equal(leicht.anzahl, 1, leicht.plan);
  assert.deepEqual(treffer(leicht.plan, STUECKNAME), []);
});

test("in einer geteilten Datei löscht nur das erste Stück Zeilen, und eine Zeile, deren Mutanten in einem späteren Stück liegen, wird nicht gelöscht", FRIST, (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, LOESCHAENDERUNG);
  const ganz = messeAlleTeile(context, repo, []);
  const geteilt = messeAlleTeile(context, repo, laufzeiten(context, SCHWER_MS));
  const jeTeil = schluesselJeTeil(geteilt.berichte);
  const mitLoeschprobe = jeTeil.filter((schluessel) => schluessel.some((eintrag) => GELOESCHT.test(eintrag)));
  assert.ok(geteilt.anzahl > 1, geteilt.plan);
  assert.deepEqual(loeschungen(ganz.berichte), [[`src/zahl.js:${ZEILE_OHNE_MUTANT} Zeile gelöscht`]]);
  assert.deepEqual(loeschungen(geteilt.berichte), [[`src/zahl.js:${ZEILE_OHNE_MUTANT} Zeile gelöscht`]]);
  assert.ok(!mitLoeschprobe[0].some((schluessel) => schluessel.startsWith(`src/zahl.js:${MIT_MUTANTEN_SPAETER}:`)), geteilt.plan);
  assert.ok(jeTeil.flat().some((schluessel) => schluessel.startsWith(`src/zahl.js:${MIT_MUTANTEN_SPAETER}:`)), geteilt.plan);
});

test("lässt sich eine schwere Datei für den Plan nicht instrumentieren, bleibt sie ein ungeteiltes Stück", FRIST, (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, AENDERUNG);
  const zusatz = laufzeiten(context, SCHWER_MS);
  const instrumentierbar = plane(context, repo, zusatz);
  assert.ok(instrumentierbar.anzahl > 1, instrumentierbar.ausgabe);
  writeFiles(repo, { "src/zahl.js": `${AENDERUNG["src/zahl.js"]}${NICHT_INSTRUMENTIERBAR}` });
  const kaputt = plane(context, repo, zusatz);
  assert.equal(kaputt.anzahl, 1, kaputt.ausgabe);
  assert.deepEqual(treffer(kaputt.ausgabe, STUECKNAME), []);
});
