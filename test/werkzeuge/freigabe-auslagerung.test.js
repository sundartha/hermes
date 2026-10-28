import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { codeOhneFreigabe, freigabeImProbeRepo, grundZeile } from "./freigabe/hilfen.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EXIT_OK = 0;
const EXIT_ROT = 1;
const EINRUECKUNG = 2;
const LISTE = "eslint-suppressions.json";
const TESTIMPORTE = "tools/basis/test-importe.json";
const KONFIG = "eslint.config.js";
const ALT = "src/fristen.js";
const NEU = "src/tage.js";
const UNBETEILIGT = "src/anderes.js";
const REGELN = '{ "id-length": "error", "no-magic-numbers": "error" }';

function konfig(...bloecke) {
  const alle = [`{ files: ["**/*.js"], rules: ${REGELN} }`, ...bloecke];
  return `export default [${alle.join(", ")}];\n`;
}

function wandert(zahl = "24") {
  return [
    "function tage(n) {",
    `  return n * ${zahl};`,
    "}",
    "",
    "export function frist(wert) {",
    "  return tage(wert);",
    "}",
    "",
  ].join("\n");
}

function bleibt() {
  return ["export function bleibt(z) {", "  return z;", "}", ""].join("\n");
}

function vorherAlt() {
  return `${wandert()}\n${bleibt()}`;
}

function nachherAlt() {
  return `export { frist } from "./tage.js";\n\n${bleibt()}`;
}

function listenText(werte) {
  const eintraege = Object.entries(werte).map(([pfad, regeln]) => [
    pfad,
    Object.fromEntries(Object.entries(regeln).map(([regel, count]) => [regel, { count }])),
  ]);
  return `${JSON.stringify(Object.fromEntries(eintraege), null, EINRUECKUNG)}\n`;
}

function basisListe() {
  return { [ALT]: { "id-length": 2, "no-magic-numbers": 1 } };
}

function umgezogeneListe() {
  return { [ALT]: { "id-length": 1 }, [NEU]: { "id-length": 1, "no-magic-numbers": 1 } };
}

function reihenfolge(...pfade) {
  const alle = { [ALT]: basisListe()[ALT], [UNBETEILIGT]: { "id-length": 1 } };
  return listenText(Object.fromEntries(pfade.map((pfad) => [pfad, alle[pfad]])));
}

function testimporte(ziel) {
  return `${JSON.stringify([{ from: "test/anrufe/frist.test.js", to: ziel }], null, EINRUECKUNG)}\n`;
}

function grundstand() {
  return {
    ".gitignore": "node_modules\n",
    ".github/CODEOWNERS":
      "/tools/ @Antonio20045\neslint-suppressions*.json @Antonio20045\neslint.config.js @Antonio20045\n",
    "package.json": `${JSON.stringify({ type: "module" })}\n`,
    [KONFIG]: konfig(),
    "eslint-suppressions.empty.json": "{}\n",
    [ALT]: vorherAlt(),
    [UNBETEILIGT]: "export const ANDERES = 1;\n",
    [LISTE]: listenText(basisListe()),
    [TESTIMPORTE]: testimporte(ALT),
  };
}

function auslagerung(liste = umgezogeneListe(), neu = wandert()) {
  return { [ALT]: nachherAlt(), [NEU]: neu, [LISTE]: listenText(liste) };
}

function probe(context, { basis = {}, aenderung }) {
  const verzeichnis = probeRepository(context, { ...grundstand(), ...basis });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(verzeichnis, "node_modules"));
  const basisStand = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, aenderung);
  commitAll(verzeichnis, "Auslagerung");
  return { verzeichnis, basisStand };
}

async function freigabe(context, optionen) {
  const { verzeichnis, basisStand } = probe(context, optionen);
  return freigabeImProbeRepo(context, { verzeichnis, basis: basisStand });
}

function artPruefung(lauf) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:pruefung\./);
  return grundZeile(lauf.stdout);
}

async function listeBleibtPruefung(context, optionen) {
  const grund = artPruefung(await freigabe(context, optionen));
  assert.match(grund, /eslint-suppressions\.json/);
}

function umzugsmenge(verzeichnis, { basis, pfade }) {
  const url = pathToFileURL(join(REPO_ROOT, "tools/freigabe-pfadumzug.mjs")).href;
  const aufruf = [
    `import { auslagerungsumzuege } from ${JSON.stringify(url)};`,
    `const geaendert = process.argv.slice(1).map((path) => ({ status: "M", path }));`,
    `console.log(JSON.stringify([...(await auslagerungsumzuege(${JSON.stringify(basis)}, geaendert))].sort()));`,
  ].join("\n");
  const lauf = runIn(verzeichnis, process.execPath, [
    "--input-type=module",
    "-e",
    aufruf,
    ...pfade,
  ]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("auslagerung: eine reine Auslagerung mit genau nachgerechneter Liste ist art:code ohne Freigabe", async (context) => {
  codeOhneFreigabe(await freigabe(context, { aenderung: auslagerung() }));
});

test("auslagerung: ein Eintrag für eine unbeteiligte Datei neben dem Umzug bleibt art:pruefung", async (context) => {
  const liste = { ...umgezogeneListe(), [UNBETEILIGT]: { "id-length": 1 } };
  await listeBleibtPruefung(context, { aenderung: auslagerung(liste) });
});

test("auslagerung: eine höhere Zahl für die neue Datei als ihre Befunde bleibt art:pruefung", async (context) => {
  const liste = { ...umgezogeneListe(), [NEU]: { "id-length": 2, "no-magic-numbers": 1 } };
  await listeBleibtPruefung(context, { aenderung: auslagerung(liste) });
});

test("auslagerung: ein nicht gekürzter Eintrag der alten Datei bleibt art:pruefung", async (context) => {
  const liste = { ...umgezogeneListe(), [ALT]: { "id-length": 2 } };
  await listeBleibtPruefung(context, { aenderung: auslagerung(liste) });
});

test("auslagerung: eine andere Regel im Eintrag der neuen Datei bleibt art:pruefung", async (context) => {
  const liste = { [ALT]: { "id-length": 1 }, [NEU]: { "id-length": 1, complexity: 1 } };
  await listeBleibtPruefung(context, { aenderung: auslagerung(liste) });
});

test("auslagerung: eine in der neuen Datei geänderte Funktion bleibt art:pruefung", async (context) => {
  await listeBleibtPruefung(context, { aenderung: auslagerung(umgezogeneListe(), wandert("25")) });
});

test("auslagerung: eine andere ESLint-Konfiguration für die neue Datei bleibt art:pruefung", async (context) => {
  const schwaecher = konfig(`{ files: ["${NEU}"], rules: { "no-magic-numbers": "off" } }`);
  const liste = { [ALT]: { "id-length": 1, "no-magic-numbers": 1 }, [NEU]: { "id-length": 1 } };
  await listeBleibtPruefung(context, {
    basis: { [KONFIG]: schwaecher },
    aenderung: auslagerung(liste),
  });
});

test("auslagerung: mehr Befunde der neuen Datei als Unterdrückungen der alten, mit negativer Zahl ausgeglichen, bleibt art:pruefung", async (context) => {
  const liste = {
    [ALT]: { "id-length": 1, "no-magic-numbers": -1 },
    [NEU]: umgezogeneListe()[NEU],
  };
  const ohneMagie = { ...basisListe()[ALT], "no-magic-numbers": 0 };
  await listeBleibtPruefung(context, {
    basis: { [LISTE]: listenText({ [ALT]: ohneMagie }) },
    aenderung: auslagerung(liste),
  });
});

test("auslagerung: eine bei der Auslagerung nur umsortierte Liste bleibt art:pruefung", async (context) => {
  await listeBleibtPruefung(context, {
    basis: { [LISTE]: reihenfolge(UNBETEILIGT, ALT) },
    aenderung: { ...auslagerung(), [LISTE]: reihenfolge(ALT, UNBETEILIGT) },
  });
});

test("auslagerung: eine ohne Auslagerung nur umsortierte Liste bleibt art:pruefung", async (context) => {
  await listeBleibtPruefung(context, {
    basis: { [LISTE]: reihenfolge(UNBETEILIGT, ALT) },
    aenderung: { [LISTE]: reihenfolge(ALT, UNBETEILIGT) },
  });
});

test("auslagerung: eine nicht angefasste Liste lässt die Auslagerung art:code", async (context) => {
  codeOhneFreigabe(
    await freigabe(context, { aenderung: { [ALT]: nachherAlt(), [NEU]: wandert() } }),
  );
});

test("auslagerung: ein schon vorhandener Eintrag für die neue Datei bleibt art:pruefung", async (context) => {
  const alterEintrag = { ...basisListe(), [NEU]: { "id-length": 1 } };
  await listeBleibtPruefung(context, {
    basis: { [LISTE]: listenText(alterEintrag) },
    aenderung: auslagerung(),
  });
});

test("auslagerung: kaputtes JSON in der Liste bleibt art:pruefung", async (context) => {
  await listeBleibtPruefung(context, { aenderung: { ...auslagerung(), [LISTE]: "{\n" } });
});

test("auslagerung: eine mitziehende test-importe.json bleibt art:pruefung, die Liste nicht", async (context) => {
  const lauf = await freigabe(context, {
    aenderung: { ...auslagerung(), [TESTIMPORTE]: testimporte(NEU) },
  });
  const grund = artPruefung(lauf);
  assert.match(grund, /test-importe\.json/);
  assert.doesNotMatch(grund, /eslint-suppressions\.json/);
});

test("auslagerung: eine im selben PR geänderte eslint.config.js bleibt art:pruefung, die Liste nicht", async (context) => {
  const strenger = konfig('{ files: ["**/*.js"], rules: { eqeqeq: "error" } }');
  const grund = artPruefung(
    await freigabe(context, { aenderung: { ...auslagerung(), [KONFIG]: strenger } }),
  );
  assert.match(grund, /eslint\.config\.js/);
  assert.doesNotMatch(grund, /eslint-suppressions\.json/);
});

test("auslagerung: eine nicht ladbare ESLint-Konfiguration bleibt art:pruefung statt Abbruch", async (context) => {
  const lauf = await freigabe(context, {
    aenderung: { ...auslagerung(), [KONFIG]: "export default [ ;\n" },
  });
  assert.match(artPruefung(lauf), /eslint-suppressions\.json/);
});

test("auslagerung: ohne die Liste unter den geänderten Pfaden ist die Menge leer, mit ihr nur die Liste", (context) => {
  const { verzeichnis, basisStand } = probe(context, { aenderung: auslagerung() });
  const mengen = [[], [LISTE, TESTIMPORTE]].map((pfade) =>
    umzugsmenge(verzeichnis, { basis: basisStand, pfade }),
  );
  assert.deepEqual(mengen, [[], [LISTE]]);
});
